# Deploy Code Sidecar

`deploy-code` là sidecar nội bộ để cập nhật source và redeploy đúng service/container đã cấu hình mà không phải chạy lại toàn bộ GitHub Actions/Azure Pipeline.

## 1. Mục tiêu

- Compose service nằm riêng trong `docker-compose/compose.deploy.yml`, không nằm trong `compose.apps.yml`.
- Bật/tắt bằng `.env` với prefix duy nhất: `DOCKER_DEPLOY_CODE_`.
- App chính gọi sidecar qua API nội bộ: `/api/deploy-code/*`.
- Có thể expose API riêng qua Caddy: `deploy.${PROJECT_NAME}.${DOMAIN}`.
- Có thể `git fetch`/detect change/pull code/rebuild đúng Compose service.
- Có thể polling Git tự động và auto deploy khi có commit mới.
- Có thể nhận ZIP source dạng `application/zip`, apply vào repo rồi deploy.
- Cập nhật `_DOTENVRTDB_RUNNER_COMMIT_ID`, `_DOTENVRTDB_RUNNER_COMMIT_SHORT_ID`, `_DOTENVRTDB_RUNNER_COMMIT_AT` trong `.env` để app/service worker luôn nhận asset version mới.
- Có log rõ ràng trong `${DOCKER_VOLUMES_ROOT}/deploy-code/logs/deploy-code.log`.
- Có API điều khiển container/service: list, start, stop, restart, rebuild, logs, inspect; giới hạn bằng allowlist trong `.env`.

## 2. Kiến trúc

```text
Browser / Admin UI
  -> app /api/deploy-code/*
  -> deploy-code sidecar từ docker-compose/compose.deploy.yml
  -> git fetch/reset hoặc apply ZIP
  -> update .env commit vars
  -> bash docker-compose/scripts/dc.sh up -d --build --no-deps app
  -> main-app được rebuild/recreate với code mới
```

Direct API qua Caddy cũng có thể dùng:

```text
Cloudflare/Caddy -> deploy-code:53999
```

Route direct mặc định:

```text
http://deploy.${PROJECT_NAME}.${DOMAIN}
```

## 3. Bật sidecar

Trong `.env`:

```env
DOCKER_DEPLOY_CODE_ENABLED=true
DOCKER_DEPLOY_CODE_APP_PROXY_ENABLED=true
DOCKER_DEPLOY_CODE_INTERNAL_URL=http://deploy-code:53999
DOCKER_DEPLOY_CODE_DEPLOY_SERVICES=app
DOCKER_DEPLOY_CODE_BRANCH=main
DOCKER_DEPLOY_CODE_REMOTE=origin
```

`dc.sh` luôn nạp `docker-compose/compose.deploy.yml`, nhưng chỉ bật Compose profile `deploy-code` khi:

```env
DOCKER_DEPLOY_CODE_ENABLED=true
```

Deploy:

```bash
bash docker-compose/scripts/dc.sh up -d --build
```

Kiểm tra compose file đã được nạp:

```bash
bash docker-compose/scripts/dc.sh config | grep -n "deploy-code"
```

Kiểm tra:

```bash
docker logs -f deploy-code
curl http://127.0.0.1:${DOCKER_DEPLOY_CODE_HOST_PORT:-53999}/health
```

## 4. Git auth: dùng sẵn auth của host/runner

Sidecar **không yêu cầu PAT/token riêng**. Nó mount repo host vào `/workspace` và chạy:

```bash
git fetch origin main
```

Điều kiện bắt buộc: repo trên host/runner phải tự `git fetch` được.

Các trường hợp hoạt động tốt:

- Public repo.
- Repo đã clone bằng SSH deploy key có sẵn trên host.
- GitHub Actions checkout với credential còn trong `.git/config`.
- Azure Pipeline checkout với credential còn dùng được trong workspace.

Sidecar không tự sinh credential Git. Nếu `git fetch` hỏi username/password thì sidecar sẽ fail và ghi lỗi vào log.

## 5. API qua app

Các endpoint này đi qua auth của app hiện tại:

```text
GET  /api/deploy-code/status
GET  /api/deploy-code/logs
POST /api/deploy-code/check
POST /api/deploy-code/deploy
POST /api/deploy-code/upload-zip
GET  /api/deploy-code/services
GET  /api/deploy-code/containers
POST /api/deploy-code/containers/start
POST /api/deploy-code/containers/stop
POST /api/deploy-code/containers/restart
POST /api/deploy-code/containers/rebuild
POST /api/deploy-code/containers/logs
POST /api/deploy-code/containers/inspect
```

Ví dụ gọi từ app domain:

```bash
curl -X POST https://<app-domain>/api/deploy-code/check \
  -H "Authorization: Bearer <google-session-token>" \
  -H "Content-Type: application/json" \
  --data '{"fetch":true}'
```

Deploy Git:

