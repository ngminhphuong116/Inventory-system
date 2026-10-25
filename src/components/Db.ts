import type { DataSnapshot } from 'firebase/database';
import {
  getWarehouseScope,
  realtimeInventory,
  subscribeBranchNode,
  subscribeScopedUsers,
} from '../services/realtime-inventory';
import { createOperationId } from '../services/data-integrity';
import {
  adaptDirectorySources,
  supplierNameFromRecord,
  type DirectoryItem,
  type DirectoryKind,
} from '../services/legacy-directory';
import type { OperationType as InventoryOperationType } from '../../functions/src/inventory-engine';
import { sortRecordsNewestFirst } from '../utils/record-time';
import {
  normalizeAccountEntries,
  type AccountRecord,
} from '../services/account-management';

export type TicketStatus = 'active' | 'cancelled';

export interface VoucherType {
  key?: string;
  id?: string;
  code: string;
  type: 'percentage' | 'fixed';
  value: number;
  minOrder: number;
  maxBox?: number;
}

export interface ProductType {
  id: string;
  code: string;
  barcode?: string;
  name: string;
  unit: string;
  category: string;
  categoryId?: string;
  importPrice: number;
  salePrice: number;
  supplier: string;
  supplierId?: string;
  quantity: number;
  minStock: number;
  status: string;
  archived?: boolean;
  description?: string;
}

export type DirectoryType = DirectoryItem;

export interface BusinessSettings {
  businessName: string;
  address: string;
  phone: string;
}

export type UserType = AccountRecord;

export interface TicketItem {
  productId: string;
  productCode?: string;
  productName: string;
  unit?: string;
  quantity: number;
  unitPrice?: number;
  actualUnitPrice?: number;
  listedPrice?: number;
  importPrice?: number;
  exportPrice?: number;
  salePrice?: number;
  costPrice?: number;
  subtotal?: number;
  subtotalBeforeDiscount?: number;
  lineDiscountType?: 'none' | 'amount' | 'percent';
  lineDiscountValue?: number;
  lineDiscountAmount?: number;
  lineTotal?: number;
}

interface TicketAuditFields {
  operationId?: string;
  status?: TicketStatus;
  createdBy?: string;
  createdByEmail?: string;
  createdByUid?: string;
  createdAt?: number;
  cancelledBy?: string;
  cancelledByUid?: string;
  cancelledAt?: number;
  cancelReason?: string;
  items?: TicketItem[];
  subtotal?: number;
  lineDiscountTotal?: number;
  invoiceDiscountType?: 'none' | 'amount' | 'percent';
  invoiceDiscountValue?: number;
  invoiceDiscountAmount?: number;
  totalQuantity?: number;
  costTotal?: number;
  profit?: number;
  unitPrice?: number;
  actualUnitPrice?: number;
  listedPrice?: number;
  exportPrice?: number;
  transactionId?: string;
}

export interface ImportTicketType extends TicketAuditFields {
  key: string;
  date: string;
  supplier: string;
  productName: string;
  productId: string;
  quantity: number;
  importPrice: number;
  totalAmount: number;
  invoiceNo: string;
}

export interface ExportTicketType extends TicketAuditFields {
  key: string;
  date: string;
  customer: string;
  productName: string;
  productId: string;
  quantity: number;
  salePrice: number;
  totalAmount: number;
  invoiceNo: string;
}

export interface SalesTicketType extends TicketAuditFields {
  key: string;
  date: string;
  customerName: string;
  productName: string;
  productId: string;
  quantity: number;
  salePrice: number;
  totalAmount: number;
  invoiceNo: string;
  billCode?: string;
  type: string;
  voucherUsed?: string;
  discountAmount?: number;
}

type InventoryTicket = Omit<ImportTicketType | ExportTicketType | SalesTicketType, 'key'>;

function snapshotToArray<T>(
  snapshot: DataSnapshot,
  includeCancelled = false,
): T[] {
  if (!snapshot.exists()) return [];
  return Object.entries(snapshot.val())
    .map(([key, val]) => ({ ...(val as object), key, id: key }) as unknown as T)
    .filter((item) =>
      includeCancelled || (item as { status?: TicketStatus }).status !== 'cancelled'
    );
}

