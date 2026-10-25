# Biên bản kiểm tra phát hành 1.0.0

Ngày kiểm tra: 24/10/2026, múi giờ Việt Nam. Trạng thái: **đã tạo bộ cài chạy được cục bộ; chưa đăng GitHub; còn giới hạn nghiệp vụ và bảo mật bên dưới**.

## Môi trường và phạm vi

- Microsoft Windows 11 Home Single Language, build `10.0.26300`, 64-bit, một máy phát triển hiện tại.
- Node.js 22.23.2, npm 10.9.8; Electron 41.7.1; electron-builder 26.15.3.
- Mã nguồn có nhiều thay đổi chưa commit từ trước đợt rà soát; giữ nguyên chúng. Không sửa chức năng/UI/schema/Rules để đóng gói.
- Điểm vào Electron `main.js`, preload `preload.cjs`; React/TypeScript/Vite bundle vào `dist/`.
- RTDB/Auth là dịch vụ ngoài; sao lưu/khôi phục cần Functions `us-central1`. Không có model AI hay runtime Python. Runtime Electron kèm bản publish.
- Bản đang dùng đã cài dưới tài khoản Windows hiện tại. Không chạy installer chính để tránh ghi đè bản đó.

## Kết quả

| Kiểm tra | Kết quả và bằng chứng |
| --- | --- |
| TypeScript + Vite production | Đạt; có cảnh báo chunk lớn của Firebase/ExcelJS, không bỏ thư viện để giảm dung lượng |
| Nguồn xuất để công bố | TypeScript và Vite build đạt từ thư mục nguồn sạch, dùng toolchain/dependencies hiện có ở máy phát triển; chưa thử npm ci trên máy hoàn toàn mới |
| Unit/integration local | 26 file, 266 kiểm thử đạt |
| Backend riêng | Build TypeScript đạt; 4 file, 75 kiểm thử đạt; đây là một phần các test đã chạy trong bộ 266, không cộng thành 341 test riêng biệt |
| RTDB Emulator | 18 đạt, 1 todo; project `demo-inventory`, không dùng production |
| ESLint | Đạt lần kiểm tra cuối; loại thư mục build/tmp khỏi lint để không kiểm tra lại thư viện đã bundle |
| NSIS x64 chính | Build thành công, installer kèm runtime; `Get-AuthenticodeSignature` cho trạng thái NotSigned |
| Icon | ICO cũ chỉ 16×16 làm build lỗi; chuyển lại từ SVG hiện hữu thành ICO đủ 256×256 |
| Nội dung gói | 83 mục trong app.asar; không có node_modules rời, bảng XLSX cá nhân, credential, .git, cấu hình Firebase riêng hoặc installer cũ. Thư viện frontend đã được Vite bundle, không bị xóa khỏi ứng dụng |
| Publish chính | Mở EXE từ working directory khác, màn hình thiết lập và đăng nhập tải được; preload đúng, renderer không có `require`, không tràn ngang, không ghi nhận exception JS trong khoảng quan sát |
| Cài QA độc lập | Cài vào `tmp/Kiểm thử phát hành/Ứng dụng quản lý kho`, có dấu và khoảng trắng; cùng cấu hình NSIS nhưng app ID, tên EXE/shortcut/đăng ký riêng |
| Shortcut QA | Desktop và Start Menu trỏ đúng EXE; mở thực tế từ shortcut Desktop với working directory khác thành công |
| Cài lại QA | Thành công, khoảng 14–17 giây/lần trên máy này; hồ sơ riêng giữ cấu hình Firebase tổng hợp và marker sau khởi động lại |
| Gỡ QA | EXE, shortcut và đăng ký QA được gỡ; NSIS dọn qua tiến trình con nên kiểm tra phải chờ hoàn tất. Bản cài chính vẫn còn đăng ký/shortcut |
| Giữ hồ sơ sau gỡ | Đạt: mở lại publish bằng hồ sơ QA đọc được cấu hình/marker sau gỡ. Không dùng hồ sơ thật |
| PDF | Chính EXE publish dựng phiếu bán/nhập/xuất từ nội dung tổng hợp và ghi 3 PDF hợp lệ; không `undefined`/`NaN`/`Invalid Date`, không tràn ngang; toolbar ẩn khi in |
| Excel và UTF-8 | Gọi hàm xuất báo cáo thực tế, ghi/mở lại XLSX 4 sheet từ thư mục tiếng Việt; JSON UTF-8 ghi/đọc đúng; PDF sao chép sang đường dẫn tiếng Việt đọc đúng header |
| Ảnh README | Chụp giao diện thật từ bản đóng gói, kiểm tra trực quan; không có dữ liệu/tài khoản doanh nghiệp |

