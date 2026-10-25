# Đăng mã nguồn và Release lên GitHub

## Trạng thái và phạm vi công bố

Git repository gốc hiện không có remote; máy chưa có lệnh `gh`. Chưa biết tài khoản/repository đích, chưa đẩy code hoặc công bố Release.

Không push nguyên lịch sử Git hiện tại: lịch sử đang có cấu hình riêng và tài liệu nội bộ. `.gitignore` không xóa file đã được theo dõi hoặc nội dung ở commit cũ. Bản xuất `release/1.0.0/github-source/` là nguồn được duyệt theo allowlist, giữ test/fixture tổng hợp cần cho kiểm thử, loại bảng dữ liệu cá nhân, báo cáo nội bộ, agent state, `.firebaserc`, backup, build và lịch sử Git. Không xóa các file này ở workspace gốc.

## Mô tả repository

Tên đề xuất: `inventory-system` (chủ project quyết định).

Ô **Description**:

> Ứng dụng quản lý kho và bán hàng POS trên Windows, giao diện tiếng Việt, dùng Electron, React, TypeScript và Firebase.

Không tự chọn giấy phép. Chỉ chủ project quyết định Public/Private.

## Tạo repository bằng trình duyệt

1. Đăng nhập đúng tài khoản GitHub, mở [New repository](https://github.com/new).
2. Ô **Owner**: chọn tài khoản/tổ chức sở hữu.
3. Ô **Repository name**: nhập tên đã chọn; **Description**: dùng nội dung trên.
4. Chọn **Public** hoặc **Private** theo quyết định chủ project.
5. Nếu dùng Git để đẩy snapshot, để trống **Add a README file**, **Add .gitignore**, **Choose a license**. Bấm **Create repository**.
6. Cung cấp URL HTTPS repository cho người chuẩn bị phát hành. Không gửi token/mật khẩu vào chat.

Có thể dùng GitHub Desktop: **File → Add local repository** trỏ tới `release/1.0.0/github-source/`; nếu chưa có Git, chọn tạo repository tại chính thư mục này, commit toàn bộ nguồn đã duyệt rồi **Publish repository**, chọn đúng Owner/tên và Public/Private. Không chọn thư mục project gốc có lịch sử cũ, không thêm `assets/` hoặc thư mục build vào Git.

Nếu tải nguồn qua web: mở repository → **Add file → Upload files**, mở thư mục `github-source`, kéo toàn bộ nội dung bên trong (không kéo folder cha), kiểm tra `src`, `public`, `functions`, `docs`, `scripts` cùng cấp README. Giao diện có thể bỏ qua file ẩn; cần kiểm tra thêm `.gitignore`, `.firebaserc.example`, `.github/workflows/release.yml` qua **Add file → Create new file** với đúng đường dẫn. **Commit changes** chỉ khi danh sách không có dữ liệu riêng/build.

## Tạo GitHub Release bằng trình duyệt

1. Mở repository → **Releases → Draft a new release**.
2. **Choose a tag**: nhập `v1.0.0`, chọn **Create new tag: v1.0.0 on publish**; **Target** chọn commit nguồn sạch cần phát hành.
3. **Release title**: `Quản lý kho hàng 1.0.0`.
4. **Describe this release**: dùng nội dung `RELEASE_NOTES.md`. Khi dán vào Release, đổi liên kết biên bản sang file `RELEASE_VALIDATION.md` đính kèm hoặc URL blob tương ứng của repository.
5. Ô **Attach binaries by dropping them here or selecting them**: chọn toàn bộ file bên trong `release/1.0.0/assets/`: EXE, ZIP nguồn, tài liệu và checksum. Không tải lên `win-unpacked`, `app`, `qa-installers` hoặc installer cũ.
6. Kiểm tra đúng tên, phiên bản, SHA256 và các giới hạn đã công bố. Có thể bấm **Save draft** để rà soát; bấm **Publish release** khi chủ project sẵn sàng công bố.
7. Tải lại EXE từ Release rồi đối chiếu SHA256 với bản cục bộ; ghi URL Release vào README.

## CI đã chuẩn bị

Workflow Windows chạy thủ công tại **Actions → Windows release → Run workflow**: cài theo lockfile, test, lint, build, tạo NSIS và artifact `windows-release`. Artifact CI chưa phải kết quả kiểm thử cài/gỡ trên mọi máy và không tự công bố Release. Không nhúng credential Firebase hoặc chứng thư ký mã vào nguồn.

Tham chiếu ô/nút trên GitHub: [tạo repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository), [quản lý Release](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository).