```bash
curl -X POST https://<app-domain>/api/deploy-code/deploy \
  -H "Authorization: Bearer <google-session-token>" \
  -H "Content-Type: application/json" \
  --data '{"force":false}'
```

Upload ZIP source qua app:

```bash
curl -X POST https://<app-domain>/api/deploy-code/upload-zip \
  -H "Authorization: Bearer <google-session-token>" \
  -H "Content-Type: application/zip" \
  -H "x-file-name: source.zip" \
  --data-binary @source.zip
```

## 6. API direct qua Caddy

Mặc định sidecar có Caddy label:

```env
DOCKER_DEPLOY_CODE_CADDY_HOSTS=deploy.${PROJECT_NAME}.${DOMAIN}
```

Direct endpoint:

```text
GET  /status
GET  /logs
POST /check
POST /deploy
POST /upload-zip
GET  /services
GET  /containers
POST /containers/start
POST /containers/stop
POST /containers/restart
POST /containers/rebuild
POST /containers/logs
POST /containers/inspect
```

Nếu đặt token:

```env
DOCKER_DEPLOY_CODE_API_TOKEN=change-this-long-random-value
DOCKER_DEPLOY_CODE_REQUIRE_TOKEN=true
```

Gọi direct:

```bash
curl -u "$CADDY_AUTH_USER:<plain-basic-auth-password>" \
  -H "x-deploy-code-token: $DOCKER_DEPLOY_CODE_API_TOKEN" \
  -X POST https://deploy.<domain>/check \
  -H "Content-Type: application/json" \
  --data '{"fetch":true}'
```

Khuyến nghị: nếu expose qua Caddy, luôn bật `DOCKER_DEPLOY_CODE_REQUIRE_TOKEN=true` ngoài Basic Auth.

## 7. Polling Git tự động

Chỉ kiểm tra, không tự deploy:

```env
DOCKER_DEPLOY_CODE_POLL_ENABLED=true
DOCKER_DEPLOY_CODE_POLL_INTERVAL_SEC=300
DOCKER_DEPLOY_CODE_AUTO_DEPLOY_ON_CHANGE=false
```

Tự deploy khi có commit mới:

```env
DOCKER_DEPLOY_CODE_POLL_ENABLED=true
DOCKER_DEPLOY_CODE_AUTO_DEPLOY_ON_CHANGE=true
```

Khuyến nghị vận hành: bật polling check trước, xem log ổn định rồi mới bật auto deploy.

## 8. Cấu hình service/container cần deploy

Deploy Compose service:

```env
DOCKER_DEPLOY_CODE_DEPLOY_SERVICES=app
```

Nhiều service:

```env
DOCKER_DEPLOY_CODE_DEPLOY_SERVICES=app,worker,api
```

Sidecar sẽ chạy mặc định:

```bash
bash docker-compose/scripts/dc.sh up -d --build --no-deps app worker api
```

Restart thêm container theo tên:

```env
DOCKER_DEPLOY_CODE_RESTART_CONTAINERS=main-app,another-container
```

Custom command thay toàn bộ deploy command mặc định:

```env
DOCKER_DEPLOY_CODE_DEPLOY_COMMAND=bash docker-compose/scripts/dc.sh up -d --build --no-deps app
DOCKER_DEPLOY_CODE_POST_DEPLOY_COMMAND=docker image prune -f
```


## 9. API điều khiển container/service

Mặc định API điều khiển container bật nhưng bị giới hạn bằng allowlist:

```env
DOCKER_DEPLOY_CODE_CONTAINER_CONTROL_ENABLED=true
DOCKER_DEPLOY_CODE_CONTAINER_ALLOW_ALL=false
DOCKER_DEPLOY_CODE_SERVICE_ALLOWLIST=app
DOCKER_DEPLOY_CODE_CONTAINER_ALLOWLIST=main-app,deploy-code
DOCKER_DEPLOY_CODE_CONTAINER_LOG_DEFAULT_LINES=200
DOCKER_DEPLOY_CODE_CONTAINER_LOG_MAX_LINES=2000
DOCKER_DEPLOY_CODE_CONTAINER_ACTION_TIMEOUT_SEC=600
```

Không khuyến nghị bật toàn quyền Docker, nhưng nếu môi trường nội bộ tuyệt đối an toàn có thể dùng:

```env
DOCKER_DEPLOY_CODE_CONTAINER_ALLOW_ALL=true
```

List service/container:

```bash
curl https://<app-domain>/api/deploy-code/services
curl https://<app-domain>/api/deploy-code/containers
```

Start/stop/restart nhiều service hoặc container:

```bash
curl -X POST https://<app-domain>/api/deploy-code/containers/restart \
  -H "Content-Type: application/json" \
  --data '{"services":["app"],"containers":["deploy-code"]}'
```

Rebuild service app:

```bash
curl -X POST https://<app-domain>/api/deploy-code/containers/rebuild \
  -H "Content-Type: application/json" \
  --data '{"services":["app"]}'
```

