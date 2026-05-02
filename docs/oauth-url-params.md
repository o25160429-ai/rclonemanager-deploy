# OAuth URL Params

Tài liệu này mô tả các query params có thể dùng để mở sẵn form OAuth trong rclone OAuth Manager.

Params có thể đặt trong hash query sau route:

```text
https://rclonemanager.dpdns.org/#oauth-od?type=direct&label-preset=my-onedrive-preset&email-owner=user@example.com
https://rclonemanager.dpdns.org/#oauth-gd?type=parse&label-preset=my-google-preset&email-owner=user@gmail.com
```

Nếu không truyền params, form giữ nguyên luồng mặc định hiện tại.

## Route

Route chọn provider:

| Route | Ý nghĩa |
| --- | --- |
| `#oauth-gd` | Mở form Google Drive |
| `#oauth-od` | Mở form OneDrive |

Ví dụ:

```text
https://rclonemanager.dpdns.org/#oauth-gd
https://rclonemanager.dpdns.org/#oauth-od
```

## Mode Auth

Các key tương đương:

| Key | Ghi chú |
| --- | --- |
| `type` | Khuyến nghị dùng |
| `mode` | Alias |
| `flow` | Alias |

Giá trị cố định theo code hiện tại:

| Giá trị | Mode được chọn |
| --- | --- |
| `direct` | Direct Auth |
| `auto` | Direct Auth |
| `direct-auth` | Direct Auth |
| `parse` | Parse từ URL |
| `paste` | Parse từ URL |
| `manual` | Parse từ URL |
| `url` | Parse từ URL |
| `parse-url` | Parse từ URL |

Ví dụ:

```text
#oauth-od?type=direct
#oauth-od?type=parse
#oauth-gd?mode=auto
#oauth-gd?flow=parse-url
```

Lưu ý: với built-in preset, app cũ thường tự chuyển sang Parse từ URL. Khi dùng URL param như `type=direct`, mode trong param được ưu tiên.

## Chọn Preset

Có 2 cách chọn preset: theo label hoặc theo id.

### Chọn theo label

Các key tương đương:

| Key | Ghi chú |
| --- | --- |
| `label-preset` | Khuyến nghị dùng |
| `preset-label` | Alias |
| `labelPreset` | Alias |

Cách match:

1. Match label chính xác, không phân biệt hoa thường.
2. Nếu không có, thử match label có chứa chuỗi truyền vào.

Ví dụ:

```text
#oauth-od?label-preset=rclonemanager-23t5wj.onmicrosoft.com
#oauth-gd?preset-label=my-google-preset
```

### Chọn theo id

Các key tương đương:

| Key | Ghi chú |
| --- | --- |
| `preset-id` | Khuyến nghị dùng |
| `presetId` | Alias |
| `preset` | Alias theo id |

Ví dụ:

```text
#oauth-gd?preset-id=-Nabc123xyz
#oauth-od?presetId=-Nabc123xyz
```

Nếu chọn preset đã lưu, frontend không cần gửi `client-secret`; backend sẽ lấy secret theo `presetId`. Nếu không có `presetId`, backend fallback tìm preset bằng `provider + clientId`.

## Email Owner

Các key tương đương:

| Key | Ghi chú |
| --- | --- |
| `email-owner` | Khuyến nghị dùng |
| `emailOwner` | Alias |
| `email_owner` | Alias |
| `email` | Alias ngắn |
| `login_hint` | Alias, đồng thời đúng tên param OAuth |

Giá trị này dùng để:

- Điền ô `Email owner`.
- Gắn `login_hint` vào auth URL Google/OneDrive nếu có giá trị.
- Gắn hint cho nút `Login Google` hoặc `Login Microsoft` nếu có giá trị.

Nếu để trống, backend sẽ cố lấy email owner từ token sau khi exchange code. Nếu provider không trả được email, config được lưu với `emailOwner = unknowEmail` và remote name được sinh theo quy tắc hiện tại từ giá trị này.

Ví dụ:

```text
#oauth-gd?email-owner=user@gmail.com
#oauth-od?email-owner=user@tenant.onmicrosoft.com
#oauth-od?login_hint=user@tenant.onmicrosoft.com
```

## Remote Name

Các key tương đương:

| Key | Ghi chú |
| --- | --- |
| `remote` | Khuyến nghị dùng |
| `remote-name` | Alias |
| `remoteName` | Alias |

Ví dụ:

```text
#oauth-gd?remote=gd-user01
#oauth-od?remote=od-user01
```

## Google Scope

Key:

| Key | Ghi chú |
| --- | --- |
| `scope` | Chỉ áp dụng Google Drive |

Giá trị cố định theo code hiện tại:

| Giá trị | Ý nghĩa |
| --- | --- |
| `drive` | Toàn quyền Google Drive |
| `drive.file` | Chỉ file do app tạo/mở |
| `drive.readonly` | Chỉ đọc |

Ví dụ:

```text
#oauth-gd?scope=drive
#oauth-gd?scope=drive.file
#oauth-gd?scope=drive.readonly
```

## OneDrive Drive Type

OneDrive auth URL hiện xin các scope Microsoft Graph:

