export const BACKUP_FORMAT = 'vuong-phat-inventory-backup' as const;
export const BACKUP_SCHEMA_VERSION = 1 as const;
export const MAX_BACKUP_FILE_BYTES = 20 * 1024 * 1024;

export const BACKUP_NODE_DEFINITIONS = [
  { key: 'products', label: 'Sản phẩm', defaultRestore: true },
  { key: 'categories', label: 'Danh mục', defaultRestore: true },
  { key: 'productCategories', label: 'Danh mục cũ', defaultRestore: true },
  { key: 'suppliers', label: 'Nhà cung cấp', defaultRestore: true },
  { key: 'partners', label: 'Đối tác cũ', defaultRestore: true },
  { key: 'settings', label: 'Cài đặt doanh nghiệp', defaultRestore: true },
  { key: 'importTickets', label: 'Phiếu nhập', defaultRestore: true },
  { key: 'exportTickets', label: 'Phiếu xuất', defaultRestore: true },
  { key: 'salesTickets', label: 'Đơn bán hàng', defaultRestore: true },
  { key: 'operations', label: 'Nghiệp vụ chống trùng', defaultRestore: true },
  { key: 'stockMovements', label: 'Biến động tồn kho', defaultRestore: true },
  { key: 'vouchers', label: 'Mã giảm giá', defaultRestore: true },
  { key: 'productMutations', label: 'Lịch sử thay đổi sản phẩm', defaultRestore: true },
  { key: 'auditLogs', label: 'Nhật ký nghiệp vụ', defaultRestore: false },
  { key: 'users', label: 'Hồ sơ người dùng', defaultRestore: false },
] as const;

export type BackupNode = typeof BACKUP_NODE_DEFINITIONS[number]['key'];
export type RestoreMode = 'merge' | 'replace';
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface BackupEnvironment {
  projectId: string;
  databaseHost: string;
  mode: 'legacy-root' | 'scoped-branch';
  companyId?: string;
  branchId?: string;
  scopeKey?: string;
}

export interface BackupDocument {
  backupFormat: typeof BACKUP_FORMAT;
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  appVersion: string;
  environment: BackupEnvironment;
  createdAt: string;
  timestamp: number;
  createdBy: { uid: string; email: string };
  summary: Record<BackupNode, number>;
  checksum: string;
  data: Record<BackupNode, JsonValue>;
}

export interface NodeDiff {
  node: BackupNode;
  added: number;
  updated: number;
  unchanged: number;
  conflicts: number;
  removed: number;
}

export interface RestorePreview {
  environment: BackupEnvironment;
  diffs: NodeDiff[];
  warnings: string[];
  currentChecksum: string;
}

export interface RestoreResult {
  jobId: string;
  completedAt: number;
  metadataWarnings?: string[];
  integrity: {
    ok: boolean;
    issueCount: number;
    issues: Array<{
      level: 'error' | 'warning';
      code: string;
      path: string;
      message: string;
    }>;
  };
}

export interface BackupHistoryEntry {
  fileName: string;
  createdAt: string;
  checksum: string;
  size: number;
  reason: 'manual' | 'pre-restore';
}

export const DEFAULT_RESTORE_NODES = BACKUP_NODE_DEFINITIONS
  .filter((node) => node.defaultRestore)
  .map((node) => node.key);