export const dbService = {
  onProducts(
    callback: (products: ProductType[]) => void,
    onError?: (error: Error) => void,
  ): () => void {
    const handler = (snap: DataSnapshot) => callback(
      snapshotToArray<ProductType>(snap).filter((product) => !product.archived),
    );
    return subscribeBranchNode('products', handler, onError);
  },

  onVouchers(
    callback: (data: VoucherType[]) => void,
    onError?: (error: Error) => void,
  ): () => void {
    const handler = (snap: DataSnapshot) => callback(snapshotToArray<VoucherType>(snap));
    return subscribeBranchNode('vouchers', handler, onError);
  },

  onCategories(
    callback: (data: DirectoryType[]) => void,
    onError?: (error: Error) => void,
  ): () => void {
    return this.onDirectory('categories', callback, onError);
  },

  onSuppliers(
    callback: (data: DirectoryType[]) => void,
    onError?: (error: Error) => void,
  ): () => void {
    return this.onDirectory('suppliers', callback, onError);
  },

  onBusinessSettings(
    callback: (data: BusinessSettings) => void,
    onError?: (error: Error) => void,
  ): () => void {
    const safeDefaults: BusinessSettings = {
      businessName: '',
      address: '',
      phone: '',
    };
    const handler = (snap: DataSnapshot) => {
      if (!snap.exists()) {
        callback(safeDefaults);
        return;
      }
      const value = snap.val() as Partial<BusinessSettings>;
      callback({
        businessName: String(value.businessName || safeDefaults.businessName).trim(),
        address: String(value.address || '').trim(),
        phone: String(value.phone || '').trim(),
      });
    };
    return subscribeBranchNode('settings', handler, onError);
  },

  async saveBusinessSettings(settings: BusinessSettings): Promise<void> {
    await realtimeInventory.saveBusinessSettings(
      settings as unknown as Record<string, unknown>,
    );
  },

  onDirectory(
    path: 'categories' | 'suppliers',
    callback: (data: DirectoryType[]) => void,
    onError?: (error: Error) => void,
  ): () => void {
    const kind: DirectoryKind = path === 'categories' ? 'category' : 'supplier';
    const alias = path === 'categories' ? 'productCategories' : 'partners';
    const values: Record<'primary' | 'alias' | 'products', unknown> = {
      primary: null,
      alias: null,
      products: null,
    };
    const ready = new Set<string>();
    const unsubscribers: Array<() => void> = [];
    let disposed = false;

    const emit = (source: 'legacy-root' | 'scoped') => {
      if (disposed || ready.size < 3) return;
      callback(adaptDirectorySources({ kind, source, ...values }));
    };

    void getWarehouseScope()
      .then(() => {
        if (disposed) return;
        const source = 'legacy-root' as const;
        const subscribe = (
          node: string,
          key: keyof typeof values,
        ) => subscribeBranchNode(
          node,
          (snap) => {
            values[key] = snap.exists() ? snap.val() : null;
            ready.add(key);
            emit(source);
          },
          onError,
        );
        unsubscribers.push(
          subscribe(path, 'primary'),
          subscribe(alias, 'alias'),
          subscribe('products', 'products'),
        );
      })
      .catch((error) => onError?.(error as Error));

    return () => {
      disposed = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  },

  async addCategory(name: string, requestId = createOperationId()) {
    return realtimeInventory.saveDirectoryEntry('categories', name, requestId);
  },

  async addSupplier(name: string, requestId = createOperationId()) {
    return realtimeInventory.saveDirectoryEntry('suppliers', name, requestId);
  },

  async updateCategory(id: string, name: string, requestId = createOperationId()) {
    return realtimeInventory.saveDirectoryEntry('categories', name, requestId, id);
  },

  async updateSupplier(id: string, name: string, requestId = createOperationId()) {
    return realtimeInventory.saveDirectoryEntry('suppliers', name, requestId, id);
  },

  async addProduct(
    product: Omit<ProductType, 'id' | 'key'>,
    requestId = createOperationId(),
  ): Promise<string> {
    const result = await realtimeInventory.saveProduct(
      product as unknown as Record<string, unknown>,
      requestId,
    );
    return result.id;
  },

  async updateProduct(
    id: string,
    data: Partial<ProductType>,
    requestId = createOperationId(),
  ): Promise<void> {
    const metadata = { ...data };
    delete metadata.quantity;
    delete metadata.status;
    delete metadata.archived;
    await realtimeInventory.saveProduct(
      metadata as unknown as Record<string, unknown>,
      requestId,
      id,
    );
  },

  async archiveProduct(id: string): Promise<void> {
    await realtimeInventory.archiveProduct(id, createOperationId());
  },

  onImportTickets(
    callback: (tickets: ImportTicketType[]) => void,
    includeCancelled = false,
    onError?: (error: Error) => void,
  ): () => void {
    return this.onTickets<ImportTicketType>(
      'importTickets',
      (tickets) => callback(tickets.map((ticket) => ({
        ...ticket,
        supplier: supplierNameFromRecord(ticket),
      }))),
      includeCancelled,
      onError,
    );
  },

  onExportTickets(
    callback: (tickets: ExportTicketType[]) => void,
    includeCancelled = false,
    onError?: (error: Error) => void,
  ): () => void {
    return this.onTickets('exportTickets', callback, includeCancelled, onError);
  },

  onSalesTickets(
    callback: (tickets: SalesTicketType[]) => void,
    includeCancelled = false,
    onError?: (error: Error) => void,
  ): () => void {
    return this.onTickets('salesTickets', callback, includeCancelled, onError);
  },

  onTickets<T extends { key: string; status?: TicketStatus }>(
    path: string,
    callback: (tickets: T[]) => void,
    includeCancelled = false,
    onError?: (error: Error) => void,
  ): () => void {
    const handler = (snap: DataSnapshot) => {
      callback(
        sortRecordsNewestFirst(snapshotToArray<T>(snap, includeCancelled)),
      );
    };
    return subscribeBranchNode(path, handler, onError);
  },

  async createOperation(
    type: InventoryOperationType,
    ticket: InventoryTicket,
    operationId = createOperationId(),
  ): Promise<{ operationId: string; ticketKey: string; duplicate: boolean }> {
    return realtimeInventory.createOperation(type, ticket, operationId);
  },

  async addImportTicket(
    ticket: Omit<ImportTicketType, 'key'>,
    operationId = createOperationId(),
  ) {
    return this.createOperation('import', ticket, operationId);
  },

  async addExportTicket(
    ticket: Omit<ExportTicketType, 'key'>,
    operationId = createOperationId(),
  ) {
    return this.createOperation('export', ticket, operationId);
  },

  async addSalesTicket(
    ticket: Omit<SalesTicketType, 'key'>,
    operationId = createOperationId(),
  ) {
    return this.createOperation('sale', ticket, operationId);
  },

  async cancelTicket(
    type: InventoryOperationType,
    key: string,
    operationId = createOperationId(),
    reason = 'Hủy từ giao diện quản lý',
  ): Promise<{ operationId: string; duplicate: boolean }> {
    return realtimeInventory.cancelOperation(type, key, operationId, reason);
  },

  async cancelImportTicket(
    key: string,
    reason: string,
    operationId = createOperationId(),
  ): Promise<void> {
    await this.cancelTicket('import', key, operationId, reason);
  },

  async cancelExportTicket(
    key: string,
    reason: string,
    operationId = createOperationId(),
  ): Promise<void> {
    await this.cancelTicket('export', key, operationId, reason);
  },

  async cancelSalesTicket(
    key: string,
    reason: string,
    operationId = createOperationId(),
  ): Promise<void> {
    await this.cancelTicket('sale', key, operationId, reason);
  },

  onUsers(
    callback: (users: UserType[]) => void,
    onError?: (error: Error) => void,
  ): () => void {
    const handler = (snap: DataSnapshot) => callback(
      normalizeAccountEntries(
        snap.exists()
          ? snap.val() as Record<string, Record<string, unknown>>
          : null,
      ),
    );
    return subscribeScopedUsers(handler, (error) => {
      onError?.(error);
    });
  },

  async updateUserStatus(key: string, status: 'active' | 'disabled'): Promise<void> {
    await realtimeInventory.setUserStatus(key, status, createOperationId());
  },

  async archiveUser(uid: string, archived: boolean): Promise<void> {
    await realtimeInventory.setUserArchived(uid, archived, createOperationId());
  },
};
