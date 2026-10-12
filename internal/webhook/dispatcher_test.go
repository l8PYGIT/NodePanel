package webhook

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/pasarguard/panel/internal/domain"
)

func TestSubscribed(t *testing.T) {
	cases := []struct {
		events string
		event  string
		want   bool
	}{
		{"*", EventUsageOverQuota, true},
		{"", EventResumed, true},
		{"usage.threshold,usage.over_quota", EventUsageOverQuota, true},
		{"usage.threshold, subscription.suspended", EventSuspended, true},
		{"usage.threshold", EventUsageOverQuota, false},
		{"subscription.suspended", EventResumed, false},
		{"users.threshold,users.limit_reached", EventUsersThreshold, true},
		{"users.threshold,users.limit_reached", EventUsersLimitReached, true},
	}
	for _, c := range cases {
		if got := subscribed(c.events, c.event); got != c.want {
			t.Errorf("subscribed(%q, %q) = %v, want %v", c.events, c.event, got, c.want)
		}
	}
}

func TestSignDeterministic(t *testing.T) {
	body := []byte(`{"type":"x"}`)
	a := sign("secret", body)
	b := sign("secret", body)
	if a != b || a == "" {
		t.Fatalf("sign not deterministic: %q vs %q", a, b)
	}
	if sign("other", body) == a {
		t.Fatal("different secret produced same signature")
	}
}

func TestUserThresholdConstantsAndSubscription(t *testing.T) {
	if EventUsersThreshold != "users.threshold" {
		t.Fatalf("EventUsersThreshold = %q, want users.threshold", EventUsersThreshold)
	}
	if EventUsersLimitReached != "users.limit_reached" {
		t.Fatalf("EventUsersLimitReached = %q, want users.limit_reached", EventUsersLimitReached)
	}
	foundThreshold := false
	foundLimit := false
	for _, e := range KnownEvents {
		if e == EventUsersThreshold {
			foundThreshold = true
		}
		if e == EventUsersLimitReached {
			foundLimit = true
		}
	}
	if !foundThreshold || !foundLimit {
		t.Fatalf("KnownEvents missing user events: %v", KnownEvents)
	}
}

type fakeWebhookStore struct {
	mu         sync.Mutex
	endpoints  []domain.WebhookEndpoint
	deliveries []map[string]any
}

func (f *fakeWebhookStore) ListActiveWebhooks() ([]domain.WebhookEndpoint, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.endpoints, nil
}

func (f *fakeWebhookStore) RecordWebhookDelivery(endpointID, event, payload, status string, attempts int) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.deliveries = append(f.deliveries, map[string]any{
		"endpoint_id": endpointID,
		"event":       event,
		"payload":     payload,
		"status":      status,
		"attempts":    attempts,
	})
	return nil
}

func TestUserThresholdEventEmitted(t *testing.T) {
	var received []Envelope
	var mu sync.Mutex
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var env Envelope
		_ = json.NewDecoder(r.Body).Decode(&env)
		mu.Lock()
		received = append(received, env)
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	st := &fakeWebhookStore{
		endpoints: []domain.WebhookEndpoint{
			{
				ID:     "ep-1",
				URL:    srv.URL,
				Secret: "sec",
				Events: "*",
			},
		},
	}
	d := NewDispatcher(st)
	d.Emit(context.Background(), EventUsersThreshold, map[string]any{"active_users": 8, "threshold": 80})
	d.Emit(context.Background(), EventUsersLimitReached, map[string]any{"active_users": 10, "threshold": 100})

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		n := len(received)
		mu.Unlock()
		if n >= 2 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(received) != 2 {
		t.Fatalf("expected 2 received events, got %d", len(received))
	}
	if received[0].Type != EventUsersThreshold {
		t.Errorf("first event type = %q, want %q", received[0].Type, EventUsersThreshold)
	}
	if received[1].Type != EventUsersLimitReached {
		t.Errorf("second event type = %q, want %q", received[1].Type, EventUsersLimitReached)
	}
}
