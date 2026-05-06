# CHANGE LOGS (Developer-facing)

---

## [Unreleased] — 2026-05-06

### Added

- Added deploy-code container/service control APIs for listing containers/services, start/stop/restart/rebuild, logs, and inspect operations.
- Added `.env` allowlist controls: `DOCKER_DEPLOY_CODE_SERVICE_ALLOWLIST`, `DOCKER_DEPLOY_CODE_CONTAINER_ALLOWLIST`, and `DOCKER_DEPLOY_CODE_CONTAINER_ALLOW_ALL`.
- Added Deploy Code UI controls in Settings for listing containers, running actions, rebuilding services, and viewing logs.

### Changed

- Moved the optional `deploy-code` sidecar service out of `compose.apps.yml` into the dedicated `docker-compose/compose.deploy.yml` layer.
- Updated `dc.sh` and compose validation to load `docker-compose/compose.deploy.yml` while keeping the sidecar gated by the `deploy-code` profile / `DOCKER_DEPLOY_CODE_ENABLED=true`.
- Updated deploy-code documentation and env comments to reflect the separated compose layer.

---

## [2.0.2] — 2026-05-04

### Added

- Added a `reload` action in the footer that uses the same force-reload/cache-clear logic as the existing `Force app reload` button in Settings.

### Changed

- Shared force-reload binding through `data-force-reload-app` so both Settings and footer reload buttons execute the same implementation and are disabled together during reload.
- Bumped `main.js`, `main.css`, `layout.css`, `responsive.css`, and service worker cache versions to avoid stale footer behavior.

---

## [2.0.1] — 2026-05-04

### Added

- Added protected `GET /api/runner-env` endpoint to return the current backend environment variables whose names start with `_DOTENVRTDB_RUNNER`, sorted by key.
- Added a `runner env` footer button and modal so operators can inspect the active runner/host metadata from the UI.

### Changed

- Reworked the mobile footer layout to keep backend status visible inside the existing `--footer-height` without increasing workspace usage.
- Bumped static asset cache/version query strings for `main.css`, `layout.css`, `components.css`, `responsive.css`, `main.js`, and service worker cache name to avoid stale mobile UI assets.

---

## [2.0.0] — 2026-04-09

### Breaking Changes

- `docker-compose.yml` split into 4 module files — must use `docker-compose/scripts/dc.sh` (or `-f docker-compose/compose.core.yml -f docker-compose/compose.ops.yml -f docker-compose/compose.access.yml -f compose.apps.yml`) instead of plain `docker compose`
- Env var renames: `DOMAIN` replaces individual `SUBDOMAIN_*` vars; `PROJECT_NAME` is the compose project/network prefix (required)
- `TAILSCALE_CLIENT_SECRET` → `TAILSCALE_AUTHKEY` (standardised Tailscale env naming)
- `APP_PORT` now drives the app container port directly; `SUBDOMAIN_APP`, `SUBDOMAIN_DOZZLE`, etc. removed

### Added

- **`docker-compose/scripts/dc.sh`** — main orchestrator: loads `.env`, reads `ENABLE_*` flags, builds `--profile` args, calls the configured compose layer files in one command
- **`docker-compose/compose.core.yml`** — caddy + cloudflared, network + volumes definition; always-on
- **`docker-compose/compose.ops.yml`** — dozzle, filebrowser, webssh, webssh-windows; all profile-gated
- **`docker-compose/compose.access.yml`** — tailscale-linux, tailscale-windows; profile-gated
- **`compose.apps.yml`** — parameterised app service (`APP_IMAGE` + `APP_PORT`)
- **`docker-compose/scripts/up.sh` / `docker-compose/scripts/down.sh` / `docker-compose/scripts/logs.sh`** — one-liner shortcuts wrapping `dc.sh`
- **`docker-compose/scripts/validate-env.js`** — checks required vars, format validation (bcrypt, domain, port), subdomain preview
- **`docker-compose/scripts/validate-ts.js`** — Tailscale auth key format check + optional expiry lookup via TS API
- **`docker-compose/scripts/validate-compose.js`** — runs `docker compose config` across the configured compose layer files to catch YAML errors
- **`npm run dockerapp-validate:all`** — combined validation pipeline (env → compose → TS)
- **`docs/DEPLOY.md`** — full deployment guide with mermaid flow diagrams, use cases, security checklist
- Subdomain auto-convention: all routes derived from `${PROJECT_NAME}.${DOMAIN}` pattern
- `DC_VERBOSE=1` debug flag for `docker-compose/scripts/dc.sh`
- `HEALTH_PATH` env to customise healthcheck endpoint per image

### Changed

- Image versions pinned (caddy `2.9.1-alpine`, cloudflared `2025.1.0`, dozzle `v8.x`, filebrowser `v2.30.0`, tailscale `stable`)
- Caddy `CADDY_INGRESS_NETWORKS` now uses `${PROJECT_NAME}_net` (was `app_net`)
- Network name: `${PROJECT_NAME:-mystack}_net` (dynamic, avoids conflicts between stacks)
- GitHub Actions and Azure Pipelines updated to call `docker-compose/scripts/dc.sh up` instead of bare `docker compose up`
- `detect-os.sh` no longer writes `COMPOSE_PROFILES` (profiles now fully managed by `docker-compose/scripts/dc.sh`)
- `.env.example` fully rewritten to match new schema

### Removed

- Monolithic `docker-compose.yml` (replaced by 4 module files)
- `SUBDOMAIN_APP`, `SUBDOMAIN_DOZZLE`, `SUBDOMAIN_FILEBROWSER`, `SUBDOMAIN_WEBSSH` env vars
- `TAILSCALE_CLIENT_SECRET` (use `TAILSCALE_AUTHKEY`)
- Hardcoded `build: ./services/app` in compose (now `APP_IMAGE` param)
- `scripts/generate-cf-config.js` and the generated-config workflow (maintain `cloudflared/config.yml` manually)

---
