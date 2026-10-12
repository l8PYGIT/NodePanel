package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/pasarguard/panel/internal/config"
	"github.com/pasarguard/panel/internal/nodeclient"
	"github.com/pasarguard/panel/internal/store"
	"github.com/pasarguard/panel/internal/webhook"
)

const testToken = "test-token"

// fakeNode emulates a node agent's master admin API for panel tests.
type fakeNode struct {
	mu          sync.Mutex
	masterKey   string
	created     map[string]nodeclient.CreateTenantRequest
	usedBytes   int64
	activeUsers int
	// failDelete makes tenant deletion fail, so tests can prove the panel keeps
	// local state rather than orphaning a live tenant.
	failDelete   bool
	inboundsJSON string
}

func newFakeNode(masterKey string, usedBytes int64) (*fakeNode, *httptest.Server) {
	f := &fakeNode{masterKey: masterKey, created: map[string]nodeclient.CreateTenantRequest{}, usedBytes: usedBytes}
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(nodeclient.Health{Status: "ok", CoreStarted: true, CoreVersion: "26.3.27"})
	})
	mux.HandleFunc("/admin/config", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	mux.HandleFunc("/admin/inbounds", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		ib := f.inboundsJSON
		f.mu.Unlock()
		if ib != "" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(ib))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	})
	mux.HandleFunc("/admin/tenants", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-API-Key") != f.masterKey {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var req nodeclient.CreateTenantRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		f.mu.Lock()
		f.created[req.ID] = req
		f.mu.Unlock()
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(nodeclient.TenantView{ID: req.ID, Status: "active", QuotaBytes: req.QuotaBytes, ExpireAt: req.ExpireAt})
	})
	mux.HandleFunc("/admin/tenants/", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-API-Key") != f.masterKey {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if r.Method == http.MethodDelete {
			f.mu.Lock()
			fail := f.failDelete
			f.mu.Unlock()
			if fail {
				http.Error(w, "tenant busy", http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		switch {
		case strings.HasSuffix(r.URL.Path, "/usage"):
			f.mu.Lock()
			au := f.activeUsers
			f.mu.Unlock()
			_ = json.NewEncoder(w).Encode(nodeclient.UsageView{
				ID: "t", Status: "active", UsedBytes: f.usedBytes, QuotaBytes: 1000,
				ActiveUsers: au,
			})
		default:
			_ = json.NewEncoder(w).Encode(nodeclient.TenantView{ID: "t", Status: "active"})
		}
	})
	return f, httptest.NewServer(mux)
}

func newTestAPI(t *testing.T) *API {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "panel.db"))
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return New(st, &config.Config{APIToken: testToken})
}

func call(t *testing.T, h http.Handler, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Authorization", "Bearer "+testToken)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	return rr
}

func decode[T any](t *testing.T, rr *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(rr.Body.Bytes(), &v); err != nil {
		t.Fatalf("decode %T: %v (body=%s)", v, err, rr.Body.String())
	}
	return v
}

