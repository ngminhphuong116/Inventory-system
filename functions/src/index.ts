import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2/options';
import {
  applyCancel,
  applyCreate,
  InventoryError,
  type OperationType,
  type RootData,
  type TicketRecord,
} from './inventory-engine.js';
import {
  assertDeletionAllowed,
  deleteUserWorkflow,
  UserDeletionError,
} from './user-deletion.js';
import {
  BACKUP_FORMAT,
  BUSINESS_BACKUP_NODES,
  applyRestoreToRoot,
  auditIntegrity,
  buildBackupDocument,
  checksumData,
  compareRestore,
  extractBusinessData,
  isActiveAdminProfile,
  relationshipWarnings,
  validateBackupDocument,
  type BackupEnvironment,
  type BackupNode,
  type BackupScope,
  type RestoreMode,
} from './backup-engine.js';

initializeApp();
setGlobalOptions({
  region: 'us-central1',
  maxInstances: 20,
  timeoutSeconds: 60,
});

const validTypes = new Set<OperationType>(['import', 'export', 'sale']);
const validOperationId = /^[A-Za-z0-9_-]{8,128}$/;
const validDatabaseKey = /^[^.#$[\]/]{1,128}$/;

function requireAuth(request: { auth?: { uid: string; token: Record<string, unknown> } }) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Bạn cần đăng nhập.');
  return request.auth;
}

async function requireAdmin(uid: string): Promise<void> {
  const profile = (await getDatabase().ref(`users/${uid}`).get()).val();
  if (profile?.role !== 'admin' || profile?.status === 'disabled' || profile?.status === 'deleting') {
    throw new HttpsError('permission-denied', 'Chỉ quản trị viên đang hoạt động được phép thực hiện thao tác này.');
  }
}

async function requireActiveAdmin(uid: string): Promise<Record<string, unknown>> {
  const profile = (await getDatabase().ref(`users/${uid}`).get()).val();
  if (!isActiveAdminProfile(profile)) {
    throw new HttpsError('permission-denied', 'Chỉ quản trị viên đang hoạt động được phép sao lưu hoặc khôi phục dữ liệu.');
  }
  return profile as Record<string, unknown>;
}

function backupScopeFromProfile(profile: Record<string, unknown>): BackupScope {
  const companyId = typeof profile.companyId === 'string' ? profile.companyId.trim() : '';
  const branchId = typeof profile.branchId === 'string' ? profile.branchId.trim() : '';
  const scopeKey = typeof profile.scopeKey === 'string' ? profile.scopeKey.trim() : '';
  if (companyId && branchId && scopeKey === `${companyId}__${branchId}`) {
    return { mode: 'scoped-branch', companyId, branchId, scopeKey };
  }
  return { mode: 'legacy-root' };
}

function currentBackupEnvironment(scope: BackupScope): BackupEnvironment {
  const database = getDatabase();
  const rawUrl = String(database.app.options.databaseURL || '');
  const databaseHost = (() => {
    try {
      return rawUrl ? new URL(rawUrl).host : '';
    } catch {
      return rawUrl;
    }
  })();
  return {
    ...scope,
    projectId: String(database.app.options.projectId || process.env.GCLOUD_PROJECT || ''),
    databaseHost,
  };
}

type BackupAuditAction =
  | 'BACKUP_CREATED'
  | 'BACKUP_FAILED'
  | 'RESTORE_FILE_VALIDATED'
  | 'RESTORE_STARTED'
  | 'RESTORE_COMPLETED'
  | 'RESTORE_FAILED'
  | 'RESTORE_CANCELLED';

