# deploy.md

Tài liệu triển khai chuẩn theo **codebase hiện tại**.

## 1) Luồng triển khai chuẩn

1. Chuẩn bị `.env` (không dựa mù quáng vào `.env.example`).
2. Cấu hình Cloudflare Tunnel (`cloudflared/config.yml` + `credentials.json`).
3. Validate môi trường bằng script `docker-compose/scripts/validate-env.js`.
4. Deploy bằng `dc.sh` (qua npm scripts).
5. Kiểm tra health, logs, route công khai và route nội bộ.

## 2) Compose layers

### Core
- `docker-compose/compose.core.yml`
- Chứa `caddy` + `cloudflared`.
- Luôn được nạp.

### Ops
- `docker-compose/compose.ops.yml`
- `dozzle`, `filebrowser`, `rclone-manager-gui`, `webssh`, `webssh-windows`.
- Bật/tắt qua `ENABLE_DOZZLE`, `ENABLE_FILEBROWSER`, `RCLONE_MANAGER_GUI_ENABLED`, `ENABLE_WEBSSH`.

### Access
- `docker-compose/compose.access.yml`
- `tailscale-linux`, `tailscale-windows`, keep-ip prepare/backup loops.
- Bật/tắt qua `ENABLE_TAILSCALE`.

### Apps
- `compose.apps.yml`
- Chỉ chứa service `app` mặc định build từ `services/app`.
- Không đặt sidecar deploy/update trong file này để tránh coupling với app layer.

### Deploy Code
- `docker-compose/compose.deploy.yml`
- Chứa service `deploy-code` là sidecar optional.
- Bật bằng `DOCKER_DEPLOY_CODE_ENABLED=true`, dùng để Git/ZIP deploy, rebuild/restart đúng service đã cấu hình và điều khiển container/service qua allowlist.

## 3) Các env bắt buộc (hard-stop)

Các biến dưới đây nếu thiếu/sai sẽ **dừng deploy** ở bước validate:

- `PROJECT_NAME`
- `DOMAIN`
- `CADDY_EMAIL`
- `CADDY_AUTH_USER`
- `CADDY_AUTH_HASH` (bcrypt)
- `APP_PORT`

Thêm nữa, do mount bắt buộc trong `cloudflared`:

- `cloudflared/config.yml` phải tồn tại.
- `cloudflared/credentials.json` phải tồn tại.

Nếu `ENABLE_TAILSCALE=true`, bắt buộc thêm:

- `TAILSCALE_AUTHKEY`
- `TAILSCALE_TAILNET_DOMAIN`

Nếu `TAILSCALE_KEEP_IP_ENABLE=true`, bắt buộc thêm:

- `TAILSCALE_KEEP_IP_FIREBASE_URL` (https + kết thúc `.json`).

Nếu `TAILSCALE_KEEP_IP_REMOVE_HOSTNAME_ENABLE=true`, bắt buộc thêm:

- `TAILSCALE_CLIENTID`
- `TAILSCALE_AUTHKEY` theo format `tskey-client-...`

## 4) Các env optional nhưng nên cấu hình

- `APP_HOST_PORT`: mở truy cập localhost trực tiếp.
- `NODE_ENV`: mặc định `production`.
- `HEALTH_PATH`: mặc định `/health`.
- `DOCKER_SOCK`: đường dẫn docker socket nếu khác mặc định.
- `TAILSCALE_TAGS`: mặc định `tag:container`.
- `TAILSCALE_KEEP_IP_INTERVAL_SEC`: mặc định `30`.
- `CUR_WHOAMI`, `CUR_WORK_DIR`, `SHELL`: hỗ trợ webssh Linux thân thiện hơn.
- `DOZZLE_HOST_PORT` (default `18080`): cổng localhost cho Dozzle.
- `FILEBROWSER_HOST_PORT` (default `18081`): cổng localhost cho Filebrowser.
- `RCLONE_MANAGER_GUI_HOST_PORT` (default `5572`): cổng localhost cho rclone built-in GUI.
- `RCLONE_MANAGER_GUI_PUBLIC_URL`, `RCLONE_MANAGER_GUI_CADDY_HOSTS`: URL/hostname public cho rclone built-in GUI.
- `WEBSSH_HOST_PORT` (default `17681`): cổng localhost cho WebSSH.
- `DOCKER_DEPLOY_CODE_ENABLED`: bật sidecar deploy-code.
- `DOCKER_DEPLOY_CODE_DEPLOY_SERVICES`: service Compose cần rebuild/redeploy, mặc định `app`.
- `DOCKER_DEPLOY_CODE_POLL_ENABLED`: polling Git để detect thay đổi.
- `DOCKER_DEPLOY_CODE_AUTO_DEPLOY_ON_CHANGE`: tự deploy khi polling thấy commit mới.
- `DOCKER_DEPLOY_CODE_CADDY_HOSTS`: hostname Caddy direct API cho deploy-code.
- `DOCKER_DEPLOY_CODE_SERVICE_ALLOWLIST`, `DOCKER_DEPLOY_CODE_CONTAINER_ALLOWLIST`: giới hạn service/container được phép start/stop/restart/rebuild/logs.

