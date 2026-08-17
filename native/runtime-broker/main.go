package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
)

const brokerVersion = "0.1.0"

var processIDPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$`)

type managedProcess struct {
	ID         string
	Executable string
	Args       []string
	WorkingDir string
	PID        int
	State      string
	ExitCode   *int
	StartedAt  time.Time
	EndedAt    *time.Time
	Process    *os.Process
}

type processSummary struct {
	ID         string     `json:"id"`
	Executable string     `json:"executable"`
	Args       []string   `json:"args,omitempty"`
	WorkingDir string     `json:"workingDir,omitempty"`
	PID        int        `json:"pid,omitempty"`
	State      string     `json:"state"`
	ExitCode   *int       `json:"exitCode,omitempty"`
	StartedAt  time.Time  `json:"startedAt"`
	EndedAt    *time.Time `json:"endedAt,omitempty"`
}

type broker struct {
	mu        sync.Mutex
	processes map[string]*managedProcess
}

type startRequest struct {
	ID         string            `json:"id"`
	Executable string            `json:"executable"`
	Args       []string          `json:"args"`
	WorkingDir string            `json:"workingDir"`
	Env        map[string]string `json:"env"`
}

type errorResponse struct {
	Error string `json:"error"`
}

func newBroker() *broker {
	return &broker{processes: make(map[string]*managedProcess)}
}

func (b *broker) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"service":      "xeo-forge-runtime-broker",
		"version":      brokerVersion,
		"status":       "ok",
		"platform":     fmt.Sprintf("%s/%s", runtime.GOOS, runtime.GOARCH),
		"capabilities": []string{"process-supervision", "local-runtime", "health-checks"},
	})
}

func (b *broker) list(w http.ResponseWriter, _ *http.Request) {
	b.mu.Lock()
	defer b.mu.Unlock()
	items := make([]processSummary, 0, len(b.processes))
	for _, p := range b.processes {
		items = append(items, summaryOf(p))
	}
	writeJSON(w, http.StatusOK, map[string]any{"processes": items})
}

func (b *broker) processRoute(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) != 3 || parts[0] != "v1" || parts[1] != "processes" || parts[2] == "" {
		writeError(w, http.StatusNotFound, "process not found")
		return
	}
	id := parts[2]

	switch r.Method {
	case http.MethodGet:
		b.getProcess(w, id)
	case http.MethodPost:
		b.stopProcess(w, id)
	default:
		w.Header().Set("Allow", "GET, POST")
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (b *broker) startProcess(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var req startRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 128<<10)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON request")
		return
	}
	if !processIDPattern.MatchString(req.ID) {
		writeError(w, http.StatusBadRequest, "id must be 1-64 characters using letters, numbers, dot, underscore, or hyphen")
		return
	}
	if strings.TrimSpace(req.Executable) == "" {
		writeError(w, http.StatusBadRequest, "executable is required")
		return
	}

	b.mu.Lock()
	if existing, ok := b.processes[req.ID]; ok && existing.State == "running" {
		b.mu.Unlock()
		writeError(w, http.StatusConflict, "a process with this id is already running")
		return
	}
	b.mu.Unlock()

	cmd := exec.Command(req.Executable, req.Args...)
	cmd.Dir = req.WorkingDir
	if len(req.Env) > 0 {
		env := os.Environ()
		for key, value := range req.Env {
			env = append(env, key+"="+value)
		}
		cmd.Env = env
	}
	if err := cmd.Start(); err != nil {
		writeError(w, http.StatusBadGateway, "could not start process: "+err.Error())
		return
	}

	managed := &managedProcess{
		ID:         req.ID,
		Executable: req.Executable,
		Args:       append([]string(nil), req.Args...),
		WorkingDir: req.WorkingDir,
		PID:        cmd.Process.Pid,
		State:      "running",
		StartedAt:  time.Now().UTC(),
		Process:    cmd.Process,
	}
	b.mu.Lock()
	b.processes[req.ID] = managed
	b.mu.Unlock()

	go b.waitFor(req.ID, cmd)
	writeJSON(w, http.StatusAccepted, summaryOf(managed))
}

func (b *broker) waitFor(id string, cmd *exec.Cmd) {
	err := cmd.Wait()
	now := time.Now().UTC()
	b.mu.Lock()
	defer b.mu.Unlock()
	p, ok := b.processes[id]
	if !ok {
		return
	}
	p.State = "exited"
	p.EndedAt = &now
	if err == nil {
		code := 0
		p.ExitCode = &code
		return
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		code := exitErr.ExitCode()
		p.ExitCode = &code
	}
}

func (b *broker) getProcess(w http.ResponseWriter, id string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	p, ok := b.processes[id]
	if !ok {
		writeError(w, http.StatusNotFound, "process not found")
		return
	}
	writeJSON(w, http.StatusOK, summaryOf(p))
}

func (b *broker) stopProcess(w http.ResponseWriter, id string) {
	b.mu.Lock()
	p, ok := b.processes[id]
	b.mu.Unlock()
	if !ok {
		writeError(w, http.StatusNotFound, "process not found")
		return
	}
	if p.State != "running" || p.Process == nil {
		writeJSON(w, http.StatusOK, summaryOf(p))
		return
	}
	if err := p.Process.Kill(); err != nil && !errors.Is(err, syscall.ESRCH) {
		writeError(w, http.StatusConflict, "could not stop process: "+err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "stopping", "id": id})
}

func (b *broker) shutdown() {
	b.mu.Lock()
	defer b.mu.Unlock()
	for _, p := range b.processes {
		if p.State == "running" && p.Process != nil {
			_ = p.Process.Kill()
		}
	}
}

func summaryOf(p *managedProcess) processSummary {
	return processSummary{ID: p.ID, Executable: p.Executable, Args: p.Args, WorkingDir: p.WorkingDir, PID: p.PID, State: p.State, ExitCode: p.ExitCode, StartedAt: p.StartedAt, EndedAt: p.EndedAt}
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, errorResponse{Error: message})
}

func main() {
	addr := ":4317"
	if value := os.Getenv("XEO_RUNTIME_ADDR"); value != "" {
		addr = value
	}
	b := newBroker()
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", b.health)
	mux.HandleFunc("/v1/processes", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/processes" {
			b.processRoute(w, r)
			return
		}
		if r.Method == http.MethodPost {
			b.startProcess(w, r)
			return
		}
		b.list(w, r)
	})

	server := &http.Server{Addr: addr, Handler: logging(mux), ReadHeaderTimeout: 5 * time.Second}
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-stop
		b.shutdown()
		_ = server.Shutdown(context.Background())
	}()

	fmt.Printf("xeo-forge-runtime-broker %s listening on %s\n", brokerVersion, addr)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		next.ServeHTTP(w, r)
		fmt.Printf("%s %s %s\n", time.Since(started).Round(time.Millisecond), r.Method, r.URL.Path)
	})
}