Xem logs:

```bash
curl -X POST https://<app-domain>/api/deploy-code/containers/logs \
  -H "Content-Type: application/json" \
  --data '{"services":["app"],"lines":200}'
```

Inspect container:

```bash
curl -X POST https://<app-domain>/api/deploy-code/containers/inspect \
  -H "Content-Type: application/json" \
  --data '{"containers":["main-app"]}'
```

Ghi chú:

- `stop` hỗ trợ cả `services` và `containers`.
- `start`, `restart`, `rebuild` luôn chạy theo Compose service với `up -d --build --no-deps` để đảm bảo image/code mới nhất được áp dụng.
- Nếu truyền `containers` cho `start`/`restart`/`rebuild`, sidecar sẽ suy ra `com.docker.compose.service` rồi chuyển sang rebuild service tương ứng.
- Nếu target không nằm trong allowlist, API trả lỗi và không chạy lệnh Docker.

## 10. ZIP source deploy

Endpoint `POST /upload-zip` nhận raw ZIP, không phải JSON.

Cấu hình liên quan:

```env
DOCKER_DEPLOY_CODE_ZIP_MAX_MB=200
DOCKER_DEPLOY_CODE_ZIP_STRIP_TOP_LEVEL=true
DOCKER_DEPLOY_CODE_ZIP_DELETE_MISSING=false
DOCKER_DEPLOY_CODE_ZIP_BACKUP_BEFORE_APPLY=true
DOCKER_DEPLOY_CODE_ZIP_EXCLUDES=.git,.env,.docker-volumes,node_modules
DOCKER_DEPLOY_CODE_ZIP_DEPLOY_AFTER_APPLY=true
```

Ý nghĩa:

- `ZIP_STRIP_TOP_LEVEL=true`: nếu ZIP có 1 folder gốc, lấy nội dung bên trong folder đó.
- `ZIP_DELETE_MISSING=false`: không xoá file đang có nhưng không nằm trong ZIP. An toàn hơn.
- `ZIP_BACKUP_BEFORE_APPLY=true`: tạo tar.gz backup trước khi rsync ZIP vào repo.
- `ZIP_EXCLUDES`: không đè `.git`, `.env`, `.docker-volumes`, `node_modules`.

Nếu ZIP là full source và muốn repo giống hệt ZIP, có thể bật:

```env
DOCKER_DEPLOY_CODE_ZIP_DELETE_MISSING=true
```

## 11. Commit env cho cache busting

Sau khi Git deploy hoặc ZIP deploy, sidecar cập nhật `.env`:

```env
_DOTENVRTDB_RUNNER_COMMIT_ID=<commit hoặc zip-version>
_DOTENVRTDB_RUNNER_COMMIT_SHORT_ID=<short>
_DOTENVRTDB_RUNNER_COMMIT_AT=<iso-time>
```

App hiện dùng các biến này để inject `ASSET_VERSION` vào `index.html` và `sw.js`, nên browser/service worker sẽ nhận version mới.

## 12. Log và debug

Log file:

```text
${DOCKER_VOLUMES_ROOT}/deploy-code/logs/deploy-code.log
```

Xem log container:

```bash
docker logs -f deploy-code
```

Qua API:

```bash
curl http://127.0.0.1:${DOCKER_DEPLOY_CODE_HOST_PORT:-53999}/logs
```

Status đầy đủ:

```bash
curl http://127.0.0.1:${DOCKER_DEPLOY_CODE_HOST_PORT:-53999}/status
```

## 13. Lưu ý bảo mật

`deploy-code` mount Docker socket:

```yaml
/var/run/docker.sock:/var/run/docker.sock
```

Vì vậy endpoint deploy có quyền rất cao. Không expose public nếu không có ít nhất:

- Caddy Basic Auth.
- `DOCKER_DEPLOY_CODE_REQUIRE_TOKEN=true`.
- Token đủ dài.
- App Google Auth/allowlist nếu gọi qua app.

## 14. Mở rộng cho app khác

Để dùng lại sườn này cho app khác, chỉ cần đổi env:

```env
DOCKER_DEPLOY_CODE_DEPLOY_SERVICES=my-other-app
DOCKER_DEPLOY_CODE_RESTART_CONTAINERS=my-other-container
DOCKER_DEPLOY_CODE_BRANCH=main
DOCKER_DEPLOY_CODE_COMPOSE_SCRIPT=docker-compose/scripts/dc.sh
```

Nếu app khác có biến version riêng, đổi key:

```env
DOCKER_DEPLOY_CODE_ENV_COMMIT_ID_KEY=MY_APP_COMMIT_ID
DOCKER_DEPLOY_CODE_ENV_COMMIT_SHORT_ID_KEY=MY_APP_COMMIT_SHORT_ID
DOCKER_DEPLOY_CODE_ENV_COMMIT_AT_KEY=MY_APP_COMMIT_AT
```