async function writeBackupAudit(input: {
  action: BackupAuditAction;
  uid: string;
  email: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  const ref = getDatabase().ref('backupRestoreAuditLogs').push();
  await ref.set({
    action: input.action,
    actorUid: input.uid,
    actorEmail: input.email,
    createdAt: Date.now(),
    ...(input.details ? { details: input.details } : {}),
  });
}

function parseRestoreSelection(data: unknown): { selectedNodes: BackupNode[]; mode: RestoreMode } {
  const raw = data as { selectedNodes?: unknown; mode?: unknown };
  if (!Array.isArray(raw?.selectedNodes) || raw.selectedNodes.length === 0) {
    throw new HttpsError('invalid-argument', 'Vui lòng chọn ít nhất một nhóm dữ liệu.');
  }
  const selectedNodes = [...new Set(raw.selectedNodes)].filter(
    (node): node is BackupNode => typeof node === 'string' && BUSINESS_BACKUP_NODES.includes(node as BackupNode),
  );
  if (selectedNodes.length !== raw.selectedNodes.length) {
    throw new HttpsError('invalid-argument', 'Danh sách node khôi phục không hợp lệ hoặc bị trùng.');
  }
  if (raw.mode !== 'merge' && raw.mode !== 'replace') {
    throw new HttpsError('invalid-argument', 'Chế độ khôi phục không hợp lệ.');
  }
  return { selectedNodes, mode: raw.mode };
}

async function requirePermission(uid: string, permission: 'import' | 'export' | 'sales'): Promise<void> {
  const profile = (await getDatabase().ref(`users/${uid}`).get()).val();
  const active = profile && profile.status !== 'disabled' && profile.status !== 'deleting';
  const allowed = profile?.role === 'admin'
    || (
      profile?.role === 'staff'
      && (
        profile?.permissions?.[permission] === true
        || profile?.permissions?.[permission] === undefined
      )
    );
  if (!active || !allowed) {
    throw new HttpsError('permission-denied', 'Tài khoản không có quyền thực hiện nghiệp vụ này.');
  }
}

function parseCommon(data: unknown): { type: OperationType; operationId: string } {
  const value = data as Record<string, unknown> | null;
  const type = value?.type as OperationType;
  const operationId = value?.operationId;
  if (!validTypes.has(type) || typeof operationId !== 'string' || !validOperationId.test(operationId)) {
    throw new HttpsError('invalid-argument', 'Loại nghiệp vụ hoặc operationId không hợp lệ.');
  }
  return { type, operationId };
}

function parseRequestId(data: unknown): string {
  const requestId = (data as { requestId?: unknown })?.requestId;
  if (typeof requestId !== 'string' || !validOperationId.test(requestId)) {
    throw new HttpsError('invalid-argument', 'requestId không hợp lệ.');
  }
  return requestId;
}

function parseProduct(data: unknown) {
  const product = (data as { product?: Record<string, unknown> })?.product;
  if (!product) throw new HttpsError('invalid-argument', 'Dữ liệu sản phẩm không hợp lệ.');
  const text = (key: string, max: number) => {
    const value = String(product[key] || '').trim();
    if (!value || value.length > max) {
      throw new HttpsError('invalid-argument', `${key} không hợp lệ.`);
    }
    return value;
  };
  const money = (key: string) => {
    const value = product[key];
    if (!Number.isSafeInteger(value) || Number(value) < 0) {
      throw new HttpsError('invalid-argument', `${key} không hợp lệ.`);
    }
    return Number(value);
  };
  return {
    code: text('code', 64).toUpperCase(),
    name: text('name', 200),
    unit: text('unit', 50),
    category: text('category', 100),
    supplier: text('supplier', 200),
    importPrice: money('importPrice'),
    salePrice: money('salePrice'),
    minStock: money('minStock'),
    description: String(product.description || '').trim().slice(0, 500),
  };
}

function translateError(error: unknown, referenceId: string): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof InventoryError) {
    const code = error.code === 'insufficient-stock'
      || error.code === 'voucher-precondition'
      || error.code === 'stock-not-zero'
      ? 'failed-precondition'
      : error.code.includes('not-found')
        ? 'not-found'
        : error.code === 'already-cancelled'
          || error.code === 'already-archived'
          || error.code === 'invoice-exists'
          || error.code === 'product-code-exists'
          ? 'already-exists'
          : 'invalid-argument';
    throw new HttpsError(code, error.message, {
      referenceId,
      message: error.message,
    });
  }
  console.error('Inventory operation failed', { referenceId, error });
  throw new HttpsError('internal', 'Không thể hoàn tất nghiệp vụ kho.', {
    referenceId,
  });
}

