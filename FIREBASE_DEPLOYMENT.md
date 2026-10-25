# Thiết lập Firebase cho bản desktop

Đối chiếu mã nguồn ngày 24/10/2026; thay hướng dẫn lịch sử không còn phù hợp.

## Máy mới nối tới kho đã có

Lấy cấu hình Web app tại Firebase Console → Project settings → General → Your apps. Nhập 7 trường trên màn hình **Thiết lập cơ sở dữ liệu**, sau đó đăng nhập tài khoản được cấp. Cấu hình lưu cục bộ; không công bố hồ sơ/cấu hình lên GitHub. Thông báo thiết lập thành công chỉ xác nhận khởi tạo SDK, không chứng minh backend đủ quyền/có Functions.

## Backend mới

1. Tạo Firebase project riêng cho đơn vị, đăng ký Web app.
2. Bật Authentication → Sign-in method → Email/Password; tạo Realtime Database, lấy đúng URL trong Console.
3. Tạo tài khoản đầu tiên trong Authentication, lấy UID; dùng Console tạo `users/{uid}` trong môi trường quản trị tin cậy:

```json
{
  "email": "admin@example.com",
  "role": "admin",
  "status": "active"
}
```

Email phải trùng Auth. Đây là ví dụ định dạng, không phải tài khoản có sẵn. Nghiệp vụ hiện đọc dữ liệu root-level. Không tự thêm `companyId`/`branchId` theo tài liệu cũ: Rules có nhánh tenant nhưng cần đánh giá đồng bộ frontend.

4. Kiểm tra `database.rules.json` trên project thử trước khi áp dụng. Rules có quyền ghi rộng phục vụ transaction; không khẳng định chống mọi client bị chỉnh sửa.
5. Chuẩn bị Functions nếu cần sao lưu/khôi phục. Cài desktop không tự deploy backend hay cấp quyền admin.

## Công cụ quản trị và Functions

Chỉ máy quản trị cần Node.js 22, Firebase CLI và Java cho emulator:

```powershell
npm ci
npm --prefix functions ci
npm run functions:build
npm run functions:test
npm run test:rules
npx firebase login
Copy-Item .firebaserc.example .firebaserc
```

Thay `YOUR_FIREBASE_PROJECT_ID` trong `.firebaserc`; file này loại khỏi nguồn công bố. Luôn truyền `--project YOUR_FIREBASE_PROJECT_ID`. Không commit service-account, mật khẩu/token CLI.

Nhập/xuất/bán gọi RTDB trực tiếp qua `src/services/realtime-inventory.ts`. Sao lưu/khôi phục gọi 4 Functions tại `us-central1`: `createInventoryBackup`, `previewInventoryRestore`, `restoreInventoryBackup`, `recordBackupRestoreEvent`. Chúng ở `functions/src/index.ts`; `firebase.json` có Functions. Callable cũ khác giữ trong mã không cần deploy để cài desktop.

Sau khi đánh giá chi phí/gói Firebase và kiểm thử staging, quản trị viên có thể deploy riêng:

```powershell
npx firebase deploy --project YOUR_FIREBASE_PROJECT_ID --only functions:createInventoryBackup,functions:previewInventoryRestore,functions:restoreInventoryBackup,functions:recordBackupRestoreEvent
```

Đợt phát hành không chạy deploy. Không dùng `firebase deploy` không giới hạn trên project đang vận hành.

## Dữ liệu đang dùng

Không đổi Rules/khôi phục dữ liệu chỉ để thử bộ cài. Script quản trị nhận project ID rõ ràng:

```powershell
npm run production:backup -- -ProjectId YOUR_FIREBASE_PROJECT_ID
npm run production:audit -- -BackupPath "backups\your-backup.json"
```

Deploy Rules còn yêu cầu `-ProjectId`, backup, audit và báo cáo tương thích hợp lệ; không bỏ guard để phát hành desktop. Thử staging trước thay Rules. Backup thật phải lưu riêng, không công bố.
