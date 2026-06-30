# Molibot Makefile
#
# Convenience wrappers around the npm scripts. Run `make` (or `make help`) to
# list the available targets.

DESKTOP_DMG_DIR := apps/desktop/src-tauri/target/release/bundle/dmg
# Data directory holding the singleton service lock/state. Override with
# `make kill-orphans DATA_DIR=~/.molibot-web` if you use a non-default one.
DATA_DIR ?= $(HOME)/.molibot

.DEFAULT_GOAL := help

.PHONY: help
help: ## List available targets
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

.PHONY: dmg
dmg: ## Build the macOS desktop .dmg installer (runtime prep + tauri build + finalize)
	npm run desktop:build
	@echo ""
	@echo "DMG ready:"
	@ls -lh $(DESKTOP_DMG_DIR)/*.dmg 2>/dev/null || echo "  (no .dmg found in $(DESKTOP_DMG_DIR))"

.PHONY: desktop-dev
desktop-dev: ## Run the desktop app in dev mode (tauri dev)
	npm run desktop:dev

.PHONY: desktop-check
desktop-check: ## Type-check the desktop frontend (svelte-check)
	npm run desktop:check

.PHONY: kill-orphans
kill-orphans: ## Kill orphaned Molibot server processes and clear the stale service lock
	@echo "Looking for orphaned Molibot server / leftover dev processes..."
	@pids=$$(ps -axo pid,command | grep -E 'start-server\.mjs|molipibot/node_modules/\.bin/vite dev' | grep -v grep | awk '{print $$1}'); \
	if [ -n "$$pids" ]; then \
		echo "  killing PIDs: $$(echo $$pids | tr '\n' ' ')"; \
		echo "$$pids" | xargs -n1 kill -9 2>/dev/null || true; \
	else \
		echo "  none found"; \
	fi
	@if [ -f "$(DATA_DIR)/runtime/service.lock" ]; then \
		rm -f "$(DATA_DIR)/runtime/service.lock" && echo "Removed stale lock: $(DATA_DIR)/runtime/service.lock"; \
	else \
		echo "No stale lock at $(DATA_DIR)/runtime/service.lock"; \
	fi
	@echo "Done. Quit Molibot if it is open, then relaunch it."
