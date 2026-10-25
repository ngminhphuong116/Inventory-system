import { createHash } from 'node:crypto';

export const BACKUP_FORMAT = 'vuong-phat-inventory-backup' as const;
export const BACKUP_SCHEMA_VERSION = 1 as const;

export const BUSINESS_BACKUP_NODES = [
  'products',
  'categories',
  'productCategories',
  'suppliers',
  'partners',
  'settings',
  'importTickets',
  'exportTickets',
  'salesTickets',
  'operations',
  'auditLogs',
  'stockMovements',
  'productMutations',
  'vouchers',
  'users',
] as const;

export type BackupNode = typeof BUSINESS_BACKUP_NODES[number];
export type RestoreMode = 'merge' | 'replace';
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface BackupScope {
  mode: 'legacy-root' | 'scoped-branch';
  companyId?: string;
  branchId?: string;
  scopeKey?: string;
}

export interface BackupEnvironment extends BackupScope {
  projectId: string;
  databaseHost: string;
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

export interface IntegrityIssue {
  level: 'error' | 'warning';
  code: string;
  path: string;
  message: string;
}

const USER_PROFILE_FIELDS = new Set([
  'email', 'name', 'role', 'status', 'permissions', 'companyId', 'branchId', 'scopeKey',
  'archived', 'archivedAt', 'archivedByUid', 'createdAt', 'createdByUid', 'updatedAt',
  'updatedByUid', 'deletionRequestedAt', 'deletionRequestedBy', 'deletionError',
]);
const FORBIDDEN_KEY = /(password|passcode|secret|token|credential|session|refresh|api[-_]?key)/i;
const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/;
const DATABASE_KEY_PATTERN = /^[^.#$[\]/]{1,256}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isActiveAdminProfile(value: unknown): boolean {
  return isPlainObject(value) && value.role === 'admin' && value.status === 'active';
}

export function normalizeJson(value: unknown, path = 'data'): JsonValue {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} chứa số không hợp lệ.`);
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => normalizeJson(item, `${path}/${index}`));
  }
  if (isPlainObject(value)) {
    const result: JsonObject = {};
    for (const key of Object.keys(value).sort()) {
      const child = value[key];
      if (child === undefined) throw new Error(`${path}/${key} chứa undefined.`);
      result[key] = normalizeJson(child, `${path}/${key}`);
    }
    return result;
  }
  throw new Error(`${path} chứa kiểu dữ liệu không được hỗ trợ.`);
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeJson(value));
}

export function checksumData(data: unknown): string {
  return createHash('sha256').update(stableStringify(data), 'utf8').digest('hex');
}

function countNode(value: JsonValue): number {
  if (value === null) return 0;
  if (Array.isArray(value)) return value.length;
  if (isPlainObject(value)) return Object.keys(value).length;
  return 1;
}

function getBranchRoot(root: Record<string, unknown>, scope: BackupScope): Record<string, unknown> {
  if (scope.mode === 'legacy-root') return root;
  const companies = isPlainObject(root.companies) ? root.companies : {};
  const company: Record<string, unknown> = scope.companyId && isPlainObject(companies[scope.companyId])
    ? companies[scope.companyId] as Record<string, unknown>
    : {};
  const branches = isPlainObject(company.branches) ? company.branches : {};
  return scope.branchId && isPlainObject(branches[scope.branchId])
    ? branches[scope.branchId] as Record<string, unknown>
    : {};
}

function sanitizeUsers(rawUsers: unknown, scope: BackupScope): JsonValue {
  if (!isPlainObject(rawUsers)) return null;
  const users: JsonObject = {};
  for (const [uid, rawProfile] of Object.entries(rawUsers)) {
    if (!DATABASE_KEY_PATTERN.test(uid) || !isPlainObject(rawProfile)) continue;
    if (scope.mode === 'scoped-branch' && rawProfile.scopeKey !== scope.scopeKey) continue;
    const profile: JsonObject = {};
    for (const field of Object.keys(rawProfile).sort()) {
      if (!USER_PROFILE_FIELDS.has(field) || FORBIDDEN_KEY.test(field)) continue;
      const value = rawProfile[field];
      if (value !== undefined) profile[field] = sanitizeProfileValue(value, `users/${uid}/${field}`);
    }
    users[uid] = profile;
  }
  return Object.keys(users).length ? users : null;
}

function sanitizeProfileValue(value: unknown, path: string): JsonValue {
  if (Array.isArray(value)) return value.map((item, index) => sanitizeProfileValue(item, `${path}/${index}`));
  if (isPlainObject(value)) {
    const result: JsonObject = {};
    for (const key of Object.keys(value).sort()) {
      if (FORBIDDEN_KEY.test(key)) continue;
      result[key] = sanitizeProfileValue(value[key], `${path}/${key}`);
    }
    return result;
  }
  return normalizeJson(value, path);
}

function assertSafeUsers(value: unknown): void {
  if (value === null) return;
  if (!isPlainObject(value)) throw new Error('Node users trong tệp phải là object hoặc null.');
  const inspect = (current: unknown, path: string): void => {
    if (Array.isArray(current)) {
      current.forEach((item, index) => inspect(item, `${path}/${index}`));
      return;
    }
    if (!isPlainObject(current)) return;
    for (const [key, child] of Object.entries(current)) {
      if (FORBIDDEN_KEY.test(key)) throw new Error(`${path}/${key} là trường nhạy cảm không được phép.`);
      inspect(child, `${path}/${key}`);
    }
  };
  for (const [uid, profile] of Object.entries(value)) {
    if (!DATABASE_KEY_PATTERN.test(uid) || !isPlainObject(profile)) throw new Error(`Hồ sơ users/${uid} không hợp lệ.`);
    const sensitive = Object.keys(profile).filter((field) => FORBIDDEN_KEY.test(field));
    if (sensitive.length) throw new Error(`users/${uid} chứa trường nhạy cảm không được phép: ${sensitive.join(', ')}.`);
    const unknown = Object.keys(profile).filter((field) => !USER_PROFILE_FIELDS.has(field));
    if (unknown.length) throw new Error(`users/${uid} chứa trường không được phép: ${unknown.join(', ')}.`);
    inspect(profile, `users/${uid}`);
  }
}

export function extractBusinessData(
  rootValue: unknown,
  scope: BackupScope,
): Record<BackupNode, JsonValue> {
  const root = isPlainObject(rootValue) ? rootValue : {};
  const branch = getBranchRoot(root, scope);
  const data = {} as Record<BackupNode, JsonValue>;
  for (const node of BUSINESS_BACKUP_NODES) {
    data[node] = node === 'users'
      ? sanitizeUsers(root.users, scope)
      : normalizeJson(branch[node] ?? null, node);
  }
  return data;
}

export function buildBackupDocument(input: {
  root: unknown;
  environment: BackupEnvironment;
  appVersion: string;
  createdBy: { uid: string; email: string };
  now: number;
}): BackupDocument {
  const data = extractBusinessData(input.root, input.environment);
  const summary = {} as Record<BackupNode, number>;
  for (const node of BUSINESS_BACKUP_NODES) summary[node] = countNode(data[node]);
  return {
    backupFormat: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: input.appVersion,
    environment: input.environment,
    createdAt: new Date(input.now).toISOString(),
    timestamp: input.now,
    createdBy: input.createdBy,
    summary,
    checksum: checksumData(data),
    data,
  };
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`${label} chứa trường không hỗ trợ: ${unknown.join(', ')}.`);
}

export function validateBackupDocument(input: unknown): BackupDocument {
  if (!isPlainObject(input)) throw new Error('Tệp sao lưu phải là một đối tượng JSON.');
  assertExactKeys(input, [
    'backupFormat', 'schemaVersion', 'appVersion', 'environment', 'createdAt', 'timestamp',
    'createdBy', 'summary', 'checksum', 'data',
  ], 'Tệp sao lưu');
  if (input.backupFormat !== BACKUP_FORMAT) throw new Error('Định dạng tệp sao lưu không đúng.');
  if (input.schemaVersion !== BACKUP_SCHEMA_VERSION) throw new Error('Phiên bản schema sao lưu chưa được hỗ trợ.');
  if (typeof input.appVersion !== 'string' || !input.appVersion.trim()) throw new Error('Thiếu phiên bản ứng dụng.');
  if (!isPlainObject(input.environment)) throw new Error('Thiếu thông tin môi trường.');
  assertExactKeys(input.environment, ['projectId', 'databaseHost', 'mode', 'companyId', 'branchId', 'scopeKey'], 'Môi trường');
  if (typeof input.environment.projectId !== 'string' || typeof input.environment.databaseHost !== 'string') {
    throw new Error('Thông tin Firebase trong tệp không hợp lệ.');
  }
  if (input.environment.mode !== 'legacy-root' && input.environment.mode !== 'scoped-branch') {
    throw new Error('Chế độ dữ liệu trong tệp không hợp lệ.');
  }
  if (input.environment.mode === 'scoped-branch' && (
    typeof input.environment.companyId !== 'string'
    || typeof input.environment.branchId !== 'string'
    || typeof input.environment.scopeKey !== 'string'
  )) throw new Error('Phạm vi công ty/chi nhánh trong tệp không đầy đủ.');
  if (typeof input.createdAt !== 'string' || !Number.isFinite(Date.parse(input.createdAt))) {
    throw new Error('Thời điểm tạo bản sao lưu không hợp lệ.');
  }
  if (!Number.isSafeInteger(input.timestamp) || Math.abs(Date.parse(input.createdAt) - Number(input.timestamp)) > 1_000) {
    throw new Error('Timestamp trong tệp không khớp createdAt.');
  }
  if (!isPlainObject(input.createdBy) || typeof input.createdBy.uid !== 'string' || typeof input.createdBy.email !== 'string') {
    throw new Error('Thông tin người tạo bản sao lưu không hợp lệ.');
  }
  if (!isPlainObject(input.summary) || !isPlainObject(input.data)) throw new Error('Thiếu summary hoặc data.');
  assertExactKeys(input.createdBy, ['uid', 'email'], 'Người tạo');
  assertExactKeys(input.summary, BUSINESS_BACKUP_NODES, 'Summary');
  const rawData = input.data as Record<string, unknown>;
  assertExactKeys(rawData, BUSINESS_BACKUP_NODES, 'Dữ liệu sao lưu');
  const missing = BUSINESS_BACKUP_NODES.filter((node) => !(node in rawData));
  if (missing.length) throw new Error(`Dữ liệu sao lưu thiếu node: ${missing.join(', ')}.`);
  if (typeof input.checksum !== 'string' || !CHECKSUM_PATTERN.test(input.checksum)) {
    throw new Error('Checksum không đúng định dạng SHA-256.');
  }
  const data = normalizeJson(rawData) as Record<BackupNode, JsonValue>;
  assertSafeUsers(data.users);
  if (checksumData(data) !== input.checksum) throw new Error('Checksum không khớp; tệp có thể đã bị sửa hoặc hỏng.');
  const summary = {} as Record<BackupNode, number>;
  for (const node of BUSINESS_BACKUP_NODES) {
    summary[node] = countNode(data[node]);
    if (input.summary[node] !== summary[node]) throw new Error(`Summary của node ${node} không khớp dữ liệu.`);
  }
  return {
    backupFormat: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: input.appVersion,
    environment: input.environment as unknown as BackupEnvironment,
    createdAt: input.createdAt,
    timestamp: Number(input.timestamp),
    createdBy: { uid: input.createdBy.uid as string, email: input.createdBy.email as string },
    summary,
    checksum: input.checksum,
    data,
  };
}

function jsonObject(value: JsonValue | undefined): JsonObject {
  return isPlainObject(value) ? value as JsonObject : {};
}

function sameJson(left: unknown, right: unknown): boolean {
  return stableStringify(left ?? null) === stableStringify(right ?? null);
}

export function compareRestore(
  currentData: Record<BackupNode, JsonValue>,
  backupData: Record<BackupNode, JsonValue>,
  selectedNodes: readonly BackupNode[],
  mode: RestoreMode,
): NodeDiff[] {
  return selectedNodes.map((node) => {
    const current = jsonObject(currentData[node]);
    const incoming = jsonObject(backupData[node]);
    const keys = new Set([...Object.keys(current), ...Object.keys(incoming)]);
    const diff: NodeDiff = { node, added: 0, updated: 0, unchanged: 0, conflicts: 0, removed: 0 };
    for (const key of keys) {
      const hasCurrent = Object.hasOwn(current, key);
      const hasIncoming = Object.hasOwn(incoming, key);
      if (!hasCurrent && hasIncoming) diff.added += 1;
      else if (hasCurrent && !hasIncoming) {
        if (mode === 'replace') diff.removed += 1;
        else diff.unchanged += 1;
      } else if (sameJson(current[key], incoming[key])) diff.unchanged += 1;
      else {
        diff.updated += 1;
        diff.conflicts += 1;
      }
    }
    return diff;
  });
}

function mergeNode(current: unknown, incoming: JsonValue): JsonValue {
  if (incoming === null) return normalizeJson(current ?? null);
  if (!isPlainObject(incoming)) return incoming;
  const base = isPlainObject(current) ? current : {};
  return normalizeJson({ ...base, ...incoming });
}

function ensureScopedBranch(root: Record<string, unknown>, scope: BackupScope): Record<string, unknown> {
  root.companies = isPlainObject(root.companies) ? root.companies : {};
  const companies = root.companies as Record<string, unknown>;
  const companyId = scope.companyId!;
  companies[companyId] = isPlainObject(companies[companyId]) ? companies[companyId] : {};
  const company = companies[companyId] as Record<string, unknown>;
  company.branches = isPlainObject(company.branches) ? company.branches : {};
  const branches = company.branches as Record<string, unknown>;
  const branchId = scope.branchId!;
  branches[branchId] = isPlainObject(branches[branchId]) ? branches[branchId] : {};
  return branches[branchId] as Record<string, unknown>;
}

export function applyRestoreToRoot(input: {
  root: unknown;
  document: BackupDocument;
  selectedNodes: readonly BackupNode[];
  mode: RestoreMode;
  scope: BackupScope;
  actorUid: string;
}): Record<string, unknown> {
  const root = isPlainObject(input.root) ? structuredClone(input.root) : {};
  const target = input.scope.mode === 'legacy-root' ? root : ensureScopedBranch(root, input.scope);
  for (const node of input.selectedNodes) {
    const incoming = input.document.data[node];
    if (node === 'users') {
      const currentUsers = isPlainObject(root.users) ? root.users : {};
      const incomingUsers = jsonObject(incoming);
      if (input.mode === 'replace') {
        const restoredAdmin = incomingUsers[input.actorUid];
        if (!isPlainObject(restoredAdmin)
          || restoredAdmin.role !== 'admin'
          || restoredAdmin.status !== 'active') {
          throw new Error('Không thể thay thế users vì bản sao lưu không giữ tài khoản admin hiện tại ở trạng thái active.');
        }
        if (input.scope.mode === 'scoped-branch') {
          for (const [uid, profile] of Object.entries(currentUsers)) {
            if (isPlainObject(profile) && profile.scopeKey === input.scope.scopeKey) delete currentUsers[uid];
          }
          root.users = { ...currentUsers, ...incomingUsers };
        } else root.users = incomingUsers;
      } else root.users = { ...currentUsers, ...incomingUsers };
      continue;
    }
    target[node] = input.mode === 'replace' ? incoming : mergeNode(target[node], incoming);
  }
  return root;
}

export function relationshipWarnings(selectedNodes: readonly BackupNode[]): string[] {
  const selected = new Set(selectedNodes);
  const warnings: string[] = [];
  const ticketNodes: BackupNode[] = ['importTickets', 'exportTickets', 'salesTickets'];
  if (ticketNodes.some((node) => selected.has(node)) && !selected.has('products')) {
    warnings.push('Chứng từ được chọn nhưng sản phẩm không được chọn; có thể phát sinh tham chiếu sản phẩm thiếu.');
  }
  if (selected.has('operations') && !ticketNodes.every((node) => selected.has(node))) {
    warnings.push('Nghiệp vụ được chọn nhưng chưa chọn đủ các loại chứng từ liên quan.');
  }
  if ((selected.has('categories') || selected.has('suppliers')) && !selected.has('products')) {
    warnings.push('Danh mục/nhà cung cấp được chọn riêng; sản phẩm hiện tại có thể không đồng bộ tên tham chiếu.');
  }
  if (selected.has('users')) warnings.push('Khôi phục hồ sơ users không tạo lại tài khoản Firebase Authentication hoặc mật khẩu.');
  if (selected.has('auditLogs')) warnings.push('Audit nghiệp vụ được chọn; nên kiểm tra các operation/chứng từ liên quan sau khi khôi phục.');
  return warnings;
}

export function auditIntegrity(data: Record<BackupNode, JsonValue>): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const products = jsonObject(data.products);
  const categories = jsonObject(data.categories);
  const legacyCategories = jsonObject(data.productCategories);
  const suppliers = jsonObject(data.suppliers);
  const legacySuppliers = jsonObject(data.partners);
  const users = jsonObject(data.users);
  const add = (issue: IntegrityIssue) => { if (issues.length < 100) issues.push(issue); };
  for (const [id, value] of Object.entries(products)) {
    if (!isPlainObject(value)) {
      add({ level: 'error', code: 'INVALID_PRODUCT', path: `products/${id}`, message: 'Bản ghi sản phẩm không phải object.' });
      continue;
    }
    if (!Number.isFinite(value.quantity) || Number(value.quantity) < 0) {
      add({ level: 'error', code: 'INVALID_STOCK', path: `products/${id}/quantity`, message: 'Tồn kho không hợp lệ.' });
    }
    const categoryId = typeof value.categoryId === 'string' ? value.categoryId : '';
    if (categoryId && !categories[categoryId] && !legacyCategories[categoryId]) {
      add({ level: 'warning', code: 'MISSING_CATEGORY', path: `products/${id}/categoryId`, message: `Không tìm thấy danh mục ${categoryId}.` });
    }
    const supplierId = typeof value.supplierId === 'string' ? value.supplierId : '';
    if (supplierId && !suppliers[supplierId] && !legacySuppliers[supplierId]) {
      add({ level: 'warning', code: 'MISSING_SUPPLIER', path: `products/${id}/supplierId`, message: `Không tìm thấy nhà cung cấp ${supplierId}.` });
    }
  }
  for (const ticketNode of ['importTickets', 'exportTickets', 'salesTickets'] as const) {
    for (const [ticketId, value] of Object.entries(jsonObject(data[ticketNode]))) {
      if (!isPlainObject(value)) continue;
      const rawItems = Array.isArray(value.items) ? value.items : [value];
      rawItems.forEach((rawItem, index) => {
        if (!isPlainObject(rawItem)) return;
        const productId = typeof rawItem.productId === 'string' ? rawItem.productId : '';
        if (productId && !products[productId]) {
          add({ level: 'warning', code: 'MISSING_PRODUCT', path: `${ticketNode}/${ticketId}/items/${index}`, message: `Không tìm thấy sản phẩm ${productId}.` });
        }
      });
      const creator = typeof value.createdByUid === 'string' ? value.createdByUid : '';
      if (creator && !users[creator]) {
        add({ level: 'warning', code: 'MISSING_CREATOR', path: `${ticketNode}/${ticketId}`, message: `Không tìm thấy hồ sơ người tạo ${creator}.` });
      }
    }
  }
  return issues;
}
