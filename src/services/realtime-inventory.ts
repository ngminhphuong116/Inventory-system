import {
  get,
  onValue,
  push,
  ref,
  runTransaction,
  type DataSnapshot,
} from 'firebase/database';
import {
  applyCancel,
  applyCreate,
  InventoryError,
  type OperationType,
  type ProductRecord,
  type RootData,
  type TicketRecord,
} from '../../functions/src/inventory-engine';
import {
  assertValidPathSegment,
  normalizeOptionalText,
  normalizeProductCode,
  parseSafeNumber,
} from './data-integrity';
import { getFirebaseInstance } from './firebase';
import { normalizeDirectoryNameKey } from './legacy-directory';
import { withArchivedState } from './account-management';
import { canRole } from '../auth/access-policy';

type ProductBranchData = {
  products?: Record<string, ProductRecord>;
  categories?: Record<string, DirectoryRecord>;
  productCategories?: Record<string, DirectoryRecord | string>;
  suppliers?: Record<string, DirectoryRecord>;
  partners?: Record<string, DirectoryRecord | string>;
  productMutations?: Record<string, Record<string, unknown>>;
  auditLogs?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
};

interface DirectoryRecord {
  name: string;
  createdAt?: number;
  createdByUid?: string;
  updatedAt?: number;
  updatedByUid?: string;
}

export interface WarehouseScope {
  uid: string;
  email: string;
  role: 'admin' | 'staff';
  permissions: Record<string, boolean>;
}

type Permission = 'product' | 'import' | 'export' | 'sales';

export function permissionsForRole(role: 'admin' | 'staff'): Record<Permission, boolean> {
  return {
    product: canRole(role, 'manageProducts'),
    import: canRole(role, 'createImport'),
    export: canRole(role, 'createExport'),
    sales: canRole(role, 'createSale'),
  };
}

const ticketNode = (type: OperationType) =>
  type === 'import' ? 'importTickets'
    : type === 'export' ? 'exportTickets'
      : 'salesTickets';

function requireText(value: unknown, label: string, maxLength: number): string {
  const result = normalizeOptionalText(value, maxLength);
  if (!result) {
    throw new InventoryError('invalid-argument', `${label} không hợp lệ.`);
  }
  return result;
}

function requireMoney(value: unknown, label: string): number {
  try {
    return parseSafeNumber(value, label, { min: 0 });
  } catch {
    throw new InventoryError('invalid-argument', `${label} không hợp lệ.`);
  }
}

function normalizeProduct(product: Record<string, unknown>) {
  let categoryId = '';
  let supplierId = '';
  try {
    if (normalizeOptionalText(product.categoryId)) {
      categoryId = assertValidPathSegment(product.categoryId, 'categoryId');
    }
    if (normalizeOptionalText(product.supplierId)) {
      supplierId = assertValidPathSegment(product.supplierId, 'supplierId');
    }
  } catch (error) {
    throw new InventoryError(
      'invalid-argument',
      error instanceof Error ? error.message : 'Danh mục hoặc nhà cung cấp không hợp lệ.',
    );
  }
  return {
    code: normalizeProductCode(product.code),
    name: requireText(product.name, 'Tên sản phẩm', 200),
    unit: requireText(product.unit, 'Đơn vị tính', 50),
    category: requireText(product.category, 'Danh mục', 100),
    ...(categoryId ? { categoryId } : {}),
    supplier: normalizeOptionalText(product.supplier, 200),
    supplierId,
    importPrice: requireMoney(product.importPrice, 'Giá nhập'),
    salePrice: requireMoney(product.salePrice, 'Giá bán'),
    minStock: requireMoney(product.minStock, 'Tồn tối thiểu'),
    description: normalizeOptionalText(product.description, 500),
  };
}