func TestProvisioningFlow(t *testing.T) {
	const masterKey = "node-master"
	fake, srv := newFakeNode(masterKey, 5000)
	defer srv.Close()

	a := newTestAPI(t)
	h := a.Router()

	// Register the node (panel probes health).
	rr := call(t, h, http.MethodPost, "/api/v1/nodes", map[string]any{
		"name": "edge-1", "address": srv.URL, "master_key": masterKey,
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("register node: %d body=%s", rr.Code, rr.Body.String())
	}
	node := decode[map[string]any](t, rr)
	if node["status"] != "online" {
		t.Fatalf("node should be online, got %v", node["status"])
	}
	if _, leaked := node["master_key"]; leaked {
		t.Fatal("master_key must not be exposed in API response")
	}
	nodeID := node["id"].(string)

	// Create a customer and a plan.
	cust := decode[map[string]any](t, call(t, h, http.MethodPost, "/api/v1/customers", map[string]any{"name": "acme"}))
	customerID := cust["id"].(string)
	plan := decode[map[string]any](t, call(t, h, http.MethodPost, "/api/v1/plans", map[string]any{
		"name": "100MB", "quota_bytes": 104857600, "duration_days": 30, "max_users": 10,
	}))
	planID := plan["id"].(string)

	// Create a subscription -> provisions a tenant on the node, returns key once.
	rr = call(t, h, http.MethodPost, "/api/v1/customers/"+customerID+"/subscriptions", map[string]any{
		"plan_id": planID, "node_id": nodeID,
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("create subscription: %d body=%s", rr.Code, rr.Body.String())
	}
	var subResp subscriptionResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &subResp); err != nil {
		t.Fatalf("decode sub: %v", err)
	}
	if subResp.APIKey == "" {
		t.Fatal("api_key should be returned once")
	}
	tenantID := subResp.Subscription.NodeTenantID
	if tenantID == "" {
		t.Fatal("subscription should reference a node tenant id")
	}

	// The fake node must have received the provisioning request with our values.
	fake.mu.Lock()
	created, ok := fake.created[tenantID]
	fake.mu.Unlock()
	if !ok {
		t.Fatal("node did not receive CreateTenant")
	}
	if created.QuotaBytes != 104857600 || created.APIKey != subResp.APIKey {
		t.Fatalf("provisioning mismatch: %+v", created)
	}

	// Run the usage collector once; the customer's usage should reflect the node.
	a.collectUsageOnce(context.Background())
	usage := decode[customerUsageResponse](t, call(t, h, http.MethodGet, "/api/v1/customers/"+customerID+"/usage", nil))
	if usage.UsedBytes != 5000 {
		t.Fatalf("expected aggregated usage 5000, got %d", usage.UsedBytes)
	}

	// Suspend the subscription via the panel (forwarded to the node).
	subID := subResp.Subscription.ID
	if rr := call(t, h, http.MethodPost, "/api/v1/subscriptions/"+subID+"/suspend", nil); rr.Code != http.StatusOK {
		t.Fatalf("suspend: %d body=%s", rr.Code, rr.Body.String())
	}
	subs := decode[[]map[string]any](t, call(t, h, http.MethodGet, "/api/v1/customers/"+customerID+"/subscriptions", nil))
	if len(subs) != 1 || subs[0]["status"] != "suspended" {
		t.Fatalf("subscription should be suspended, got %+v", subs)
	}

	// Usage history must actually be written. It used to reference a table
	// nothing ever populates, so every insert failed the FK check and the audit
	// trail was silently empty for the life of the database.
	if n, err := a.store.CountUsageRecords(); err != nil || n == 0 {
		t.Fatalf("usage records = %d err=%v, want at least one sample persisted", n, err)
	}
}

// registerTestNode registers a node against a fake agent and returns its id.
func registerTestNode(t *testing.T, h http.Handler, addr, masterKey string) string {
	t.Helper()
	rr := call(t, h, http.MethodPost, "/api/v1/nodes", map[string]any{
		"name": "edge-1", "address": addr, "master_key": masterKey,
		"core_key": "core-secret", "host_info": "SNI: cdn.example.com",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("register node: %d body=%s", rr.Code, rr.Body.String())
	}
	return decode[map[string]any](t, rr)["id"].(string)
}

// PATCH is a partial update: a client that sends only the field it means to
// change must not silently erase the others. core_key and host_info used to be
// wiped by any such request, taking the buyer-facing host note with them.
func TestPatchNodePreservesOmittedFields(t *testing.T) {
	const masterKey = "node-master"
	_, srv := newFakeNode(masterKey, 0)
	defer srv.Close()

	a := newTestAPI(t)
	h := a.Router()
	nodeID := registerTestNode(t, h, srv.URL, masterKey)

	// Rename only. Everything else must survive.
	rr := call(t, h, http.MethodPatch, "/api/v1/nodes/"+nodeID, map[string]any{"name": "edge-renamed"})
	if rr.Code != http.StatusOK {
		t.Fatalf("patch: %d body=%s", rr.Code, rr.Body.String())
	}

	detail := decode[map[string]any](t, call(t, h, http.MethodGet, "/api/v1/nodes/"+nodeID, nil))
	if detail["name"] != "edge-renamed" {
		t.Fatalf("name = %v, want edge-renamed", detail["name"])
	}
	if detail["core_key"] != "core-secret" {
		t.Fatalf("core_key = %v, want it preserved", detail["core_key"])
	}
	if detail["host_info"] != "SNI: cdn.example.com" {
		t.Fatalf("host_info = %v, want it preserved", detail["host_info"])
	}
	if detail["master_key"] != masterKey {
		t.Fatalf("master_key = %v, want it preserved", detail["master_key"])
	}

	// An explicitly empty string still clears a field.
	empty := ""
	if rr := call(t, h, http.MethodPatch, "/api/v1/nodes/"+nodeID, map[string]any{"host_info": empty}); rr.Code != http.StatusOK {
		t.Fatalf("patch clear: %d body=%s", rr.Code, rr.Body.String())
	}
	detail = decode[map[string]any](t, call(t, h, http.MethodGet, "/api/v1/nodes/"+nodeID, nil))
	if detail["host_info"] != "" {
		t.Fatalf("host_info = %v, want it cleared", detail["host_info"])
	}

	// Blanking a required field is refused rather than applied.
	if rr := call(t, h, http.MethodPatch, "/api/v1/nodes/"+nodeID, map[string]any{"name": ""}); rr.Code != http.StatusBadRequest {
		t.Fatalf("blank name: %d, want 400", rr.Code)
	}
}

// Deleting a subscription discards the only record of node_tenant_id, so it
// must not proceed when the node refuses to remove the tenant — that would
// leave a live tenant serving traffic with nothing pointing at it.
func TestDeleteSubscriptionKeptWhenNodeFails(t *testing.T) {
	const masterKey = "node-master"
	fake, srv := newFakeNode(masterKey, 0)
	defer srv.Close()

	a := newTestAPI(t)
	h := a.Router()
	nodeID := registerTestNode(t, h, srv.URL, masterKey)

	cust := decode[map[string]any](t, call(t, h, http.MethodPost, "/api/v1/customers", map[string]any{"name": "acme"}))
	plan := decode[map[string]any](t, call(t, h, http.MethodPost, "/api/v1/plans", map[string]any{
		"name": "100MB", "quota_bytes": 104857600, "duration_days": 30, "max_users": 10,
	}))
	rr := call(t, h, http.MethodPost, "/api/v1/customers/"+cust["id"].(string)+"/subscriptions", map[string]any{
		"plan_id": plan["id"].(string), "node_id": nodeID,
	})
	var subResp subscriptionResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &subResp); err != nil {
		t.Fatalf("decode sub: %v", err)
	}
	subID := subResp.Subscription.ID

	// The node now rejects tenant deletion.
	fake.mu.Lock()
	fake.failDelete = true
	fake.mu.Unlock()

	if rr := call(t, h, http.MethodDelete, "/api/v1/subscriptions/"+subID, nil); rr.Code != http.StatusBadGateway {
		t.Fatalf("delete with failing node: %d, want 502 (subscription kept)", rr.Code)
	}
	if _, err := a.store.GetSubscription(subID); err != nil {
		t.Fatalf("subscription was removed despite the node failure: %v", err)
	}

	// Once the node accepts it, the delete goes through.
	fake.mu.Lock()
	fake.failDelete = false
	fake.mu.Unlock()
	if rr := call(t, h, http.MethodDelete, "/api/v1/subscriptions/"+subID, nil); rr.Code != http.StatusNoContent {
		t.Fatalf("delete with healthy node: %d, want 204", rr.Code)
	}
	if _, err := a.store.GetSubscription(subID); err == nil {
		t.Fatal("subscription should be gone after a successful deprovision")
	}
}

// The /sub/{token} responses carry a live node credential, so they must never
// be cacheable by an intermediary.
func TestSubResponsesAreNotCacheable(t *testing.T) {
	const masterKey = "node-master"
	_, srv := newFakeNode(masterKey, 0)
	defer srv.Close()

	a := newTestAPI(t)
	h := a.Router()
	nodeID := registerTestNode(t, h, srv.URL, masterKey)

	cust := decode[map[string]any](t, call(t, h, http.MethodPost, "/api/v1/customers", map[string]any{"name": "acme"}))
	plan := decode[map[string]any](t, call(t, h, http.MethodPost, "/api/v1/plans", map[string]any{
		"name": "100MB", "quota_bytes": 104857600, "duration_days": 30, "max_users": 10,
	}))
	rr := call(t, h, http.MethodPost, "/api/v1/customers/"+cust["id"].(string)+"/subscriptions", map[string]any{
		"plan_id": plan["id"].(string), "node_id": nodeID,
	})
	var subResp subscriptionResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &subResp); err != nil {
		t.Fatalf("decode sub: %v", err)
	}

	sub, err := a.store.GetSubscription(subResp.Subscription.ID)
	if err != nil {
		t.Fatalf("load subscription: %v", err)
	}
	for _, path := range []string{"/sub/" + sub.SubToken, "/sub/" + sub.SubToken + "/info"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET %s: %d", path, rec.Code)
		}
		if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
			t.Fatalf("GET %s Cache-Control = %q, want no-store", path, cc)
		}
	}
}

