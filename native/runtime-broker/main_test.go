package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

const testToken = "test-token-abc123"

func TestHealthReportsBrokerContract(t *testing.T) {
	recorder := httptest.NewRecorder()
	newAuthenticatedBroker(testToken).health(recorder, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}
	var payload map[string]any
	if err := json.NewDecoder(recorder.Body).Decode(&payload); err != nil {
		t.Fatalf("decode health response: %v", err)
	}
	if payload["status"] != "ok" {
		t.Fatalf("expected ok status, got %v", payload["status"])
	}
	if payload["processControl"] != true {
		t.Fatalf("expected processControl true when a token is configured, got %v", payload["processControl"])
	}
}

func TestHealthReportsProcessControlDisabledWithoutToken(t *testing.T) {
	recorder := httptest.NewRecorder()
	newBroker().health(recorder, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	var payload map[string]any
	if err := json.NewDecoder(recorder.Body).Decode(&payload); err != nil {
		t.Fatalf("decode health response: %v", err)
	}
	if payload["processControl"] != false {
		t.Fatalf("expected processControl false without a token, got %v", payload["processControl"])
	}
}

func TestStartRejectsUnsafeProcessID(t *testing.T) {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/processes", strings.NewReader(`{"id":"../escape","executable":"ignored"}`))
	newAuthenticatedBroker(testToken).startProcess(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", recorder.Code)
	}
}

func TestProcessRouteRejectsUnknownShape(t *testing.T) {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/processes/one/two", nil)
	newAuthenticatedBroker(testToken).processRoute(recorder, request)

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", recorder.Code)
	}
}

/* ---------------------------------------------------------------- */
/* Authorization — /v1/processes starts arbitrary local processes,   */
/* so it must fail closed.                                           */
/* ---------------------------------------------------------------- */

func TestAuthorizeRejectsMissingToken(t *testing.T) {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/processes", nil)

	if newAuthenticatedBroker(testToken).authorize(recorder, request) {
		t.Fatal("expected authorize to reject a request with no token")
	}
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", recorder.Code)
	}
	if recorder.Header().Get("WWW-Authenticate") == "" {
		t.Fatal("expected a WWW-Authenticate challenge")
	}
}

func TestAuthorizeRejectsWrongToken(t *testing.T) {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/processes", nil)
	request.Header.Set("Authorization", "Bearer wrong-token")

	if newAuthenticatedBroker(testToken).authorize(recorder, request) {
		t.Fatal("expected authorize to reject a wrong token")
	}
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", recorder.Code)
	}
}

func TestAuthorizeAcceptsBearerToken(t *testing.T) {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/processes", nil)
	request.Header.Set("Authorization", "Bearer "+testToken)

	if !newAuthenticatedBroker(testToken).authorize(recorder, request) {
		t.Fatalf("expected authorize to accept the configured token, got %d", recorder.Code)
	}
}

func TestAuthorizeAcceptsBearerTokenCaseInsensitiveScheme(t *testing.T) {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/processes", nil)
	request.Header.Set("Authorization", "bearer "+testToken)

	if !newAuthenticatedBroker(testToken).authorize(recorder, request) {
		t.Fatalf("expected a lowercase bearer scheme to be accepted, got %d", recorder.Code)
	}
}

func TestAuthorizeAcceptsCustomHeader(t *testing.T) {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/processes", nil)
	request.Header.Set("X-Xeo-Runtime-Token", testToken)

	if !newAuthenticatedBroker(testToken).authorize(recorder, request) {
		t.Fatalf("expected the custom header to be accepted, got %d", recorder.Code)
	}
}

func TestAuthorizeFailsClosedWithoutConfiguredToken(t *testing.T) {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/processes", nil)
	request.Header.Set("Authorization", "Bearer anything")

	if newBroker().authorize(recorder, request) {
		t.Fatal("expected process control to be disabled when no token is configured")
	}
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", recorder.Code)
	}
}

/* ---------------------------------------------------------------- */
/* Bind address — must stay on loopback unless explicitly opted out. */
/* ---------------------------------------------------------------- */

func TestIsLoopbackAddr(t *testing.T) {
	loopback := []string{"127.0.0.1:4317", "localhost:4317", "[::1]:4317", "127.0.0.1"}
	for _, addr := range loopback {
		if !isLoopbackAddr(addr) {
			t.Fatalf("expected %q to be loopback", addr)
		}
	}

	public := []string{":4317", "0.0.0.0:4317", "[::]:4317", "192.168.1.10:4317", "10.0.0.5:4317", ""}
	for _, addr := range public {
		if isLoopbackAddr(addr) {
			t.Fatalf("expected %q to NOT be loopback", addr)
		}
	}
}

func TestResolveAddrDefaultsToLoopback(t *testing.T) {
	t.Setenv("XEO_RUNTIME_ADDR", "")
	t.Setenv("XEO_RUNTIME_ALLOW_PUBLIC", "")

	addr, err := resolveAddr()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if addr != defaultAddr {
		t.Fatalf("expected default %q, got %q", defaultAddr, addr)
	}
	if !isLoopbackAddr(addr) {
		t.Fatalf("default address %q must be loopback", addr)
	}
}

func TestResolveAddrRefusesWildcardBind(t *testing.T) {
	t.Setenv("XEO_RUNTIME_ADDR", ":4317")
	t.Setenv("XEO_RUNTIME_ALLOW_PUBLIC", "")

	if _, err := resolveAddr(); err == nil {
		t.Fatal("expected a wildcard bind to be refused")
	}
}

func TestResolveAddrAllowsExplicitPublicOptIn(t *testing.T) {
	t.Setenv("XEO_RUNTIME_ADDR", "0.0.0.0:4317")
	t.Setenv("XEO_RUNTIME_ALLOW_PUBLIC", "1")

	addr, err := resolveAddr()
	if err != nil {
		t.Fatalf("unexpected error with explicit opt-in: %v", err)
	}
	if addr != "0.0.0.0:4317" {
		t.Fatalf("expected the requested address, got %q", addr)
	}
}

func TestResolveAddrHonorsCustomLoopbackPort(t *testing.T) {
	t.Setenv("XEO_RUNTIME_ADDR", "127.0.0.1:9999")
	if err := os.Unsetenv("XEO_RUNTIME_ALLOW_PUBLIC"); err != nil {
		t.Fatalf("unset env: %v", err)
	}

	addr, err := resolveAddr()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if addr != "127.0.0.1:9999" {
		t.Fatalf("expected 127.0.0.1:9999, got %q", addr)
	}
}
