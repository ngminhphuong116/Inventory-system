# Quản lý kho hàng 1.0.0

Bản Windows x64 chuẩn bị ngày 24/10/2026 từ mã nguồn hiện tại, gồm thay đổi đã có trước rà soát. Chưa công bố GitHub Release.

## Nội dung

- Giữ chức năng kho/POS, giao diện và luồng dữ liệu hiện có.
- NSIS cho tài khoản hiện tại, chọn thư mục, shortcut Desktop/Start Menu và mục gỡ cài.
- Giữ Electron/thư viện cần thiết, không yêu cầu Node.js/Python/Excel trên máy người dùng.
- Tách build, staging, publish, installer, nguồn và assets; không chứa bộ cài cũ.
- Sửa ICO từ SVG sẵn có. Hồ sơ kiểm thử riêng, giữ mặc định lưu cũ.
- Script quản trị nhận project ID rõ ràng; nguồn sạch loại cấu hình riêng, báo cáo nội bộ, bảng dữ liệu và lịch sử Git cũ.
- README tiếng Việt, ảnh thật, hướng dẫn, biên bản kiểm tra và SHA256.

## File tải

- `QuanLyKhoHang-1.0.0-windows-x64-setup.exe`: cài đặt kèm runtime.
- `inventory-system-1.0.0-source.zip`: nguồn sạch, không phải bộ cài.
- `INSTALLATION.md`, `RELEASE_VALIDATION.md`: hướng dẫn/kết quả.
- `SHA256SUMS.txt`: checksum.

## Điều kiện và giới hạn

Cần Firebase của đơn vị/Internet. Không kèm tài khoản, dữ liệu thử trong app, cấu hình doanh nghiệp/backend chung. Sao lưu/khôi phục cần Functions `us-central1`. Chưa ký mã, chưa tự cập nhật, chưa chọn giấy phép.

Xem [biên bản kiểm tra](docs/RELEASE_VALIDATION.md). Chưa chứng minh mọi máy, chưa thử nghiệp vụ Firebase thật/máy in thật. Quyền RTDB cần đánh giá riêng trước triển khai rộng.
