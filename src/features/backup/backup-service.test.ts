import { describe, expect, it } from 'vitest';
import { formatBackupFunctionError } from './backup-service';

describe('backup callable error messages', () => {
  it.each([
    ['functions/not-found', 'Chức năng sao lưu chưa được triển khai trên máy chủ.'],
    ['functions/permission-denied', 'Tài khoản không có quyền sao lưu.'],
    ['functions/unauthenticated', 'Phiên đăng nhập đã hết hạn.'],
    ['functions/unavailable', 'Không thể kết nối máy chủ sao lưu.'],
  ])('maps %s to the required Vietnamese message', (code, expected) => {
    expect(formatBackupFunctionError({ code })).toBe(expected);
  });

  it('falls back to the shared safe formatter', () => {
    expect(formatBackupFunctionError({ code: 'functions/internal', message: 'Lỗi máy chủ.' }))
      .toBe('Lỗi máy chủ.');
  });
});