export async function getWarehouseScope(
  permission?: Permission,
): Promise<WarehouseScope> {
  const { auth, rtdb } = getFirebaseInstance();
  const user = auth.currentUser;
  if (!user) throw new InventoryError('unauthenticated', 'Phiên đăng nhập đã hết hạn.');

  const snapshot = await get(ref(rtdb, `users/${user.uid}`));
  const profile = snapshot.val() as Record<string, unknown> | null;
  if (!profile) throw new InventoryError('permission-denied', 'Không tìm thấy hồ sơ tài khoản.');
  const role = profile.role === 'admin' ? 'admin'
    : profile.role === 'staff' ? 'staff'
      : null;
  if (!role) {
    throw new InventoryError('permission-denied', 'Tài khoản không có quyền thao tác kho.');
  }
  if (profile.status !== 'active') {
    throw new InventoryError('permission-denied', 'Tài khoản không hoạt động.');
  }
  try {
    assertValidPathSegment(user.uid, 'UID người dùng');
  } catch {
    throw new InventoryError('permission-denied', 'UID tài khoản không hợp lệ.');
  }
  const permissions = permissionsForRole(role);
  if (permission && role !== 'admin' && permissions[permission] !== true) {
    throw new InventoryError('permission-denied', 'Bạn không có quyền thực hiện thao tác này.');
  }

  return {
    uid: user.uid,
    email: user.email || '',
    role,
    permissions,
  };
}

export function buildWarehousePath(
  _scope: WarehouseScope,
  node?: string,
): string | null {
  if (node) assertValidPathSegment(node, 'database node');
  return node || null;
}

function warehouseRef(scope: WarehouseScope, node?: string) {
  const { rtdb } = getFirebaseInstance();
  const path = buildWarehousePath(scope, node);
  return path ? ref(rtdb, path) : ref(rtdb);
}

function cloneData<T>(value: T): T {
  return value == null ? value : structuredClone(value);
}

export function subscribeBranchNode(
  node: string,
  callback: (snapshot: DataSnapshot) => void,
  onError?: (error: Error) => void,
): () => void {
  let unsubscribe: (() => void) | undefined;
  let disposed = false;
  void getWarehouseScope()
    .then((scope) => {
      if (disposed) return;
      const target = warehouseRef(scope, node);
      unsubscribe = onValue(target, callback, (error) => onError?.(error));
    })
    .catch((error) => onError?.(error as Error));
  return () => {
    disposed = true;
    unsubscribe?.();
  };
}

export function subscribeScopedUsers(
  callback: (snapshot: DataSnapshot) => void,
  onError?: (error: Error) => void,
): () => void {
  let unsubscribe: (() => void) | undefined;
  let disposed = false;
  void getWarehouseScope()
    .then((scope) => {
      if (disposed) return;
      if (scope.role !== 'admin') {
        throw new InventoryError('permission-denied', 'Chỉ quản trị viên được xem người dùng.');
      }
      unsubscribe = onValue(
        ref(getFirebaseInstance().rtdb, 'users'),
        callback,
        (error) => onError?.(error),
      );
    })
    .catch((error) => onError?.(error as Error));
  return () => {
    disposed = true;
    unsubscribe?.();
  };
}