export const createInventoryOperation = onCall(async (request) => {
  const auth = requireAuth(request);
  const { type, operationId } = parseCommon(request.data);
  await requirePermission(auth.uid, type === 'sale' ? 'sales' : type);
  const ticket = (request.data as { ticket?: TicketRecord }).ticket;
  if (!ticket || typeof ticket !== 'object') {
    throw new HttpsError('invalid-argument', 'Dữ liệu chứng từ không hợp lệ.');
  }

  const database = getDatabase();
  const operationRef = database.ref(`operations/${operationId}`);
  const prior = (await operationRef.get()).val();
  if (prior) {
    if (prior.action !== 'create' || prior.type !== type) {
      throw new HttpsError('already-exists', 'Mã yêu cầu đã được dùng cho một nghiệp vụ khác.');
    }
    return { operationId, ticketKey: prior.ticketKey, duplicate: true };
  }

  const ticketKey = database.ref(
    type === 'import' ? 'importTickets' : type === 'export' ? 'exportTickets' : 'salesTickets',
  ).push().key!;
  const now = Date.now();

  try {
    const result = await database.ref().transaction((current: RootData | null) => {
      const root = current ?? {};
      const outcome = applyCreate(root, {
        type,
        ticketKey,
        operationId,
        ticket,
        actorUid: auth.uid,
        actorEmail: String(auth.token.email || ''),
        now,
      });
      return outcome === 'duplicate' ? undefined : root;
    });

    if (!result.committed) {
      const existing = (await operationRef.get()).val();
      if (existing) return { operationId, ticketKey: existing.ticketKey, duplicate: true };
      throw new HttpsError('aborted', 'Nghiệp vụ bị hủy do xung đột dữ liệu.');
    }
    return { operationId, ticketKey, duplicate: false };
  } catch (error) {
    return translateError(error, operationId);
  }
});

