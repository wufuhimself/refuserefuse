BACKEND_DIR  = backend
FRONTEND_DIR = frontend
VENV         = $(CURDIR)/$(BACKEND_DIR)/venv/bin

BACKEND_PID  = $(CURDIR)/.backend.pid
FRONTEND_PID = $(CURDIR)/.frontend.pid

BACKEND_LOG  = $(CURDIR)/.backend.log
FRONTEND_LOG = $(CURDIR)/.frontend.log

.PHONY: start stop restart backend frontend logs logs-backend logs-frontend status install

# ── Helpers ───────────────────────────────────────────────────────────────────
# Kill a PID and all its children, then remove the PID file
define kill_pid
	if [ -f $(1) ]; then \
		PID=$$(cat $(1)); \
		if kill -0 $$PID 2>/dev/null; then \
			pkill -TERM -P $$PID 2>/dev/null; kill $$PID 2>/dev/null; \
			echo "✓ $(2) stopped (pid $$PID)"; \
		else \
			echo "$(2) was not running"; \
		fi; \
		rm -f $(1); \
	else \
		echo "No PID file for $(2)"; \
	fi
endef

# ── Start both servers ─────────────────────────────────────────────────────────
start: backend frontend
	@echo "✓ All servers running. Use 'make stop' to shut them down."

# ── Stop both servers ──────────────────────────────────────────────────────────
stop:
	@$(call kill_pid,$(BACKEND_PID),Backend)
	@$(call kill_pid,$(FRONTEND_PID),Frontend)

restart: stop start

# ── Backend (FastAPI / uvicorn) ────────────────────────────────────────────────
backend:
	@if [ -f $(BACKEND_PID) ] && kill -0 $$(cat $(BACKEND_PID)) 2>/dev/null; then \
		echo "Backend already running (pid $$(cat $(BACKEND_PID)))"; \
	else \
		cd $(BACKEND_DIR) && \
		$(VENV)/python -m uvicorn main:app --port 8000 \
			> $(BACKEND_LOG) 2>&1 & \
		echo $$! > $(BACKEND_PID); \
		echo "✓ Backend started on http://localhost:8000  (log: .backend.log)"; \
	fi

# ── Frontend (Vite) ────────────────────────────────────────────────────────────
frontend:
	@if [ -f $(FRONTEND_PID) ] && kill -0 $$(cat $(FRONTEND_PID)) 2>/dev/null; then \
		echo "Frontend already running (pid $$(cat $(FRONTEND_PID)))"; \
	else \
		cd $(FRONTEND_DIR) && \
		npm run dev -- --port 5173 \
			> $(FRONTEND_LOG) 2>&1 & \
		echo $$! > $(FRONTEND_PID); \
		echo "✓ Frontend started on http://localhost:5173  (log: .frontend.log)"; \
	fi

# ── Tail logs ─────────────────────────────────────────────────────────────────
logs:
	@tail -f $(BACKEND_LOG) $(FRONTEND_LOG)

logs-backend:
	@tail -f $(BACKEND_LOG)

logs-frontend:
	@tail -f $(FRONTEND_LOG)

# ── Status ────────────────────────────────────────────────────────────────────
status:
	@echo "--- Backend ---"
	@if [ -f $(BACKEND_PID) ] && kill -0 $$(cat $(BACKEND_PID)) 2>/dev/null; then \
		echo "  Running (pid $$(cat $(BACKEND_PID)))"; \
	else \
		echo "  Stopped"; \
	fi
	@echo "--- Frontend ---"
	@if [ -f $(FRONTEND_PID) ] && kill -0 $$(cat $(FRONTEND_PID)) 2>/dev/null; then \
		echo "  Running (pid $$(cat $(FRONTEND_PID)))"; \
	else \
		echo "  Stopped"; \
	fi

# ── Install dependencies ──────────────────────────────────────────────────────
install:
	@echo "Setting up Python venv..."
	@cd $(BACKEND_DIR) && python3 -m venv venv && $(VENV)/pip install -r requirements.txt
	@echo "Installing frontend packages..."
	@cd $(FRONTEND_DIR) && npm install
	@echo "✓ Done"