// A subscription token in a URL is itself a credential; the access log must not
// record it verbatim.
func TestRequestLogRedactsSubToken(t *testing.T) {
	cases := map[string]string{
		"/sub/abc123":           "/sub/<redacted>",
		"/sub/abc123/info":      "/sub/<redacted>/info",
		"/api/v1/nodes":         "/api/v1/nodes",
		"/sub/":                 "/sub/<redacted>",
		"/health":               "/health",
		"/api/v1/subscriptions": "/api/v1/subscriptions",
	}
	for in, want := range cases {
		if got := redactPath(in); got != want {
			t.Errorf("redactPath(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestCreatePlanExtendedFieldsAndValidation(t *testing.T) {
	a := newTestAPI(t)
	h := a.Router()

	// 1. Successful plan creation with extended fields
	rr := call(t, h, http.MethodPost, "/api/v1/plans", map[string]any{
		"name":             "Dedicated-Vip",
		"quota_bytes":      104857600,
		"duration_days":    30,
		"max_users":        10,
		"allowed_inbounds": []string{"vless-reality", "trojan"},
		"core_type":        "dedicated",
		"max_ips":          3,
		"speed_limit_mbps": 50,
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("create plan: %d body=%s", rr.Code, rr.Body.String())
	}
	plan := decode[map[string]any](t, rr)
	if plan["core_type"] != "dedicated" {
		t.Fatalf("core_type = %v, want dedicated", plan["core_type"])
	}
	if int(plan["max_ips"].(float64)) != 3 {
		t.Fatalf("max_ips = %v, want 3", plan["max_ips"])
	}
	if int(plan["speed_limit_mbps"].(float64)) != 50 {
		t.Fatalf("speed_limit_mbps = %v, want 50", plan["speed_limit_mbps"])
	}
	inbounds, ok := plan["allowed_inbounds"].([]any)
	if !ok || len(inbounds) != 2 || inbounds[0] != "vless-reality" || inbounds[1] != "trojan" {
		t.Fatalf("allowed_inbounds = %v, want [vless-reality trojan]", plan["allowed_inbounds"])
	}

	// 2. Default core_type should be "shared" when omitted
	rr = call(t, h, http.MethodPost, "/api/v1/plans", map[string]any{
		"name":          "Shared-Default",
		"quota_bytes":   50000000,
		"duration_days": 15,
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("create plan default: %d body=%s", rr.Code, rr.Body.String())
	}
	planDef := decode[map[string]any](t, rr)
	if planDef["core_type"] != "shared" {
		t.Fatalf("expected default core_type shared, got %v", planDef["core_type"])
	}

	// 3. Invalid core_type should be rejected with 400
	rr = call(t, h, http.MethodPost, "/api/v1/plans", map[string]any{
		"name":          "Invalid-Core",
		"quota_bytes":   50000000,
		"duration_days": 15,
		"core_type":     "something-else",
	})
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("invalid core_type code = %d, want 400", rr.Code)
	}

	// 4. Negative values rejected with 400
	for _, bad := range []map[string]any{
		{"name": "p", "quota_bytes": 1000, "duration_days": 1, "max_users": -1},
		{"name": "p", "quota_bytes": 1000, "duration_days": 1, "max_ips": -1},
		{"name": "p", "quota_bytes": 1000, "duration_days": 1, "speed_limit_mbps": -1},
	} {
		rr = call(t, h, http.MethodPost, "/api/v1/plans", bad)
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("negative limit %v: code = %d, want 400", bad, rr.Code)
		}
	}
}

func TestCreateSubscriptionLimitsAndOverrides(t *testing.T) {
	const masterKey = "node-master"
	fake, srv := newFakeNode(masterKey, 0)
	defer srv.Close()

	a := newTestAPI(t)
	h := a.Router()
	nodeID := registerTestNode(t, h, srv.URL, masterKey)

	cust := decode[map[string]any](t, call(t, h, http.MethodPost, "/api/v1/customers", map[string]any{"name": "buyer1"}))
	customerID := cust["id"].(string)

	plan := decode[map[string]any](t, call(t, h, http.MethodPost, "/api/v1/plans", map[string]any{
		"name":             "Plan-Dedicated",
		"quota_bytes":      104857600,
		"duration_days":    30,
		"max_users":        10,
		"allowed_inbounds": []string{"vless-reality", "vmess-ws"},
		"core_type":        "dedicated",
		"max_ips":          5,
		"speed_limit_mbps": 100,
	}))
	planID := plan["id"].(string)

	// 1. Subscription without overrides inherits from plan
	rr := call(t, h, http.MethodPost, "/api/v1/customers/"+customerID+"/subscriptions", map[string]any{
		"plan_id": planID,
		"node_id": nodeID,
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("create sub: %d body=%s", rr.Code, rr.Body.String())
	}
	var subResp subscriptionResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &subResp); err != nil {
		t.Fatalf("decode sub: %v", err)
	}

	fake.mu.Lock()
	createdTenant1 := fake.created[subResp.Subscription.NodeTenantID]
	fake.mu.Unlock()

	if createdTenant1.CoreType != "dedicated" {
		t.Fatalf("node CoreType = %v, want dedicated", createdTenant1.CoreType)
	}
	if createdTenant1.MaxUsers != 10 {
		t.Fatalf("node MaxUsers = %v, want 10", createdTenant1.MaxUsers)
	}
	if createdTenant1.MaxIPs != 5 {
		t.Fatalf("node MaxIPs = %v, want 5", createdTenant1.MaxIPs)
	}
	if createdTenant1.SpeedLimitMbps != 100 {
		t.Fatalf("node SpeedLimitMbps = %v, want 100", createdTenant1.SpeedLimitMbps)
	}
	if len(createdTenant1.AllowedInbounds) != 2 || createdTenant1.AllowedInbounds[0] != "vless-reality" {
		t.Fatalf("node AllowedInbounds = %v, want [vless-reality vmess-ws]", createdTenant1.AllowedInbounds)
	}

	// Verify persisted subscription
	subStored1, err := a.store.GetSubscription(subResp.Subscription.ID)
	if err != nil {
		t.Fatalf("get sub: %v", err)
	}
	if subStored1.CoreType != "dedicated" || subStored1.MaxUsers != 10 || subStored1.MaxIPs != 5 || subStored1.SpeedLimitMbps != 100 {
		t.Fatalf("stored sub mismatch: %+v", subStored1)
	}

	// 2. Subscription WITH overrides overrides the plan
	maxUsersOverride := 3
	maxIPsOverride := 2
	speedLimitOverride := 25
	rr = call(t, h, http.MethodPost, "/api/v1/customers/"+customerID+"/subscriptions", map[string]any{
		"plan_id":          planID,
		"node_id":          nodeID,
		"allowed_inbounds": []string{"vless-reality"},
		"max_users":        &maxUsersOverride,
		"core_type":        "shared",
		"max_ips":          &maxIPsOverride,
		"speed_limit_mbps": &speedLimitOverride,
		"domains":          []string{"buyer.example.com"},
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("create sub with overrides: %d body=%s", rr.Code, rr.Body.String())
	}
	var subResp2 subscriptionResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &subResp2); err != nil {
		t.Fatalf("decode sub2: %v", err)
	}

	fake.mu.Lock()
	createdTenant2 := fake.created[subResp2.Subscription.NodeTenantID]
	fake.mu.Unlock()

	if createdTenant2.CoreType != "shared" {
		t.Fatalf("node CoreType = %v, want shared", createdTenant2.CoreType)
	}
	if createdTenant2.MaxUsers != 3 {
		t.Fatalf("node MaxUsers = %v, want 3", createdTenant2.MaxUsers)
	}
	if createdTenant2.MaxIPs != 2 {
		t.Fatalf("node MaxIPs = %v, want 2", createdTenant2.MaxIPs)
	}
	if createdTenant2.SpeedLimitMbps != 25 {
		t.Fatalf("node SpeedLimitMbps = %v, want 25", createdTenant2.SpeedLimitMbps)
	}
	if len(createdTenant2.AllowedInbounds) != 1 || createdTenant2.AllowedInbounds[0] != "vless-reality" {
		t.Fatalf("node AllowedInbounds = %v, want [vless-reality]", createdTenant2.AllowedInbounds)
	}
	if len(createdTenant2.Domains) != 1 || createdTenant2.Domains[0] != "buyer.example.com" {
		t.Fatalf("node Domains = %v, want [buyer.example.com]", createdTenant2.Domains)
	}

	// Verify persisted subscription
	subStored2, err := a.store.GetSubscription(subResp2.Subscription.ID)
	if err != nil {
		t.Fatalf("get sub2: %v", err)
	}
	if subStored2.CoreType != "shared" || subStored2.MaxUsers != 3 || subStored2.MaxIPs != 2 || subStored2.SpeedLimitMbps != 25 {
		t.Fatalf("stored sub2 mismatch: %+v", subStored2)
	}
	if len(subStored2.Domains) != 1 || subStored2.Domains[0] != "buyer.example.com" {
		t.Fatalf("stored sub2 domains mismatch: %+v", subStored2.Domains)
	}
}

func TestSubscriptionConnectionInboundFiltering(t *testing.T) {
	const masterKey = "node-master"
	fake, srv := newFakeNode(masterKey, 0)
	defer srv.Close()

	fake.mu.Lock()
	fake.inboundsJSON = `{"inbounds":[{"tag":"vless-reality","port":443},{"tag":"vmess-ws","port":80},{"tag":"trojan","port":8443}]}`
	fake.mu.Unlock()

	a := newTestAPI(t)
	h := a.Router()
	nodeID := registerTestNode(t, h, srv.URL, masterKey)

	cust := decode[map[string]any](t, call(t, h, http.MethodPost, "/api/v1/customers", map[string]any{"name": "buyer2"}))
	customerID := cust["id"].(string)

	plan := decode[map[string]any](t, call(t, h, http.MethodPost, "/api/v1/plans", map[string]any{
		"name":             "Plan-Restricted",
		"quota_bytes":      104857600,
		"duration_days":    30,
		"allowed_inbounds": []string{"vless-reality"},
	}))
	planID := plan["id"].(string)

	// 1. Subscription with allowed_inbounds = ["vless-reality"]
	rr := call(t, h, http.MethodPost, "/api/v1/customers/"+customerID+"/subscriptions", map[string]any{
		"plan_id": planID,
		"node_id": nodeID,
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("create sub: %d body=%s", rr.Code, rr.Body.String())
	}
	var subResp subscriptionResponse
	_ = json.Unmarshal(rr.Body.Bytes(), &subResp)

	// Check /api/v1/subscriptions/{id}/connection
	connRR := call(t, h, http.MethodGet, "/api/v1/subscriptions/"+subResp.Subscription.ID+"/connection", nil)
	if connRR.Code != http.StatusOK {
		t.Fatalf("get connection: %d body=%s", connRR.Code, connRR.Body.String())
	}
	var connResp connectionInfoResponse
	if err := json.Unmarshal(connRR.Body.Bytes(), &connResp); err != nil {
		t.Fatalf("decode connResp: %v", err)
	}

	var inboundsDoc struct {
		Inbounds []struct {
			Tag  string `json:"tag"`
			Port int    `json:"port"`
		} `json:"inbounds"`
	}
	if err := json.Unmarshal(connResp.Inbounds, &inboundsDoc); err != nil {
		t.Fatalf("unmarshal filtered inbounds: %v (raw=%s)", err, string(connResp.Inbounds))
	}
	if len(inboundsDoc.Inbounds) != 1 || inboundsDoc.Inbounds[0].Tag != "vless-reality" {
		t.Fatalf("expected only vless-reality, got: %+v", inboundsDoc.Inbounds)
	}

	// Also check public sub info endpoint /sub/{token}/info
	subInfoReq := httptest.NewRequest(http.MethodGet, "/sub/"+subResp.Subscription.SubToken+"/info", nil)
	subInfoRec := httptest.NewRecorder()
	h.ServeHTTP(subInfoRec, subInfoReq)
	if subInfoRec.Code != http.StatusOK {
		t.Fatalf("sub info: %d", subInfoRec.Code)
	}
	var subInfo subInfoResponse
	if err := json.Unmarshal(subInfoRec.Body.Bytes(), &subInfo); err != nil {
		t.Fatalf("decode subInfo: %v", err)
	}
	var subInfoInbounds struct {
		Inbounds []struct {
			Tag string `json:"tag"`
		} `json:"inbounds"`
	}
	if err := json.Unmarshal(subInfo.Inbounds, &subInfoInbounds); err != nil {
		t.Fatalf("unmarshal subInfo inbounds: %v", err)
	}
	if len(subInfoInbounds.Inbounds) != 1 || subInfoInbounds.Inbounds[0].Tag != "vless-reality" {
		t.Fatalf("expected only vless-reality in subInfo, got: %+v", subInfoInbounds.Inbounds)
	}

	// 2. Wildcard allowed_inbounds = ["*"] returns all 3 inbounds
	rrWild := call(t, h, http.MethodPost, "/api/v1/customers/"+customerID+"/subscriptions", map[string]any{
		"plan_id":          planID,
		"node_id":          nodeID,
		"allowed_inbounds": []string{"*"},
	})
	var subRespWild subscriptionResponse
	_ = json.Unmarshal(rrWild.Body.Bytes(), &subRespWild)

	connRRWild := call(t, h, http.MethodGet, "/api/v1/subscriptions/"+subRespWild.Subscription.ID+"/connection", nil)
	var connRespWild connectionInfoResponse
	_ = json.Unmarshal(connRRWild.Body.Bytes(), &connRespWild)
	var inboundsWild struct {
		Inbounds []struct {
			Tag string `json:"tag"`
		} `json:"inbounds"`
	}
	_ = json.Unmarshal(connRespWild.Inbounds, &inboundsWild)
	if len(inboundsWild.Inbounds) != 3 {
		t.Fatalf("expected all 3 inbounds with wildcard, got %d", len(inboundsWild.Inbounds))
	}
}

func TestCollectorUserThresholdEvents(t *testing.T) {
	const masterKey = "node-master"
	fake, nodeSrv := newFakeNode(masterKey, 100)
	defer nodeSrv.Close()

	sink, sinkSrv := newWebhookSink("wh-secret")
	defer sinkSrv.Close()

	a := newTestAPI(t)
	h := a.Router()

	// Register webhook
	if rr := call(t, h, http.MethodPost, "/api/v1/webhooks", map[string]any{
		"url": sinkSrv.URL, "secret": "wh-secret", "events": "*",
	}); rr.Code != http.StatusCreated {
		t.Fatalf("create webhook: %d body=%s", rr.Code, rr.Body.String())
	}

	// Register node, customer, plan with max_users=10, create subscription
	node := decode[map[string]any](t, call(t, h, http.MethodPost, "/api/v1/nodes", map[string]any{
		"name": "n1", "address": nodeSrv.URL, "master_key": masterKey,
	}))
	cust := decode[map[string]any](t, call(t, h, http.MethodPost, "/api/v1/customers", map[string]any{"name": "buyer"}))
	plan := decode[map[string]any](t, call(t, h, http.MethodPost, "/api/v1/plans", map[string]any{
		"name": "cap10", "quota_bytes": 1000000, "duration_days": 30, "max_users": 10,
	}))
	subResp := decode[subscriptionResponse](t, call(t, h, http.MethodPost, "/api/v1/customers/"+cust["id"].(string)+"/subscriptions", map[string]any{
		"plan_id": plan["id"].(string), "node_id": node["id"].(string),
	}))
	subID := subResp.Subscription.ID

	// Pass 1: activeUsers = 8 (80%) -> users.threshold event
	fake.mu.Lock()
	fake.activeUsers = 8
	fake.mu.Unlock()

	a.collectUsageOnce(context.Background())
	time.Sleep(100 * time.Millisecond)

	sub, err := a.store.GetSubscription(subID)
	if err != nil {
		t.Fatalf("get sub: %v", err)
	}
	if sub.NotifiedUsersThreshold != 80 {
		t.Errorf("sub.NotifiedUsersThreshold = %d, want 80", sub.NotifiedUsersThreshold)
	}

	// Pass 2: activeUsers still 8 -> no re-emission
	a.collectUsageOnce(context.Background())
	time.Sleep(100 * time.Millisecond)

	// Pass 3: activeUsers = 9 (90%) -> users.threshold event
	fake.mu.Lock()
	fake.activeUsers = 9
	fake.mu.Unlock()

	a.collectUsageOnce(context.Background())
	time.Sleep(100 * time.Millisecond)

	sub, _ = a.store.GetSubscription(subID)
	if sub.NotifiedUsersThreshold != 90 {
		t.Errorf("sub.NotifiedUsersThreshold = %d, want 90", sub.NotifiedUsersThreshold)
	}

	// Pass 4: activeUsers = 10 (100%) -> users.limit_reached event
	fake.mu.Lock()
	fake.activeUsers = 10
	fake.mu.Unlock()

	a.collectUsageOnce(context.Background())
	time.Sleep(100 * time.Millisecond)

	sub, _ = a.store.GetSubscription(subID)
	if sub.NotifiedUsersThreshold != 100 {
		t.Errorf("sub.NotifiedUsersThreshold = %d, want 100", sub.NotifiedUsersThreshold)
	}

	types := sink.types()
	var threshold80Count, threshold90Count, limit100Count int
	for _, env := range sink.events {
		if env.Type == webhook.EventUsersThreshold {
			data, _ := json.Marshal(env.Data)
			var m map[string]any
			_ = json.Unmarshal(data, &m)
			if int(m["threshold"].(float64)) == 80 {
				threshold80Count++
			} else if int(m["threshold"].(float64)) == 90 {
				threshold90Count++
			}
		} else if env.Type == webhook.EventUsersLimitReached {
			data, _ := json.Marshal(env.Data)
			var m map[string]any
			_ = json.Unmarshal(data, &m)
			if int(m["threshold"].(float64)) == 100 {
				limit100Count++
			}
		}
	}
	if threshold80Count != 1 {
		t.Errorf("expected 1 users.threshold (80), got %d (all: %v)", threshold80Count, types)
	}
	if threshold90Count != 1 {
		t.Errorf("expected 1 users.threshold (90), got %d (all: %v)", threshold90Count, types)
	}
	if limit100Count != 1 {
		t.Errorf("expected 1 users.limit_reached (100), got %d (all: %v)", limit100Count, types)
	}
}

func TestCollectorUserThresholdUnlimitedUsersIgnored(t *testing.T) {
	const masterKey = "node-master"
	fake, nodeSrv := newFakeNode(masterKey, 100)
	defer nodeSrv.Close()

	sink, sinkSrv := newWebhookSink("wh-secret")
	defer sinkSrv.Close()

	a := newTestAPI(t)
	h := a.Router()

	_ = call(t, h, http.MethodPost, "/api/v1/webhooks", map[string]any{
		"url": sinkSrv.URL, "secret": "wh-secret", "events": "*",
	})
	node := decode[map[string]any](t, call(t, h, http.MethodPost, "/api/v1/nodes", map[string]any{
		"name": "n1", "address": nodeSrv.URL, "master_key": masterKey,
	}))
	cust := decode[map[string]any](t, call(t, h, http.MethodPost, "/api/v1/customers", map[string]any{"name": "buyer"}))
	plan := decode[map[string]any](t, call(t, h, http.MethodPost, "/api/v1/plans", map[string]any{
		"name": "unlimited", "quota_bytes": 1000000, "duration_days": 30, "max_users": 0,
	}))
	_ = decode[subscriptionResponse](t, call(t, h, http.MethodPost, "/api/v1/customers/"+cust["id"].(string)+"/subscriptions", map[string]any{
		"plan_id": plan["id"].(string), "node_id": node["id"].(string),
	}))

	fake.mu.Lock()
	fake.activeUsers = 50
	fake.mu.Unlock()

	a.collectUsageOnce(context.Background())
	time.Sleep(100 * time.Millisecond)

	for _, ty := range sink.types() {
		if ty == webhook.EventUsersThreshold || ty == webhook.EventUsersLimitReached {
			t.Fatalf("unexpected user event for unlimited users plan: %s", ty)
		}
	}
}

func TestSubPageRendersUserCapacityAndCoreTypeBadge(t *testing.T) {
	const masterKey = "node-master"
	fake, srv := newFakeNode(masterKey, 5000)
	defer srv.Close()

	fake.mu.Lock()
	fake.inboundsJSON = `{"inbounds":[{"tag":"vless-reality","port":443},{"tag":"trojan","port":8443}]}`
	fake.activeUsers = 5
	fake.mu.Unlock()

	a := newTestAPI(t)
	h := a.Router()
	nodeID := registerTestNode(t, h, srv.URL, masterKey)

	cust := decode[map[string]any](t, call(t, h, http.MethodPost, "/api/v1/customers", map[string]any{"name": "test-buyer"}))
	customerID := cust["id"].(string)

	maxUsers := 10
	plan := decode[map[string]any](t, call(t, h, http.MethodPost, "/api/v1/plans", map[string]any{
		"name":             "Plan-Dedicated-Cap",
		"quota_bytes":      104857600,
		"duration_days":    30,
		"max_users":        maxUsers,
		"allowed_inbounds": []string{"vless-reality"},
		"core_type":        "dedicated",
	}))
	planID := plan["id"].(string)

	subResp := decode[subscriptionResponse](t, call(t, h, http.MethodPost, "/api/v1/customers/"+customerID+"/subscriptions", map[string]any{
		"plan_id": planID,
		"node_id": nodeID,
		"domains": []string{"sub1.example.com", "sub2.example.com"},
	}))

	subToken := subResp.Subscription.SubToken

	// 1. GET /sub/{token} HTML rendering
	req := httptest.NewRequest(http.MethodGet, "/sub/"+subToken, nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /sub/%s: %d body=%s", subToken, rec.Code, rec.Body.String())
	}
	html := rec.Body.String()

	// Verify core type badge
	if !strings.Contains(html, "هسته اختصاصی") {
		t.Errorf("HTML should contain core type badge 'هسته اختصاصی', got: %s", html)
	}

	// Verify user capacity info and progress meter
	if !strings.Contains(html, "ظرفیت کاربر: 5 / 10 کاربر") {
		t.Errorf("HTML should contain user capacity 'ظرفیت کاربر: 5 / 10 کاربر', got: %s", html)
	}
	if !strings.Contains(html, `width:50%`) {
		t.Errorf("HTML should contain user capacity progress meter width:50%%, got: %s", html)
	}

	// Verify filtered inbounds (should contain vless-reality, should not contain trojan)
	if !strings.Contains(html, "vless-reality") {
		t.Errorf("HTML should contain filtered inbound 'vless-reality', got: %s", html)
	}
	if strings.Contains(html, "trojan") {
		t.Errorf("HTML should NOT contain filtered-out inbound 'trojan', got: %s", html)
	}

	// Verify dedicated domains section
	if !strings.Contains(html, "sub1.example.com") {
		t.Errorf("HTML should contain dedicated domain 'sub1.example.com', got: %s", html)
	}
	if !strings.Contains(html, "دامنه‌های اختصاصی") {
		t.Errorf("HTML should contain 'دامنه‌های اختصاصی', got: %s", html)
	}

	// 2. GET /sub/{token}/info JSON endpoint
	infoReq := httptest.NewRequest(http.MethodGet, "/sub/"+subToken+"/info", nil)
	infoRec := httptest.NewRecorder()
	h.ServeHTTP(infoRec, infoReq)
	if infoRec.Code != http.StatusOK {
		t.Fatalf("GET /sub/%s/info: %d", subToken, infoRec.Code)
	}
	var info subInfoResponse
	if err := json.Unmarshal(infoRec.Body.Bytes(), &info); err != nil {
		t.Fatalf("unmarshal subInfoResponse: %v", err)
	}
	if info.ActiveUsers != 5 {
		t.Errorf("subInfo.ActiveUsers = %d, want 5", info.ActiveUsers)
	}
	if info.MaxUsers != 10 {
		t.Errorf("subInfo.MaxUsers = %d, want 10", info.MaxUsers)
	}
	if info.CoreType != "dedicated" {
		t.Errorf("subInfo.CoreType = %s, want dedicated", info.CoreType)
	}
	if len(info.Domains) != 2 || info.Domains[0] != "sub1.example.com" {
		t.Errorf("subInfo.Domains = %v, want [sub1.example.com sub2.example.com]", info.Domains)
	}

	// 3. GET /api/v1/subscriptions/{id}/connection JSON endpoint
	connRR := call(t, h, http.MethodGet, "/api/v1/subscriptions/"+subResp.Subscription.ID+"/connection", nil)
	if connRR.Code != http.StatusOK {
		t.Fatalf("GET connection: %d body=%s", connRR.Code, connRR.Body.String())
	}
	var connResp connectionInfoResponse
	if err := json.Unmarshal(connRR.Body.Bytes(), &connResp); err != nil {
		t.Fatalf("unmarshal connectionInfoResponse: %v", err)
	}
	if connResp.CoreType != "dedicated" {
		t.Errorf("connResp.CoreType = %s, want dedicated", connResp.CoreType)
	}
	if connResp.MaxUsers != 10 {
		t.Errorf("connResp.MaxUsers = %d, want 10", connResp.MaxUsers)
	}
	if connResp.ActiveUsers != 5 {
		t.Errorf("connResp.ActiveUsers = %d, want 5", connResp.ActiveUsers)
	}
	if len(connResp.Domains) != 2 || connResp.Domains[0] != "sub1.example.com" {
		t.Errorf("connResp.Domains = %v, want [sub1.example.com sub2.example.com]", connResp.Domains)
	}
}

func TestSubPageRendersSharedDefaultWithoutCapacityBar(t *testing.T) {
	const masterKey = "node-master"
	_, srv := newFakeNode(masterKey, 2000)
	defer srv.Close()

	a := newTestAPI(t)
	h := a.Router()
	nodeID := registerTestNode(t, h, srv.URL, masterKey)

	cust := decode[map[string]any](t, call(t, h, http.MethodPost, "/api/v1/customers", map[string]any{"name": "shared-buyer"}))
	plan := decode[map[string]any](t, call(t, h, http.MethodPost, "/api/v1/plans", map[string]any{
		"name":          "Plan-Shared-Unlimited",
		"quota_bytes":   104857600,
		"duration_days": 30,
	}))
	subResp := decode[subscriptionResponse](t, call(t, h, http.MethodPost, "/api/v1/customers/"+cust["id"].(string)+"/subscriptions", map[string]any{
		"plan_id": plan["id"].(string),
		"node_id": nodeID,
	}))

	req := httptest.NewRequest(http.MethodGet, "/sub/"+subResp.Subscription.SubToken, nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /sub: %d", rec.Code)
	}
	html := rec.Body.String()

	if !strings.Contains(html, "هسته اشتراکی") {
		t.Errorf("HTML should contain core type badge 'هسته اشتراکی', got: %s", html)
	}
	if strings.Contains(html, "ظرفیت کاربر:") {
		t.Errorf("HTML should NOT contain user capacity progress bar for max_users=0")
	}
	if strings.Contains(html, "دامنه‌های اختصاصی") {
		t.Errorf("HTML should NOT contain dedicated domains section when no domains exist")
	}
}

