import { httpsCallable } from 'firebase/functions';
import { getFirebaseInstance } from '../../services/firebase';
import { formatFirebaseError } from '../../services/data-integrity';
import { formatBackupFileName, serializeBackup } from './backup-format';
import type {
  BackupDocument,
  BackupHistoryEntry,
  BackupNode,
  RestoreMode,
  RestorePreview,
  RestoreResult,
} from './backup-types';

const HISTORY_KEY = 'warehouse_backup_history_v1';
const HISTORY_LIMIT = 8;

interface SaveResult {
  status: 'success' | 'cancelled' | 'error';
  message: string;
  filePath?: string;
}

function callable<TRequest, TResponse>(name: string) {
  return httpsCallable<TRequest, TResponse>(getFirebaseInstance().functions, name);
}

export function formatBackupFunctionError(error: unknown): string {
  const candidate = error as { code?: unknown } | null;
  const code = typeof candidate?.code === 'string'
    ? candidate.code.replace(/^functions\//, '')
    : '';
  if (code === 'not-found') return 'Chức năng sao lưu chưa được triển khai trên máy chủ.';
  if (code === 'permission-denied') return 'Tài khoản không có quyền sao lưu.';
  if (code === 'unauthenticated') return 'Phiên đăng nhập đã hết hạn.';
  if (code === 'unavailable') return 'Không thể kết nối máy chủ sao lưu.';
  return formatFirebaseError(error);
}

export async function createBackup(reason: 'manual' | 'pre-restore'): Promise<BackupDocument> {
  try {
    const createInventoryBackup = httpsCallable<
      { reason: string },
      { document: BackupDocument }
    >(getFirebaseInstance().functions, 'createInventoryBackup');
    const result = await createInventoryBackup({ reason });
    return result.data.document;
  } catch (error) {
    throw new Error(formatBackupFunctionError(error), { cause: error });
  }
}

export async function previewRestore(
  document: BackupDocument,
  selectedNodes: BackupNode[],
  mode: RestoreMode,
): Promise<RestorePreview> {
  try {
    const result = await callable<
      { document: BackupDocument; selectedNodes: BackupNode[]; mode: RestoreMode },
      RestorePreview
    >('previewInventoryRestore')({ document, selectedNodes, mode });
    return result.data;
  } catch (error) {
    throw new Error(formatBackupFunctionError(error), { cause: error });
  }
}

export async function restoreBackup(input: {
  document: BackupDocument;
  selectedNodes: BackupNode[];
  mode: RestoreMode;
  confirmation: string;
  replaceAcknowledged: boolean;
  preRestoreChecksum: string;
}): Promise<RestoreResult> {
  try {
    const result = await callable<typeof input, RestoreResult>('restoreInventoryBackup')(input);
    return result.data;
  } catch (error) {
    throw new Error(formatBackupFunctionError(error), { cause: error });
  }
}

export async function recordRestoreCancelled(): Promise<void> {
  try {
    await callable<{ action: 'RESTORE_CANCELLED' }, { recorded: boolean }>('recordBackupRestoreEvent')({
      action: 'RESTORE_CANCELLED',
    });
  } catch (error) {
    console.warn('Không thể ghi audit RESTORE_CANCELLED', error);
  }
}

function browserDownload(fileName: string, content: string): SaveResult {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }));
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return { status: 'success', message: 'Trình duyệt đã bắt đầu tải tệp sao lưu.' };
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export async function saveBackupDocument(
  document: BackupDocument,
  reason: 'manual' | 'pre-restore',
): Promise<{ result: SaveResult; entry?: BackupHistoryEntry }> {
  const fileName = formatBackupFileName(
    new Date(document.timestamp),
    reason === 'pre-restore' ? 'pre-restore-backup' : 'inventory-backup',
  );
  const content = serializeBackup(document);
  const size = new TextEncoder().encode(content).byteLength;
  const result = window.electronAPI?.saveBackupFile
    ? await window.electronAPI.saveBackupFile({ fileName, content })
    : browserDownload(fileName, content);
  if (result.status !== 'success') return { result };
  const entry: BackupHistoryEntry = {
    fileName,
    createdAt: document.createdAt,
    checksum: document.checksum,
    size,
    reason,
  };
  rememberBackup(entry);
  return { result, entry };
}

export function readBackupHistory(): BackupHistoryEntry[] {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is BackupHistoryEntry => (
      item && typeof item.fileName === 'string' && typeof item.createdAt === 'string'
      && typeof item.checksum === 'string' && typeof item.size === 'number'
      && (item.reason === 'manual' || item.reason === 'pre-restore')
    )).slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function rememberBackup(entry: BackupHistoryEntry): void {
  const history = [entry, ...readBackupHistory().filter((item) => item.checksum !== entry.checksum)]
    .slice(0, HISTORY_LIMIT);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}
