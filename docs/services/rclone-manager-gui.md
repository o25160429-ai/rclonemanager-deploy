# Rclone Manager GUI service (`docker-compose/compose.ops.yml`)

## Vai trò
- Chạy built-in rclone web GUI bằng `rclone rcd --rc-web-gui`.
- Tab Configs của app chính có nút `Publish GUI` để ghi các config đã chọn vào file `rclone.conf` dùng bởi GUI.
- Khi mở GUI, các remote đã publish được load sẵn để duyệt file, xem file metadata, copy/sync/move giữa các remote bằng tính năng của rclone GUI.

## Kích hoạt
- Bật `RCLONE_MANAGER_GUI_ENABLED=true`.
- `dc.sh` sẽ tự thêm profile `rclone-gui`.
- Public route mặc định: `https://rclone-gui.${DOMAIN}`.

## Luồng sử dụng
1. Deploy stack với `RCLONE_MANAGER_GUI_ENABLED=true`.
2. Vào app chính -> tab `Configs`.
3. Tick các config cần dùng trong rclone GUI.
4. Bấm `Publish GUI`.
5. App chính ghi `${RCLONE_MANAGER_GUI_CONFIG_PATH}` và mở `${RCLONE_MANAGER_GUI_PUBLIC_URL}`.

Nếu `RCLONE_MANAGER_GUI_AUTO_MOUNT_SELECTED=true`, bước publish cũng gọi luồng mount có sẵn của app chính cho các config đã chọn. Mount lỗi không chặn việc ghi `rclone.conf`; lỗi sẽ hiện trong toast/status trả về.

## ENV `RCLONE_MANAGER_GUI_*`
- `RCLONE_MANAGER_GUI_ENABLED`: bật/tắt service GUI (`true|false`).
- `RCLONE_MANAGER_GUI_PORT`: port nội bộ của `rclone rcd` trong container GUI, mặc định `5572`.
- `RCLONE_MANAGER_GUI_HOST_PORT`: port publish trên host để truy cập trực tiếp qua localhost/Tailscale, mặc định `5572`.
- `RCLONE_MANAGER_GUI_PUBLIC_URL`: URL public để app chính mở sau khi publish, ví dụ `https://rclone-gui.${DOMAIN}`.
- `RCLONE_MANAGER_GUI_CADDY_HOSTS`: hostname Caddy route cho GUI, có thể nhiều host phân tách bằng dấu phẩy. Giá trị không cần scheme, ví dụ `rclone-gui.${DOMAIN}`.
- `RCLONE_MANAGER_GUI_CONFIG_PATH`: path trong container app chính để ghi file config đã chọn, mặc định `/mnt/docker-volumes/rclone-manager-gui/config/rclone.conf`.
- `RCLONE_MANAGER_GUI_CONTAINER_CONFIG_PATH`: path tương ứng trong container GUI, mặc định `/config/rclone/rclone.conf`.
- `RCLONE_MANAGER_GUI_CONTAINER_CACHE_DIR`: cache cho web GUI assets do rclone tải, mặc định `/cache`.
- `RCLONE_MANAGER_GUI_CADDY_AUTH_COMPAT`: `true` để patch rclone WebUI JS không tự ghi đè `Authorization`/`baseURL`, giúp Caddy Basic Auth hoạt động ổn định với các API call trong GUI.
- `RCLONE_MANAGER_GUI_RC_USER`: username auth riêng của rclone RC/web GUI. Để trống cùng `RCLONE_MANAGER_GUI_RC_PASS` để service thêm `--rc-no-auth`.
- `RCLONE_MANAGER_GUI_RC_PASS`: password auth riêng của rclone RC/web GUI. Chỉ có tác dụng khi `RCLONE_MANAGER_GUI_RC_USER` cũng có giá trị.
- `RCLONE_MANAGER_GUI_WEB_GUI_UPDATE`: `true` để rclone tự tải/cập nhật web GUI assets khi start.
- `RCLONE_MANAGER_GUI_RC_ALLOW_ORIGIN`: CORS allow-origin cho RC API; thường để trống khi chỉ dùng cùng hostname GUI.
- `RCLONE_MANAGER_GUI_AUTO_MOUNT_SELECTED`: `true` để publish xong thì mount luôn các config đã chọn bằng mount flow hiện có.
- `RCLONE_MANAGER_GUI_EXTRA_ARGS`: extra args nâng cao append vào `rclone rcd`.

## Cloudflare Tunnel
Thêm ingress vào `cloudflared/config.yml`:

```yaml
  - hostname: rclone-gui.example.com
    service: http://caddy:80
```

DNS hostname đó cần trỏ về cùng Cloudflare Tunnel. Traffic đi theo luồng:

`Internet -> Cloudflare Edge -> cloudflared -> caddy -> rclone-manager-gui`

## Bảo mật
- Public route được bảo vệ bởi Caddy Basic Auth giống Dozzle/Filebrowser.
- Auth riêng của `rclone rcd` là optional: để trống `RCLONE_MANAGER_GUI_RC_USER` và `RCLONE_MANAGER_GUI_RC_PASS` thì service thêm `--rc-no-auth`; điền cả hai thì GUI yêu cầu thêm lớp đăng nhập rclone.
- Rclone WebUI mặc định tự set header `Authorization` cho RC API. Khi dùng Caddy Basic Auth, giữ `RCLONE_MANAGER_GUI_CADDY_AUTH_COMPAT=true` để browser dùng credential Caddy đã nhập thay vì bị WebUI ghi đè.
- Nếu publish host port ra LAN/Tailscale mà vẫn để trống auth rclone, hãy giữ `OPS_HOST_BIND_IP=127.0.0.1` hoặc bảo vệ đường truy cập đó ở lớp mạng.
- File `rclone.conf` chứa token/secret của các remote đã publish, nên volume `${DOCKER_VOLUMES_ROOT}/rclone-manager-gui/config` cần được xem như dữ liệu nhạy cảm.