```text
https://graph.microsoft.com/Files.ReadWrite https://graph.microsoft.com/User.Read offline_access
```

`User.Read` dùng để gọi `GET /me` lấy `mail` hoặc `userPrincipalName` sau khi exchange code.

Các key tương đương:

| Key | Ghi chú |
| --- | --- |
| `drive-type` | Khuyến nghị dùng |
| `driveType` | Alias |

Giá trị cố định theo code hiện tại:

| Giá trị | Ý nghĩa |
| --- | --- |
| `personal` | OneDrive Personal |
| `business` | OneDrive Business/SharePoint |

Ví dụ:

```text
#oauth-od?drive-type=personal
#oauth-od?drive-type=business
```

## Google Root Folder

Các key tương đương:

| Key | Ghi chú |
| --- | --- |
| `root-folder` | Khuyến nghị dùng |
| `rootFolder` | Alias |
| `googleRootFolderMode` | Alias theo tên field nội bộ |

Giá trị cố định theo code hiện tại:

| Giá trị | Ý nghĩa |
| --- | --- |
| `normal` | Mặc định My Drive |
| `appDataFolder` | Dùng `root_folder_id = appDataFolder` |

Ví dụ:

```text
#oauth-gd?root-folder=normal
#oauth-gd?root-folder=appDataFolder
```

## Redirect URI

Các key tương đương:

| Key | Ghi chú |
| --- | --- |
| `redirect-uri` | Khuyến nghị dùng |
| `redirectUri` | Alias |

Ví dụ:

```text
#oauth-od?type=parse&redirect-uri=http%3A%2F%2Flocalhost%3A53682%2F
#oauth-gd?type=parse&redirect-uri=https%3A%2F%2Frclonemanager.dpdns.org%2F
```

Lưu ý: giá trị URL nên được URL-encode.

## Client ID Và Client Secret

Các key tương đương:

| Field | Key khuyến nghị | Alias |
| --- | --- | --- |
| Client ID | `client-id` | `clientId` |
| Client Secret | `client-secret` | `clientSecret` |

Ví dụ:

```text
#oauth-gd?client-id=xxx.apps.googleusercontent.com&client-secret=yyy
#oauth-od?client-id=00000000-0000-0000-0000-000000000000
```

Thứ tự ưu tiên backend khi exchange code:

1. Nếu state/body có sẵn cả `clientId` và `clientSecret`, dùng chính cặp này.
2. Nếu thiếu `clientSecret` nhưng có `presetId`, lấy secret theo preset.
3. Nếu không có `presetId` và thiếu `clientSecret`, tìm preset theo `provider + clientId`.
4. Nếu vẫn không có secret, backend exchange bằng dữ liệu hiện có. OneDrive public client có thể vẫn chạy, Google custom client thường cần secret.

## Nút Login Trước Khi Auth

Trong form OAuth có nút:

- `Login Google` khi provider là Google Drive.
- `Login Microsoft` khi provider là OneDrive.

Nút này mở trang đăng nhập provider trong tab mới. Nếu có email owner thì dùng làm `login_hint`; nếu để trống thì không truyền `login_hint`. Mục đích là hoàn tất đăng nhập/MFA trước, rồi quay lại app bấm Direct Auth rclone.

Nút này không lưu token và không thay thế luồng rclone auth. Nó chỉ chuẩn bị session trình duyệt.

## Ví Dụ Hoàn Chỉnh

OneDrive Direct Auth, chọn preset theo label, điền email owner, remote, drive type:

```text
https://rclonemanager.dpdns.org/#oauth-od?type=direct&label-preset=rclonemanager-23t5wj.onmicrosoft.com&email-owner=user@rclonemanager-23t5wj.onmicrosoft.com&remote=od-user&drive-type=business
```

OneDrive Parse từ URL:

```text
https://rclonemanager.dpdns.org/#oauth-od?type=parse&label-preset=rclonemanager-23t5wj.onmicrosoft.com&email-owner=user@rclonemanager-23t5wj.onmicrosoft.com&remote=od-user&drive-type=business
```

Google Direct Auth với scope toàn quyền:

```text
https://rclonemanager.dpdns.org/#oauth-gd?type=direct&label-preset=my-google-preset&email-owner=user@gmail.com&remote=gd-user&scope=drive&root-folder=normal
```

Google Parse từ URL dùng appDataFolder:

```text
https://rclonemanager.dpdns.org/#oauth-gd?type=parse&label-preset=my-google-preset&email-owner=user@gmail.com&remote=gd-appdata-user&scope=drive&root-folder=appDataFolder
```

Custom Google client không dùng preset:

```text
https://rclonemanager.dpdns.org/#oauth-gd?type=direct&email-owner=user@gmail.com&remote=gd-user&scope=drive&client-id=xxx.apps.googleusercontent.com&client-secret=yyy
```

Custom OneDrive client, backend tự tìm preset theo client id nếu có:

```text
https://rclonemanager.dpdns.org/#oauth-od?type=direct&email-owner=user@tenant.onmicrosoft.com&remote=od-user&drive-type=business&client-id=00000000-0000-0000-0000-000000000000
```