export const realtimeInventory = {
  async saveBusinessSettings(
    input: Record<string, unknown>,
  ): Promise<void> {
    const scope = await getWarehouseScope();
    if (scope.role !== 'admin') {
      throw new InventoryError(
        'permission-denied',
        'Chỉ quản trị viên được thay đổi thông tin doanh nghiệp.',
      );
    }
    const businessName = requireText(input.businessName, 'Tên doanh nghiệp', 200);
    const address = normalizeOptionalText(input.address, 300);
    const phone = normalizeOptionalText(input.phone, 50);
    const result = await runTransaction(
      warehouseRef(scope, 'settings'),
      (current: Record<string, unknown> | null) => ({
        ...(current || {}),
        businessName,
        address,
        phone,
        updatedAt: Date.now(),
        updatedByUid: scope.uid,
      }),
      { applyLocally: false },
    );
    if (!result.committed) {
      throw new InventoryError('aborted', 'Không thể lưu thông tin doanh nghiệp.');
    }
  },

  async saveDirectoryEntry(
    node: 'categories' | 'suppliers',
    nameInput: unknown,
    requestId: string,
    id?: string,
  ): Promise<{ id: string; duplicate: boolean }> {
    const scope = await getWarehouseScope('product');
    if (scope.role !== 'admin') {
      throw new InventoryError(
        'permission-denied',
        'Chỉ quản trị viên được cập nhật danh mục và nhà cung cấp.',
      );
    }
    const label = node === 'categories' ? 'Tên danh mục' : 'Tên nhà cung cấp';
    const name = requireText(nameInput, label, 200);
    let recordId: string;
    try {
      recordId = assertValidPathSegment(id || requestId, id ? 'recordId' : 'requestId');
      assertValidPathSegment(requestId, 'requestId');
    } catch (error) {
      throw new InventoryError(
        'invalid-argument',
        error instanceof Error ? error.message : `${label} không hợp lệ.`,
      );
    }

    let duplicate = false;
    const directoryRef = warehouseRef(scope, node);
    const result = await runTransaction(
      directoryRef,
      (current: Record<string, DirectoryRecord | string> | null) => {
        const directory = current ? cloneData(current) : {};
        const conflictingEntry = Object.entries(directory).find(([candidateId, value]) => {
          const candidateName = typeof value === 'string' ? value : value?.name;
          return candidateId !== recordId
            && normalizeDirectoryNameKey(candidateName) === normalizeDirectoryNameKey(name);
        });
        if (conflictingEntry) {
          if (!id) {
            recordId = conflictingEntry[0];
            duplicate = true;
            return directory;
          }
          throw new InventoryError(
            'directory-name-exists',
            `${label} đã tồn tại.`,
          );
        }

        const existing = directory[recordId];
        if (id && existing == null) {
          throw new InventoryError('directory-not-found', 'Không tìm thấy bản ghi cần sửa.');
        }
        const existingName = typeof existing === 'string' ? existing : existing?.name;
        if (!id && existing != null) {
          if (
            normalizeDirectoryNameKey(existingName) !== normalizeDirectoryNameKey(name)
          ) {
            throw new InventoryError(
              'operation-conflict',
              'Mã yêu cầu đã được dùng cho một bản ghi khác.',
            );
          }
          duplicate = true;
          return directory;
        }
        const existingRecord: Partial<DirectoryRecord> =
          typeof existing === 'object' && existing ? existing : {};
        const now = Date.now();
        directory[recordId] = {
          ...existingRecord,
          name,
          createdAt: existingRecord.createdAt ?? now,
          createdByUid: existingRecord.createdByUid ?? scope.uid,
          updatedAt: now,
          updatedByUid: scope.uid,
        };
        return directory;
      },
      { applyLocally: false },
    );
    if (!result.committed) {
      throw new InventoryError('aborted', `Không thể lưu ${label.toLocaleLowerCase('vi-VN')}.`);
    }
    return { id: recordId, duplicate };
  },

  async createOperation(
    type: OperationType,
    ticket: TicketRecord,
    operationId: string,
  ): Promise<{ operationId: string; ticketKey: string; duplicate: boolean }> {
    const permission = type === 'sale' ? 'sales' : type;
    const scope = await getWarehouseScope(permission);
    try {
      assertValidPathSegment(operationId, 'operationId');
    } catch {
      throw new InventoryError('invalid-argument', 'Operation ID không hợp lệ.');
    }
    const rootRef = warehouseRef(scope);
    const ticketKey = push(warehouseRef(scope, ticketNode(type))).key;
    if (!ticketKey) throw new InventoryError('internal', 'Không thể tạo mã chứng từ.');

    const initialRoot = (await get(rootRef)).val() as RootData | null;
    let duplicate = false;
    const result = await runTransaction(rootRef, (current: RootData | null) => {
      const root = current ?? cloneData(initialRoot) ?? {};
      const outcome = applyCreate(root, {
        type,
        ticketKey,
        operationId,
        ticket: {
          ...ticket,
        },
        actorUid: scope.uid,
        actorEmail: scope.email,
        now: Date.now(),
      });
      duplicate = outcome === 'duplicate';
      return duplicate ? undefined : root;
    }, { applyLocally: false });
    if (!result.committed) {
      const latestRoot = (await get(rootRef)).val() as RootData | null;
      const existingOperation = latestRoot?.operations?.[operationId];
      if (existingOperation?.action === 'create' && existingOperation.type === type) {
        return {
          operationId,
          ticketKey: existingOperation.ticketKey,
          duplicate: true,
        };
      }
      throw new InventoryError('aborted', 'Giao dịch bị hủy do xung đột dữ liệu.');
    }
    const committedOperation = (
      result.snapshot.val() as RootData | null
    )?.operations?.[operationId];
    return {
      operationId,
      ticketKey: committedOperation?.ticketKey || ticketKey,
      duplicate,
    };
  },

  async cancelOperation(
    type: OperationType,
    key: string,
    operationId: string,
    reason: string,
  ): Promise<{ operationId: string; duplicate: boolean }> {
    const scope = await getWarehouseScope();
    if (scope.role !== 'admin') {
      throw new InventoryError('permission-denied', 'Chỉ quản trị viên được hủy chứng từ.');
    }
    try {
      assertValidPathSegment(key, 'ticketId');
      assertValidPathSegment(operationId, 'operationId');
    } catch {
      throw new InventoryError('invalid-argument', 'Thông tin hủy chứng từ không hợp lệ.');
    }
    if (!reason.trim()) {
      throw new InventoryError('invalid-argument', 'Thông tin hủy chứng từ không hợp lệ.');
    }
    let duplicate = false;
    const rootRef = warehouseRef(scope);
    const initialRoot = (await get(rootRef)).val() as RootData | null;
    const result = await runTransaction(
      rootRef,
      (current: RootData | null) => {
        const root = current ?? cloneData(initialRoot) ?? {};
        duplicate = applyCancel(root, {
          type,
          ticketKey: key,
          operationId,
          actorUid: scope.uid,
          actorEmail: scope.email,
          reason: reason.trim().slice(0, 300),
          now: Date.now(),
        }) === 'duplicate';
        return root;
      },
      { applyLocally: false },
    );
    if (!result.committed) {
      throw new InventoryError('aborted', 'Không thể hủy chứng từ.');
    }
    return { operationId, duplicate };
  },

  async saveProduct(
    productInput: Record<string, unknown>,
    requestId: string,
    id?: string,
  ): Promise<{ id: string; duplicate: boolean }> {
    const scope = await getWarehouseScope('product');
    if (scope.role !== 'admin') {
      throw new InventoryError('permission-denied', 'Chỉ quản trị viên được lưu sản phẩm.');
    }
    const product = normalizeProduct(productInput);
    const productId = id || push(warehouseRef(scope, 'products')).key;
    try {
      assertValidPathSegment(productId, 'productId');
      assertValidPathSegment(requestId, 'requestId');
    } catch {
      throw new InventoryError('invalid-argument', 'Mã yêu cầu hoặc sản phẩm không hợp lệ.');
    }
    let duplicate = false;
    const rootRef = warehouseRef(scope);
    const initialRoot = (await get(rootRef)).val() as ProductBranchData | null;
    const result = await runTransaction(
      rootRef,
      (current: ProductBranchData | null) => {
        const root = current ?? cloneData(initialRoot) ?? {};
        root.productMutations ??= {};
        const prior = root.productMutations[requestId] as Record<string, unknown> | undefined;
        if (prior) {
          if (prior.action !== 'save' || (id && prior.productId !== productId)) {
            throw new InventoryError('operation-conflict', 'Mã yêu cầu đã được sử dụng.');
          }
          duplicate = true;
          return root;
        }
        root.products ??= {};
        const existing = root.products[productId];
        if (id && !existing) throw new InventoryError('product-not-found', 'Không tìm thấy sản phẩm.');
        const codeExists = Object.entries(root.products).some(([candidateId, candidate]) =>
          candidateId !== productId
          && String(candidate.code || '').trim().toUpperCase() === product.code
        );
        if (codeExists) throw new InventoryError('product-code-exists', 'Mã sản phẩm đã tồn tại.');
        const preservingEmbeddedLegacyCategory = Boolean(
          existing
          && !product.categoryId
          && normalizeDirectoryNameKey(product.category)
            === normalizeDirectoryNameKey(existing.category),
        );
        if (!product.categoryId && !preservingEmbeddedLegacyCategory) {
          throw new InventoryError(
            'category-not-found',
            'Vui lòng chọn hoặc tạo một danh mục hợp lệ.',
          );
        }
        if (
          product.categoryId
          && !root.categories?.[product.categoryId]
          && !root.productCategories?.[product.categoryId]
        ) {
          throw new InventoryError(
            'category-not-found',
            'Danh mục đã chọn không còn tồn tại. Vui lòng tải lại danh sách.',
          );
        }
        if (
          product.supplierId
          && !root.suppliers?.[product.supplierId]
          && !root.partners?.[product.supplierId]
        ) {
          throw new InventoryError(
            'supplier-not-found',
            'Nhà cung cấp đã chọn không còn tồn tại. Vui lòng tải lại danh sách.',
          );
        }
        const now = Date.now();
        root.products[productId] = {
          ...(existing || {}),
          ...product,
          quantity: existing?.quantity ?? 0,
          status: existing?.status ?? 'Critical',
          archived: false,
          createdAt: existing?.createdAt ?? now,
          createdByUid: existing?.createdByUid ?? scope.uid,
          updatedAt: now,
          updatedByUid: scope.uid,
        };
        root.productMutations[requestId] = {
          action: 'save',
          productId,
          actorUid: scope.uid,
          createdAt: now,
        };
        root.auditLogs ??= {};
        root.auditLogs[requestId] = {
          action: existing ? 'update-product' : 'create-product',
          type: 'import',
          ticketKey: productId,
          actorUid: scope.uid,
          actorEmail: scope.email,
          createdAt: now,
        };
        return root;
      },
      { applyLocally: false },
    );
    if (!result.committed) throw new InventoryError('aborted', 'Không thể lưu sản phẩm.');
    const mutation = (
      result.snapshot.val() as ProductBranchData | null
    )?.productMutations?.[requestId] as Record<string, unknown> | undefined;
    return { id: String(mutation?.productId || productId), duplicate };
  },

  async archiveProduct(id: string, requestId: string): Promise<void> {
    const scope = await getWarehouseScope('product');
    if (scope.role !== 'admin') {
      throw new InventoryError('permission-denied', 'Chỉ quản trị viên được lưu trữ sản phẩm.');
    }
    try {
      assertValidPathSegment(id, 'productId');
      assertValidPathSegment(requestId, 'requestId');
    } catch {
      throw new InventoryError('invalid-argument', 'Mã sản phẩm không hợp lệ.');
    }
    const rootRef = warehouseRef(scope);
    const initialRoot = (await get(rootRef)).val() as ProductBranchData | null;
    const result = await runTransaction(
      rootRef,
      (current: ProductBranchData | null) => {
        const root = current ?? cloneData(initialRoot) ?? {};
        root.productMutations ??= {};
        const prior = root.productMutations[requestId] as Record<string, unknown> | undefined;
        if (prior) {
          if (prior.action === 'archive' && prior.productId === id) return root;
          throw new InventoryError('operation-conflict', 'Mã yêu cầu đã được sử dụng.');
        }
        const product = root.products?.[id];
        if (!product) throw new InventoryError('product-not-found', 'Không tìm thấy sản phẩm.');
        if (Number(product.quantity) !== 0) {
          throw new InventoryError(
            'stock-not-zero',
            'Không thể lưu trữ sản phẩm khi tồn kho còn lớn hơn 0.',
          );
        }
        const now = Date.now();
        product.archived = true;
        product.archivedAt = now;
        product.archivedByUid = scope.uid;
        root.productMutations[requestId] = {
          action: 'archive',
          productId: id,
          actorUid: scope.uid,
          createdAt: now,
        };
        root.auditLogs ??= {};
        root.auditLogs[requestId] = {
          action: 'archive-product',
          type: 'import',
          ticketKey: id,
          actorUid: scope.uid,
          actorEmail: scope.email,
          createdAt: now,
        };
        return root;
      },
      { applyLocally: false },
    );
    if (!result.committed) throw new InventoryError('aborted', 'Không thể lưu trữ sản phẩm.');
  },

  async setUserStatus(
    uid: string,
    status: 'active' | 'disabled',
    requestId: string,
  ): Promise<void> {
    const scope = await getWarehouseScope();
    let validUid = true;
    try {
      assertValidPathSegment(uid, 'UID người dùng');
      assertValidPathSegment(requestId, 'requestId');
    } catch {
      validUid = false;
    }
    if (scope.role !== 'admin' || uid === scope.uid || !validUid) {
      throw new InventoryError('permission-denied', 'Không thể thay đổi tài khoản này.');
    }
    const userRef = ref(getFirebaseInstance().rtdb, `users/${uid}`);
    const initialUser = (
      await get(userRef)
    ).val() as Record<string, unknown> | null;
    const result = await runTransaction(
      userRef,
      (current: Record<string, unknown> | null) => {
        current ??= cloneData(initialUser);
        if (!current) throw new InventoryError('user-not-found', 'Không tìm thấy tài khoản.');
        if (
          current.role === 'admin'
        ) {
          throw new InventoryError('permission-denied', 'Tài khoản nằm ngoài phạm vi quản lý.');
        }
        if (current.archived === true) {
          throw new InventoryError(
            'failed-precondition',
            'Tài khoản đã lưu trữ. Hãy khôi phục trước khi thay đổi trạng thái.',
          );
        }
        const operations = (
          current.adminOperations && typeof current.adminOperations === 'object'
            ? current.adminOperations
            : {}
        ) as Record<string, unknown>;
        if (operations[requestId]) return current;
        return {
          ...current,
          status,
          statusChangedAt: Date.now(),
          statusChangedByUid: scope.uid,
          adminOperations: {
            ...operations,
            [requestId]: { action: `status-${status}`, actorUid: scope.uid, createdAt: Date.now() },
          },
        };
      },
      { applyLocally: false },
    );
    if (!result.committed) throw new InventoryError('aborted', 'Không thể cập nhật tài khoản.');
  },

  async setUserArchived(
    uid: string,
    archived: boolean,
    requestId: string,
  ): Promise<void> {
    const scope = await getWarehouseScope();
    try {
      assertValidPathSegment(uid, 'UID người dùng');
      assertValidPathSegment(requestId, 'requestId');
    } catch (error) {
      throw new InventoryError(
        'invalid-argument',
        error instanceof Error ? error.message : 'UID người dùng không hợp lệ.',
      );
    }
    if (scope.role !== 'admin' || uid === scope.uid) {
      throw new InventoryError('permission-denied', 'Không thể lưu trữ tài khoản này.');
    }

    const userRef = ref(getFirebaseInstance().rtdb, `users/${uid}`);
    const initialUser = (await get(userRef)).val() as Record<string, unknown> | null;
    const result = await runTransaction(
      userRef,
      (current: Record<string, unknown> | null) => {
        current ??= cloneData(initialUser);
        if (!current) {
          throw new InventoryError('user-not-found', 'Không tìm thấy tài khoản.');
        }
        if (current.role === 'admin') {
          throw new InventoryError(
            'failed-precondition',
            'Không thể lưu trữ tài khoản quản trị viên.',
          );
        }
        const operations = (
          current.adminOperations && typeof current.adminOperations === 'object'
            ? current.adminOperations
            : {}
        ) as Record<string, unknown>;
        if (operations[requestId]) return current;
        const now = Date.now();
        return {
          ...withArchivedState(current, archived, scope.uid, now),
          adminOperations: {
            ...operations,
            [requestId]: {
              action: archived ? 'archive' : 'restore',
              actorUid: scope.uid,
              createdAt: now,
            },
          },
        };
      },
      { applyLocally: false },
    );
    if (!result.committed) {
      throw new InventoryError(
        'aborted',
        archived ? 'Không thể lưu trữ tài khoản.' : 'Không thể khôi phục tài khoản.',
      );
    }
  },
};