export const cancelInventoryOperation = onCall(async (request) => {
  const auth = requireAuth(request);
  await requireAdmin(auth.uid);
  const { type, operationId } = parseCommon(request.data);
  const key = (request.data as { key?: unknown }).key;
  if (typeof key !== 'string' || !key || /[.#$[\]/]/.test(key)) {
    throw new HttpsError('invalid-argument', 'Mã chứng từ không hợp lệ.');
  }
  const rawReason = (request.data as { reason?: unknown }).reason;
  const reason = typeof rawReason === 'string' ? rawReason.trim().slice(0, 300) : '';
  if (!reason) {
    throw new HttpsError('invalid-argument', 'Vui lòng cung cấp lý do hủy chứng từ.');
  }

  const database = getDatabase();
  const operationRef = database.ref(`operations/${operationId}`);
  const prior = (await operationRef.get()).val();
  if (prior) {
    if (prior.action !== 'cancel' || prior.type !== type || prior.ticketKey !== key) {
      throw new HttpsError('already-exists', 'Mã yêu cầu đã được dùng cho một nghiệp vụ khác.');
    }
    return { operationId, duplicate: true };
  }

  try {
    const result = await database.ref().transaction((current: RootData | null) => {
      const root = current ?? {};
      const outcome = applyCancel(root, {
        type,
        ticketKey: key,
        operationId,
        actorUid: auth.uid,
        actorEmail: String(auth.token.email || ''),
        reason,
        now: Date.now(),
      });
      return outcome === 'duplicate' ? undefined : root;
    });
    if (!result.committed) {
      if ((await operationRef.get()).exists()) return { operationId, duplicate: true };
      throw new HttpsError('aborted', 'Không thể hủy chứng từ do xung đột dữ liệu.');
    }
    return { operationId, duplicate: false };
  } catch (error) {
    return translateError(error, operationId);
  }
});

export const saveWarehouseProduct = onCall(async (request) => {
  const auth = requireAuth(request);
  await requireAdmin(auth.uid);
  const requestId = parseRequestId(request.data);
  const product = parseProduct(request.data);
  const rawId = (request.data as { id?: unknown }).id;
  const id = rawId === undefined
    ? getDatabase().ref('products').push().key!
    : typeof rawId === 'string' && validDatabaseKey.test(rawId)
      ? rawId
      : '';
  if (!id) throw new HttpsError('invalid-argument', 'Mã sản phẩm không hợp lệ.');

  const database = getDatabase();
  const mutationRef = database.ref(`productMutations/${requestId}`);
  const prior = (await mutationRef.get()).val();
  if (prior) {
    if (prior.action !== 'save' || (rawId !== undefined && prior.productId !== id)) {
      throw new HttpsError('already-exists', 'Mã yêu cầu đã được dùng cho thao tác khác.');
    }
    return { id: prior.productId, duplicate: true };
  }

  try {
    const result = await database.ref().transaction((current: Record<string, any> | null) => {
      const root = current ?? {};
      root.productMutations ??= {};
      const duplicate = root.productMutations[requestId];
      if (duplicate) {
        if (
          duplicate.action === 'save'
          && (rawId === undefined || duplicate.productId === id)
        ) return undefined;
        throw new InventoryError('operation-conflict', 'Mã yêu cầu đã được dùng cho thao tác khác.');
      }
      root.products ??= {};
      const existing = root.products[id];
      if (rawId !== undefined && !existing) {
        throw new InventoryError('product-not-found', 'Không tìm thấy sản phẩm.');
      }
      const codeOwner = Object.entries(root.products).find(([candidateId, candidate]: [string, any]) =>
        candidateId !== id && String(candidate.code || '').trim().toUpperCase() === product.code
      );
      if (codeOwner) throw new InventoryError('product-code-exists', `Mã sản phẩm ${product.code} đã tồn tại.`);

      const now = Date.now();
      root.products[id] = {
        ...(existing || {}),
        ...product,
        quantity: existing?.quantity ?? 0,
        status: existing?.status ?? 'Critical',
        archived: false,
        createdAt: existing?.createdAt ?? now,
        createdByUid: existing?.createdByUid ?? auth.uid,
        updatedAt: now,
        updatedByUid: auth.uid,
      };
      root.productMutations[requestId] = {
        action: 'save',
        productId: id,
        actorUid: auth.uid,
        createdAt: now,
      };
      root.auditLogs ??= {};
      root.auditLogs[requestId] = {
        action: existing ? 'update-product' : 'create-product',
        productId: id,
        actorUid: auth.uid,
        actorEmail: String(auth.token.email || ''),
        createdAt: now,
      };
      return root;
    });
    if (!result.committed) {
      const duplicate = (await mutationRef.get()).val();
      if (
        duplicate?.action === 'save'
        && (rawId === undefined || duplicate.productId === id)
      ) {
        return { id: duplicate.productId, duplicate: true };
      }
      throw new HttpsError('aborted', 'Không thể lưu sản phẩm do xung đột dữ liệu.');
    }
    return { id, duplicate: false };
  } catch (error) {
    return translateError(error, requestId);
  }
});

export const archiveWarehouseProduct = onCall(async (request) => {
  const auth = requireAuth(request);
  await requireAdmin(auth.uid);
  const requestId = parseRequestId(request.data);
  const id = (request.data as { id?: unknown }).id;
  if (typeof id !== 'string' || !validDatabaseKey.test(id)) {
    throw new HttpsError('invalid-argument', 'Mã sản phẩm không hợp lệ.');
  }

  try {
    const result = await getDatabase().ref().transaction((current: Record<string, any> | null) => {
      const root = current ?? {};
      root.productMutations ??= {};
      const duplicate = root.productMutations[requestId];
      if (duplicate) {
        if (duplicate.action === 'archive' && duplicate.productId === id) return undefined;
        throw new InventoryError('operation-conflict', 'Mã yêu cầu đã được dùng cho thao tác khác.');
      }
      const product = root.products?.[id];
      if (!product) throw new InventoryError('product-not-found', 'Không tìm thấy sản phẩm.');
      if (product.archived) throw new InventoryError('already-archived', 'Sản phẩm đã được lưu trữ.');
      if (Number(product.quantity) !== 0) {
        throw new InventoryError('stock-not-zero', 'Chỉ có thể lưu trữ sản phẩm khi tồn kho bằng 0.');
      }
      const now = Date.now();
      product.archived = true;
      product.archivedAt = now;
      product.archivedByUid = auth.uid;
      root.productMutations[requestId] = {
        action: 'archive',
        productId: id,
        actorUid: auth.uid,
        createdAt: now,
      };
      root.auditLogs ??= {};
      root.auditLogs[requestId] = {
        action: 'archive-product',
        productId: id,
        actorUid: auth.uid,
        actorEmail: String(auth.token.email || ''),
        createdAt: now,
      };
      return root;
    });
    if (!result.committed) return { id, duplicate: true };
    return { id, duplicate: false };
  } catch (error) {
    return translateError(error, requestId);
  }
});

export const deleteWarehouseUser = onCall(async (request) => {
  const auth = requireAuth(request);
  const uid = (request.data as { uid?: unknown })?.uid;
  if (typeof uid !== 'string' || !uid || /[.#$[\]/]/.test(uid)) {
    throw new HttpsError('invalid-argument', 'UID không hợp lệ.');
  }
  const database = getDatabase();
  const caller = (await database.ref(`users/${auth.uid}`).get()).val();
  const profileRef = database.ref(`users/${uid}`);
  const profile = (await profileRef.get()).val();

  try {
    assertDeletionAllowed(auth.uid, caller, uid, profile);
    await deleteUserWorkflow({
      markDeleting: () => profileRef.update({
        status: 'deleting',
        deletionRequestedAt: Date.now(),
        deletionRequestedBy: auth.uid,
      }),
      revokeTokens: () => getAuth().revokeRefreshTokens(uid),
      deleteAuthUser: () => getAuth().deleteUser(uid),
      markDisabledAfterAuthError: (error) =>
        profileRef.update({ status: 'disabled', deletionError: String(error) }),
      removeProfile: () => profileRef.remove(),
      isAuthUserNotFound: (error) =>
        (error as { code?: string })?.code === 'auth/user-not-found',
    });
  } catch (error) {
    if (error instanceof UserDeletionError) {
      const code = error.code === 'permission-denied' ? 'permission-denied'
        : error.code === 'not-found' ? 'not-found'
          : error.code === 'failed-precondition' ? 'failed-precondition'
            : 'internal';
      throw new HttpsError(code, error.message);
    }
    throw error;
  }
  return { uid, deleted: true };
});

export const createInventoryBackup = onCall({
  timeoutSeconds: 120,
  memory: '1GiB',
}, async (request) => {
  const auth = requireAuth(request);
  const email = String(auth.token.email || '');
  try {
    const profile = await requireActiveAdmin(auth.uid);
    const scope = backupScopeFromProfile(profile);
    const root = (await getDatabase().ref().get()).val();
    const document = buildBackupDocument({
      root,
      environment: currentBackupEnvironment(scope),
      appVersion: '1.0.0',
      createdBy: { uid: auth.uid, email },
      now: Date.now(),
    });
    const reason = (request.data as { reason?: unknown })?.reason === 'pre-restore'
      ? 'pre-restore'
      : 'manual';
    await writeBackupAudit({
      action: 'BACKUP_CREATED',
      uid: auth.uid,
      email,
      details: { checksum: document.checksum, reason, format: BACKUP_FORMAT },
    });
    return { document };
  } catch (error) {
    try {
      await writeBackupAudit({
        action: 'BACKUP_FAILED',
        uid: auth.uid,
        email,
        details: { message: error instanceof Error ? error.message.slice(0, 500) : 'Unknown error' },
      });
    } catch (auditError) {
      console.error('Cannot write BACKUP_FAILED audit', auditError);
    }
    if (error instanceof HttpsError) throw error;
    console.error('Backup failed', error);
    throw new HttpsError('internal', 'Không thể tạo bản sao lưu. Dữ liệu chưa bị thay đổi.');
  }
});

export const previewInventoryRestore = onCall({
  timeoutSeconds: 120,
  memory: '1GiB',
}, async (request) => {
  const auth = requireAuth(request);
  const email = String(auth.token.email || '');
  const profile = await requireActiveAdmin(auth.uid);
  const document = validateBackupDocument((request.data as { document?: unknown })?.document);
  const { selectedNodes, mode } = parseRestoreSelection(request.data);
  const scope = backupScopeFromProfile(profile);
  const environment = currentBackupEnvironment(scope);
  const root = (await getDatabase().ref().get()).val();
  const currentData = extractBusinessData(root, scope);
  const warnings = relationshipWarnings(selectedNodes);
  if (document.environment.projectId !== environment.projectId) {
    warnings.unshift(`Tệp được tạo từ Firebase project “${document.environment.projectId || 'không rõ'}”, khác project hiện tại “${environment.projectId || 'không rõ'}”.`);
  }
  if (document.environment.databaseHost !== environment.databaseHost) {
    warnings.unshift('Database host của tệp khác database đang kết nối.');
  }
  if (document.environment.mode !== environment.mode) {
    warnings.unshift('Mô hình phạm vi dữ liệu của tệp khác môi trường hiện tại.');
  }
  await writeBackupAudit({
    action: 'RESTORE_FILE_VALIDATED',
    uid: auth.uid,
    email,
    details: { checksum: document.checksum, mode, selectedNodes },
  });
  return {
    environment,
    diffs: compareRestore(currentData, document.data, selectedNodes, mode),
    warnings,
    currentChecksum: checksumData(currentData),
  };
});

export const restoreInventoryBackup = onCall({
  timeoutSeconds: 300,
  memory: '1GiB',
}, async (request) => {
  const auth = requireAuth(request);
  const email = String(auth.token.email || '');
  const profile = await requireActiveAdmin(auth.uid);
  const payload = request.data as {
    document?: unknown;
    confirmation?: unknown;
    replaceAcknowledged?: unknown;
    preRestoreChecksum?: unknown;
  };
  const document = validateBackupDocument(payload.document);
  const { selectedNodes, mode } = parseRestoreSelection(request.data);
  if (payload.confirmation !== 'KHOI PHUC' && payload.confirmation !== 'RESTORE') {
    throw new HttpsError('failed-precondition', 'Cụm từ xác nhận khôi phục không chính xác.');
  }
  if (mode === 'replace' && payload.replaceAcknowledged !== true) {
    throw new HttpsError('failed-precondition', 'Bạn chưa xác nhận nguy cơ xóa dữ liệu hiện tại ở chế độ thay thế.');
  }
  if (typeof payload.preRestoreChecksum !== 'string' || !/^[a-f0-9]{64}$/.test(payload.preRestoreChecksum)) {
    throw new HttpsError('failed-precondition', 'Thiếu checksum của bản sao lưu an toàn trước khôi phục.');
  }

  const database = getDatabase();
  const scope = backupScopeFromProfile(profile);
  const jobId = database.ref('restoreJobs/jobs').push().key!;
  const lockRef = database.ref('restoreJobs/active');
  const now = Date.now();
  const lockResult = await lockRef.transaction((current) => {
    const stale = current?.startedAt && now - Number(current.startedAt) > 30 * 60 * 1_000;
    if (current && !stale) return;
    return { jobId, actorUid: auth.uid, status: 'running', startedAt: now };
  });
  if (!lockResult.committed) {
    throw new HttpsError('aborted', 'Đang có một phiên khôi phục khác. Vui lòng kiểm tra trạng thái restore job trước khi thử lại.');
  }

  const jobRef = database.ref(`restoreJobs/jobs/${jobId}`);
  try {
    await jobRef.set({
      jobId,
      status: 'running',
      phase: 'writing-data',
      mode,
      selectedNodes,
      sourceChecksum: document.checksum,
      preRestoreChecksum: payload.preRestoreChecksum,
      actorUid: auth.uid,
      actorEmail: email,
      startedAt: now,
    });
    await writeBackupAudit({
      action: 'RESTORE_STARTED',
      uid: auth.uid,
      email,
      details: { jobId, mode, selectedNodes, sourceChecksum: document.checksum },
    });
    const transaction = await database.ref().transaction((current) => {
      const currentData = extractBusinessData(current, scope);
      if (checksumData(currentData) !== payload.preRestoreChecksum) {
        throw new Error('PRE_RESTORE_BACKUP_STALE');
      }
      return applyRestoreToRoot({
        root: current,
        document,
        selectedNodes,
        mode,
        scope,
        actorUid: auth.uid,
      });
    });
    if (!transaction.committed) throw new Error('RESTORE_TRANSACTION_ABORTED');

    const finalRoot = transaction.snapshot.val();
    const finalData = extractBusinessData(finalRoot, scope);
    const issues = auditIntegrity(finalData);
    const completedAt = Date.now();
    const metadataResults = await Promise.allSettled([
      jobRef.update({
        status: 'completed',
        phase: 'completed',
        completedAt,
        integrityIssueCount: issues.length,
        resultChecksum: checksumData(finalData),
      }),
      writeBackupAudit({
        action: 'RESTORE_COMPLETED',
        uid: auth.uid,
        email,
        details: { jobId, mode, selectedNodes, integrityIssueCount: issues.length },
      }),
    ]);
    const metadataWarnings = metadataResults
      .filter((result) => result.status === 'rejected')
      .map(() => 'Dữ liệu đã khôi phục nhưng không thể ghi đầy đủ trạng thái job/audit.');
    return {
      jobId,
      completedAt,
      metadataWarnings,
      integrity: {
        ok: !issues.some((issue) => issue.level === 'error'),
        issueCount: issues.length,
        issues,
      },
    };
  } catch (error) {
    const message = error instanceof Error && error.message === 'PRE_RESTORE_BACKUP_STALE'
      ? 'Dữ liệu đã thay đổi sau khi tạo bản sao lưu an toàn. Khôi phục đã dừng; hãy tạo lại bản sao lưu trước khôi phục.'
      : 'Khôi phục thất bại. Giao dịch dữ liệu đã bị hủy.';
    await Promise.allSettled([
      jobRef.update({
        status: 'failed',
        phase: 'failed',
        failedAt: Date.now(),
        error: message,
      }),
      writeBackupAudit({
        action: 'RESTORE_FAILED',
        uid: auth.uid,
        email,
        details: { jobId, message },
      }),
    ]);
    console.error('Restore failed', { jobId, error });
    throw new HttpsError(error instanceof Error && error.message === 'PRE_RESTORE_BACKUP_STALE'
      ? 'failed-precondition'
      : 'internal', message, { jobId });
  } finally {
    try {
      await lockRef.transaction((current) => current?.jobId === jobId ? null : current);
    } catch (cleanupError) {
      console.error('Cannot release restore lock', { jobId, cleanupError });
    }
  }
});

export const recordBackupRestoreEvent = onCall(async (request) => {
  const auth = requireAuth(request);
  await requireActiveAdmin(auth.uid);
  const action = (request.data as { action?: unknown })?.action;
  if (action !== 'RESTORE_CANCELLED') {
    throw new HttpsError('invalid-argument', 'Sự kiện audit không hợp lệ.');
  }
  await writeBackupAudit({
    action,
    uid: auth.uid,
    email: String(auth.token.email || ''),
    details: { reason: 'cancelled-by-user' },
  });
  return { recorded: true };
});
