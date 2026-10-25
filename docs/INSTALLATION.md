# Cài đặt Quản lý kho hàng 1.0.0

## Kiểm tra file tải

Tải bộ cài x64 và `SHA256SUMS.txt` từ cùng GitHub Release. Trong PowerShell, tại thư mục tải:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath ".\QuanLyKhoHang-1.0.0-windows-x64-setup.exe"
```

Đối chiếu đủ 64 ký tự hex với dòng cùng tên (không phân biệt hoa/thường). Khác checksum thì không chạy, tải lại từ nguồn chính thức. Checksum kiểm tra toàn vẹn, không thay chữ ký nhà phát hành.

## Cài lần đầu

1. Đóng app nếu đang mở; sao lưu trước nâng cấp theo quy trình của đơn vị.
2. Chạy `QuanLyKhoHang-1.0.0-windows-x64-setup.exe` bằng tài khoản Windows hiện tại.
3. Chọn thư mục riêng, không chứa tài liệu cá nhân/backup.
4. Bấm **Install**, chờ xong rồi **Finish**. Mở **QuanLyKhoHang** từ Desktop/Start Menu.
5. Nhập Firebase riêng, đăng nhập tài khoản được cấp; xem [hướng dẫn backend](../FIREBASE_DEPLOYMENT.md).

Runtime có trong bộ cài, không cần model/Node.js/WebView2. Chưa ký chứng thư; nếu chính sách máy chặn, nhờ quản trị viên đánh giá nguồn và chính sách triển khai.

## Nâng cấp, cài lại và dữ liệu

Đóng app, chạy bộ cài mới; giữ thư mục cài khi nâng cấp. Không xóa hồ sơ/Firebase để cài lại. Lưu XLSX/PDF/JSON ở Documents hoặc thư mục ngoài thư mục cài.

Hồ sơ mặc định do Electron quản lý dưới `%APPDATA%\inventory-system` (có thể khác khi tùy chỉnh môi trường). Giữ tên package/app ID cũ, không di chuyển hồ sơ. Chuyển máy: nhập lại Firebase và đăng nhập; không chia sẻ hồ sơ Chromium đang dùng.

## Gỡ cài đặt

Đóng app → Windows Settings → Apps → Installed apps → **QuanLyKhoHang** → **Uninstall**; hoặc dùng trình gỡ trong thư mục cài. Gỡ app không xóa Firebase, được cấu hình giữ hồ sơ cục bộ. File đã xuất ngoài thư mục cài do người dùng quản lý.

## Khi gặp lỗi

- Không mở: kiểm tra Windows x64/file tải; cung cấp phiên bản Windows, app và lỗi cho quản trị viên.
- Không đăng nhập: kiểm tra mạng, Firebase, Email/Password và `users/{uid}` có email/role/status đúng.
- Không sao lưu: kiểm tra Functions `us-central1`, quyền admin/gói Firebase; bộ cài không tự deploy backend.
- Không in: thử PDF, kiểm tra driver/quyền ghi thư mục.

## Hồ sơ kiểm thử

`INVENTORY_USER_DATA_DIR` nhận đường dẫn tuyệt đối tới hồ sơ riêng. Chỉ đặt cho tiến trình thử, không đặt toàn hệ thống. Không đặt biến thì hành vi lưu giữ nguyên.