`app.asar` chính và QA trùng SHA256: `83fc1bb22a03661834d9572a23abc092d3982405469c24c4be8ae07dc1e0cfda`. QA chỉ đổi định danh để bảo vệ bản đang dùng; kết quả QA **không tương đương việc đã cài/gỡ chính installer công bố trên một máy sạch**.

## Giới hạn chưa kiểm chứng

Bổ sung đối chiếu README sau khi chủ project tự nhập cấu hình và đăng nhập: đã mở trực tiếp Dashboard, Sản phẩm, Nhập kho, Xuất kho, Bán hàng, Lịch sử, Báo cáo và Cài đặt trong phiên Admin. Đã xem form, bảng dữ liệu và khu vực sao lưu bằng thao tác đọc. Không tạo/sửa/hủy chứng từ, thay thông tin doanh nghiệp, đổi quyền/trạng thái tài khoản hoặc gọi Functions sao lưu/khôi phục. Không đưa email, đối tác, chứng từ và ảnh toàn trang chứa dữ liệu thật vào nguồn công bố. Các kết quả cài đặt tự động ở trên vẫn là phạm vi kiểm tra trước đó.

- Chưa chạy installer chính trên máy/VM sạch, Windows 10, ARM, máy thiếu driver hoặc bị chính sách doanh nghiệp hạn chế. Chưa đo tương thích mọi máy hay thời gian cài phổ quát.
- Chủ project đã tự đăng nhập và giao diện đọc được dữ liệu; chưa thử end-to-end tạo/sửa sản phẩm, nhập/xuất/bán/hủy phiếu và khôi phục trên backend của đơn vị. Logic có test tự động nhưng không thay thế thử staging.
- Chưa thử máy in thật, hộp thoại Save As bằng thao tác người dùng, hủy hộp thoại native, quyền ghi bị từ chối hoặc thiếu dung lượng. PDF dùng printToPDF thật; Excel dùng hàm xuất/mở lại thật, không giả lập máy in.
- Chưa thử nâng cấp từ mọi phiên bản cũ, chuyển schema hoặc khôi phục dữ liệu thật. Không deploy Firebase, không thay Rules, không sao chép/xóa hồ sơ thật.
- Todo Rules hiện có: ngăn xóa audit log trong khi vẫn dùng transaction cấp branch. Quyền ghi cấp cha hiện rộng; không xác nhận backend đã sẵn sàng cho client không tin cậy/multi-tenant.
- Chưa ký chứng thư; không có auto-update. Quy trình tải từ GitHub và checksum sau tải chưa kiểm tra vì chưa có repository đích.

## Rà soát thư viện

`npm audit --omit=dev` truy vấn thành công ngày kiểm tra: **10 package bị báo ảnh hưởng (8 high, 2 moderate, 0 critical)**. Đây là kết quả cây dependency nguồn, không phải 10 đường khai thác đã xác minh trong EXE.

- `xlsx@0.18.5`: [prototype pollution](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6), [ReDoS](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9); npm báo chưa có bản sửa trong kênh đang dùng.
- `react-router`/`react-router-dom`: [advisory RSC](https://github.com/advisories/GHSA-qwww-vcr4-c8h2). App hiện dùng HashRouter trên desktop; chưa xác nhận điều kiện RSC áp dụng.
- Cây `firebase` bị báo qua Firestore/gRPC; app hiện dùng Auth/RTDB/Functions, không nhập Firestore trong frontend.
- `exceljs` bị báo qua `uuid`; có `brace-expansion` trong cây dependency. Cần đánh giá mức sử dụng và nâng cấp riêng có kiểm thử.

Không chạy `npm audit fix --force`: kết quả npm đề xuất hạ major Firebase/ExcelJS, có nguy cơ đổi chức năng vượt phạm vi đóng gói. Advisory vẫn còn, không coi bản này đã qua kiểm định bảo mật toàn diện.

## Công bố nguồn

`.firebaserc`, bảng dữ liệu, cấu hình agent và báo cáo nội bộ đang tồn tại trong lịch sử Git cũ. Không push lịch sử đó lên GitHub. Xuất nguồn theo allowlist, quét mẫu credential/đường dẫn riêng và tạo source ZIP độc lập. Các fixture tổng hợp cần cho test giữ trong mã nguồn; không đóng vào EXE, không có dữ liệu thật.

Log chi tiết và file xuất thử ở `tmp/`, không công bố. Xem [hướng dẫn GitHub](GITHUB_PUBLICATION.md) và [cài đặt](INSTALLATION.md). NSIS được cấu hình theo [tài liệu electron-builder](https://www.electron.build/docs/nsis/).
