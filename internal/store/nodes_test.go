package store

import (
	"path/filepath"
	"testing"

	"github.com/pasarguard/panel/internal/domain"
)

func openTestStore(t *testing.T) *Store {
	t.Helper()
	st, err := Open(filepath.Join(t.TempDir(), "panel.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return st
}

func TestNodeHostInfoRoundTrip(t *testing.T) {
	st := openTestStore(t)
	n, err := st.CreateNode("n1", "https://1.2.3.4:8090", "mk", "", "", 62050, "", "SNI: example.com")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if n.HostInfo != "SNI: example.com" {
		t.Fatalf("HostInfo = %q", n.HostInfo)
	}
	got, err := st.GetNode(n.ID)
	if err != nil || got.HostInfo != "SNI: example.com" {
		t.Fatalf("GetNode HostInfo = %q err=%v", got.HostInfo, err)
	}
	if err := st.SetNodeHostInfo(n.ID, "new host"); err != nil {
		t.Fatalf("SetNodeHostInfo: %v", err)
	}
	got, _ = st.GetNode(n.ID)
	if got.HostInfo != "new host" {
		t.Fatalf("after set HostInfo = %q", got.HostInfo)
	}
}

func TestExtendedPlanAndSubscriptionFields(t *testing.T) {
	st := openTestStore(t)

	plan, err := st.CreatePlanExtended("Pro", 1000, 30, 50, []string{"vless-reality"}, "dedicated", 2, 20)
	if err != nil {
		t.Fatalf("CreatePlanExtended: %v", err)
	}
	if plan.MaxUsers != 50 || plan.CoreType != "dedicated" || len(plan.AllowedInbounds) != 1 {
		t.Fatalf("unexpected plan values: %+v", plan)
	}
	if plan.AllowedInbounds[0] != "vless-reality" || plan.MaxIPs != 2 || plan.SpeedLimitMbps != 20 {
		t.Fatalf("unexpected plan bounds/ips/speed: %+v", plan)
	}

	gotPlan, err := st.GetPlan(plan.ID)
	if err != nil {
		t.Fatalf("GetPlan: %v", err)
	}
	if gotPlan.CoreType != "dedicated" || gotPlan.MaxUsers != 50 || len(gotPlan.AllowedInbounds) != 1 || gotPlan.MaxIPs != 2 || gotPlan.SpeedLimitMbps != 20 {
		t.Fatalf("GetPlan round-trip mismatch: %+v", gotPlan)
	}

	plans, err := st.ListPlans()
	if err != nil {
		t.Fatalf("ListPlans: %v", err)
	}
	if len(plans) == 0 || plans[0].CoreType != "dedicated" || len(plans[0].AllowedInbounds) != 1 {
		t.Fatalf("ListPlans round-trip mismatch: %+v", plans)
	}

	cust, err := st.CreateCustomer("cust1", "")
	if err != nil {
		t.Fatalf("CreateCustomer: %v", err)
	}
	sub := &domain.Subscription{
		CustomerID:             cust.ID,
		PlanID:                 plan.ID,
		StartAt:                100,
		EndAt:                  200,
		QuotaBytes:             1000,
		AllowedInbounds:        []string{"vless-reality", "vmess-ws"},
		MaxUsers:               25,
		CoreType:               "dedicated",
		MaxIPs:                 3,
		SpeedLimitMbps:         15,
		Domains:                []string{"sub.example.com"},
		NotifiedUsersThreshold: 80,
	}
	if err := st.CreateSubscription(sub); err != nil {
		t.Fatalf("CreateSubscription: %v", err)
	}
	gotSub, err := st.GetSubscription(sub.ID)
	if err != nil {
		t.Fatalf("GetSubscription: %v", err)
	}
	if gotSub.MaxUsers != 25 || gotSub.CoreType != "dedicated" || len(gotSub.AllowedInbounds) != 2 || gotSub.MaxIPs != 3 || gotSub.SpeedLimitMbps != 15 || len(gotSub.Domains) != 1 || gotSub.NotifiedUsersThreshold != 80 {
		t.Fatalf("GetSubscription round-trip mismatch: %+v", gotSub)
	}

	subs, err := st.ListSubscriptions()
	if err != nil {
		t.Fatalf("ListSubscriptions: %v", err)
	}
	if len(subs) == 0 || subs[0].MaxUsers != 25 || subs[0].CoreType != "dedicated" || len(subs[0].AllowedInbounds) != 2 {
		t.Fatalf("ListSubscriptions mismatch: %+v", subs)
	}

	sub2 := &domain.Subscription{
		CustomerID:             cust.ID,
		PlanID:                 plan.ID,
		NodeTenantID:           "tenant-1",
		Status:                 "active",
		StartAt:                100,
		EndAt:                  200,
		QuotaBytes:             1000,
		AllowedInbounds:        []string{"vless-reality"},
		MaxUsers:               25,
		CoreType:               "dedicated",
		MaxIPs:                 3,
		SpeedLimitMbps:         15,
		Domains:                []string{"sub.example.com"},
		NotifiedUsersThreshold: 80,
	}
	if err := st.CreateSubscription(sub2); err != nil {
		t.Fatalf("CreateSubscription 2: %v", err)
	}
	activeSubs, err := st.ListActiveSubscriptions()
	if err != nil {
		t.Fatalf("ListActiveSubscriptions: %v", err)
	}
	if len(activeSubs) == 0 || activeSubs[0].MaxUsers != 25 || activeSubs[0].CoreType != "dedicated" {
		t.Fatalf("ListActiveSubscriptions mismatch: %+v", activeSubs)
	}
}

func TestMigrationAddsExtendedColumns(t *testing.T) {
	// Create database with legacy schema missing the new columns
	dbPath := filepath.Join(t.TempDir(), "legacy.db")
	db, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	// Verify columns exist on plans and subscriptions
	plan, err := db.CreatePlan("Basic", 500, 10, 5)
	if err != nil {
		t.Fatalf("CreatePlan: %v", err)
	}
	if plan.CoreType != "shared" || len(plan.AllowedInbounds) != 0 {
		t.Fatalf("expected defaults on legacy plan: %+v", plan)
	}
}