## 5) Cấu hình Cloudflare Tunnel (chi tiết kỹ thuật)

1. Tạo tunnel trên Cloudflare Zero Trust.
2. Tải `credentials.json` đặt tại `cloudflared/credentials.json`.
3. Cập nhật `cloudflared/config.yml`:
   - `tunnel`: tunnel id
   - `credentials-file`: `/etc/cloudflared/credentials.json`
   - `ingress`: route hostname -> `http://caddy:80`
4. Trên DNS Cloudflare, các record hostname phải trỏ đúng tunnel.

Mọi request public đi theo chuỗi:

`Internet -> Cloudflare Edge -> cloudflared -> caddy -> app/ops service`

## 6) Caddy labels và routing

Routing dựa labels trong compose:

- App: `${PROJECT_NAME}.${DOMAIN}` (+ alias `main.${DOMAIN}`, `${DOMAIN}`)
- Dozzle: `logs.${PROJECT_NAME}.${DOMAIN}`
- Filebrowser: `files.${PROJECT_NAME}.${DOMAIN}`
- Rclone GUI: `${RCLONE_MANAGER_GUI_CADDY_HOSTS}` (mặc định `rclone-gui.${DOMAIN}`)
- WebSSH: `ttyd.${PROJECT_NAME}.${DOMAIN}`
- Deploy Code API nếu bật: `${DOCKER_DEPLOY_CODE_CADDY_HOSTS}` từ `docker-compose/compose.deploy.yml`

Auth cơ bản dùng:

- User: `CADDY_AUTH_USER`
- Hash: `CADDY_AUTH_HASH`

## 7) Lệnh deploy đề xuất

```bash
npm run dockerapp-validate:env
npm run dockerapp-validate:compose
npm run dockerapp-exec:up
npm run dockerapp-exec:ps
npm run dockerapp-exec:logs
```

## Truy cập dịch vụ qua Tailscale hostname + port

Khi `ENABLE_TAILSCALE=true`, bạn có thể dùng hostname tailnet của node:

- `http://${PROJECT_NAME}.${TAILSCALE_TAILNET_DOMAIN}:${DOZZLE_HOST_PORT:-18080}` → Dozzle
- `http://${PROJECT_NAME}.${TAILSCALE_TAILNET_DOMAIN}:${FILEBROWSER_HOST_PORT:-18081}` → Filebrowser
- `http://${PROJECT_NAME}.${TAILSCALE_TAILNET_DOMAIN}:${RCLONE_MANAGER_GUI_HOST_PORT:-5572}` → rclone built-in GUI
- `http://${PROJECT_NAME}.${TAILSCALE_TAILNET_DOMAIN}:${WEBSSH_HOST_PORT:-17681}` → WebSSH

Ghi chú:
- Các cổng này bind `127.0.0.1` trên host; truy cập qua tailnet phụ thuộc cách bạn chạy Tailscale (container host-network Linux hay host-level trên Windows/WSL).
- Nếu không truy cập được qua tailnet, kiểm tra firewall host và trạng thái route/Tailscale.

## 8) Kiểm tra sau deploy

- `docker compose ps` tất cả service expected đều `running`/`healthy`.
- Truy cập `http(s)://<project>.<domain>` qua tunnel.
- Kiểm tra endpoint health: `/<HEALTH_PATH>`.
- Nếu bật Tailscale: truy cập `https://<PROJECT_NAME>.<TAILSCALE_TAILNET_DOMAIN>`.

## 9) Tài liệu từng dịch vụ

- `docs/services/caddy.md`
- `docs/services/cloudflared.md`
- `docs/services/app.md`
- `docs/services/dozzle.md`
- `docs/services/filebrowser.md`
- `docs/services/rclone-manager-gui.md`
- `docs/services/webssh.md`
- `docs/services/tailscale.md`
- `docs/deploy-code.md`
