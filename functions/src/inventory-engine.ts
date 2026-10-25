export type OperationType = 'import' | 'export' | 'sale';

export interface InventoryItem {
  productId: string;
  productName?: string;
  productCode?: string;
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

export interface ProductRecord {
  quantity: number;
  minStock?: number;
  code?: string;
  name?: string;
  unit?: string;
  importPrice?: number;
  salePrice?: number;
  status?: string;
  [key: string]: unknown;
}

export interface TicketRecord {
  productId?: string;
  productName?: string;
  quantity?: number;
  unitPrice?: number;
  actualUnitPrice?: number;
  listedPrice?: number;
  importPrice?: number;
  exportPrice?: number;
  salePrice?: number;
  items?: InventoryItem[];
  lineDiscountTotal?: number;
  invoiceDiscountType?: 'none' | 'amount' | 'percent';
  invoiceDiscountValue?: number;
  invoiceDiscountAmount?: number;
  transactionId?: string;
  status?: 'active' | 'cancelled';
  [key: string]: unknown;
}

export interface RootData {
  products?: Record<string, ProductRecord>;
  vouchers?: Record<string, VoucherRecord>;
  importTickets?: Record<string, TicketRecord>;
  exportTickets?: Record<string, TicketRecord>;
  salesTickets?: Record<string, TicketRecord>;
  operations?: Record<string, OperationRecord>;
  auditLogs?: Record<string, AuditLogRecord>;
  stockMovements?: Record<string, StockMovementRecord>;
  [key: string]: unknown;
}

export interface VoucherRecord {
  code: string;
  type: 'percentage' | 'fixed';
  value: number;
  minOrder?: number;
  maxBox?: number;
}

export interface OperationRecord {
  action: 'create' | 'cancel';
  type: OperationType;
  ticketKey: string;
  actorUid: string;
  createdAt: number;
}

export interface AuditLogRecord extends OperationRecord {
  actorEmail: string;
  totalAmount?: number;
  reason?: string;
}

export interface StockMovementRecord {
  type: 'sale';
  referenceId: string;
  referenceCode: string;
  productId: string;
  productName: string;
  quantity: number;
  beforeStock: number;
  afterStock: number;
  unitPrice: number;
  amount: number;
  createdAt: number;
  createdBy: string;
}

export class InventoryError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const ticketPath = (type: OperationType) =>
  type === 'import' ? 'importTickets'
    : type === 'export' ? 'exportTickets'
      : 'salesTickets';

export function normalizeItems(ticket: TicketRecord): InventoryItem[] {
  const items = Array.isArray(ticket.items) && ticket.items.length > 0
    ? ticket.items
    : [{
        productId: ticket.productId ?? '',
        quantity: ticket.quantity ?? 0,
        ...(ticket.productName !== undefined ? { productName: ticket.productName } : {}),
        ...(ticket.unitPrice !== undefined ? { unitPrice: ticket.unitPrice } : {}),
        ...(ticket.actualUnitPrice !== undefined ? { actualUnitPrice: ticket.actualUnitPrice } : {}),
        ...(ticket.listedPrice !== undefined ? { listedPrice: ticket.listedPrice } : {}),
        ...(ticket.importPrice !== undefined ? { importPrice: ticket.importPrice } : {}),
        ...(ticket.exportPrice !== undefined ? { exportPrice: ticket.exportPrice } : {}),
        ...(ticket.salePrice !== undefined ? { salePrice: ticket.salePrice } : {}),
      }];

  if (items.length === 0 || items.length > 100) {
    throw new InventoryError('invalid-items', 'Phiếu phải có từ 1 đến 100 sản phẩm.');
  }

  return items.map((item) => {
    if (
      !item || typeof item.productId !== 'string' || !item.productId
      || !Number.isSafeInteger(item.quantity) || item.quantity <= 0
    ) {
      throw new InventoryError('invalid-item', 'Sản phẩm hoặc số lượng trong phiếu không hợp lệ.');
    }
    return item;
  });
}

function nextStatus(quantity: number, minStock: number): string {
  return quantity === 0 ? 'Critical' : quantity <= minStock ? 'Warning' : 'Normal';
}

function requireMoney(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new InventoryError('invalid-price', `${label} không hợp lệ.`);
  }
  return Number(value);
}

function safeMoney(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new InventoryError('invalid-total', `${label} vượt giới hạn cho phép.`);
  }
  return value;
}

function submittedUnitPrice(item: InventoryItem, type: OperationType): number {
  const value = type === 'import'
    ? item.unitPrice ?? item.importPrice
    : type === 'export'
      ? item.unitPrice ?? item.exportPrice ?? item.salePrice
      : item.unitPrice ?? item.actualUnitPrice ?? item.salePrice;
  const label = type === 'import'
    ? 'Đơn giá nhập'
    : type === 'export'
      ? 'Đơn giá xuất'
      : 'Đơn giá bán';
  return requireMoney(value, label);
}

function normalizeDiscountType(value: unknown): 'none' | 'amount' | 'percent' {
  return value === 'amount' || value === 'percent' ? value : 'none';
}

function calculateDiscount(
  base: number,
  type: 'none' | 'amount' | 'percent',
  rawValue: unknown,
  label: string,
) {
  if (type === 'none') return { value: 0, amount: 0 };
  const value = requireMoney(rawValue, label);
  if (type === 'percent' && value > 100) {
    throw new InventoryError('invalid-discount', `${label} phải từ 0 đến 100%.`);
  }
  const requested = type === 'percent'
    ? Math.floor((base * value) / 100)
    : value;
  return {
    value,
    amount: Math.min(base, safeMoney(requested, label)),
  };
}

function snapshotFinancials(
  root: RootData,
  type: OperationType,
  ticket: TicketRecord,
): {
  items: InventoryItem[];
  subtotal: number;
  lineDiscountTotal: number;
  invoiceDiscountType: 'none' | 'amount' | 'percent';
  invoiceDiscountValue: number;
  invoiceDiscountAmount: number;
  discountAmount: number;
  totalAmount: number;
} {
  const submitted = normalizeItems(ticket);
  const items = submitted.map((item) => {
    const product = root.products?.[item.productId];
    if (!product) {
      throw new InventoryError('product-not-found', `Không tìm thấy sản phẩm ${item.productId}.`);
    }

    // unitPrice from the submitted ticket is the immutable transaction price.
    // Catalog prices below are captured only as reference/cost snapshots.
    const unitPrice = submittedUnitPrice(item, type);
    const subtotalBeforeDiscount = safeMoney(item.quantity * unitPrice, 'Thành tiền');
    const lineDiscountType = type === 'sale'
      ? normalizeDiscountType(item.lineDiscountType)
      : 'none';
    const lineDiscount = calculateDiscount(
      subtotalBeforeDiscount,
      lineDiscountType,
      item.lineDiscountValue ?? 0,
      'Giảm giá dòng',
    );
    const base = {
      productId: item.productId,
      productName: String(product.name || item.productName || item.productId),
      productCode: String(product.code || item.productCode || ''),
      unit: String(product.unit || item.unit || ''),
      quantity: item.quantity,
      unitPrice,
      subtotal: subtotalBeforeDiscount,
      subtotalBeforeDiscount,
      lineDiscountType,
      lineDiscountValue: lineDiscount.value,
      lineDiscountAmount: lineDiscount.amount,
      lineTotal: subtotalBeforeDiscount - lineDiscount.amount,
    };

    if (type === 'import') {
      return { ...base, importPrice: unitPrice };
    }

    const costPrice = requireMoney(product.importPrice ?? 0, 'Giá vốn');
    if (type === 'export') {
      return {
        ...base,
        exportPrice: unitPrice,
        salePrice: unitPrice,
        costPrice,
      };
    }

    return {
      ...base,
      actualUnitPrice: unitPrice,
      listedPrice: requireMoney(product.salePrice ?? 0, 'Giá niêm yết'),
      salePrice: unitPrice,
      costPrice,
    };
  });

  const subtotal = safeMoney(
    items.reduce((sum, item) => sum + Number(item.subtotalBeforeDiscount ?? 0), 0),
    'Tạm tính',
  );
  const lineDiscountTotal = safeMoney(
    items.reduce((sum, item) => sum + Number(item.lineDiscountAmount ?? 0), 0),
    'Tổng giảm giá sản phẩm',
  );
  const afterLineDiscount = safeMoney(subtotal - lineDiscountTotal, 'Tổng sau giảm giá sản phẩm');
  let invoiceDiscountType = type === 'sale'
    ? normalizeDiscountType(ticket.invoiceDiscountType)
    : 'none';
  let invoiceDiscountValue = 0;
  let invoiceDiscountAmount = 0;

  if (type === 'sale' && ticket.voucherUsed && ticket.voucherUsed !== 'Không có') {
    const voucherCode = String(ticket.voucherUsed).trim().toUpperCase();
    const voucher = Object.values(root.vouchers || {}).find(
      (candidate) => candidate.code?.trim().toUpperCase() === voucherCode,
    );
    if (!voucher) {
      throw new InventoryError('voucher-not-found', 'Mã giảm giá không tồn tại hoặc đã hết hiệu lực.');
    }
    const minimum = requireMoney(voucher.minOrder ?? 0, 'Giá trị đơn tối thiểu');
    if (afterLineDiscount < minimum) {
      throw new InventoryError('voucher-precondition', 'Đơn hàng chưa đạt giá trị tối thiểu của mã giảm giá.');
    }
    const value = requireMoney(voucher.value, 'Giá trị giảm giá');
    invoiceDiscountType = voucher.type === 'percentage' ? 'percent' : 'amount';
    invoiceDiscountValue = value;
    invoiceDiscountAmount = voucher.type === 'percentage'
      ? Math.floor((afterLineDiscount * value) / 100)
      : value;
    if (voucher.maxBox !== undefined) {
      invoiceDiscountAmount = Math.min(
        invoiceDiscountAmount,
        requireMoney(voucher.maxBox, 'Mức giảm tối đa'),
      );
    }
    invoiceDiscountAmount = Math.min(
      afterLineDiscount,
      safeMoney(invoiceDiscountAmount, 'Tiền giảm giá'),
    );
  } else if (type === 'sale') {
    const invoiceDiscount = calculateDiscount(
      afterLineDiscount,
      invoiceDiscountType,
      ticket.invoiceDiscountValue ?? 0,
      'Giảm giá hóa đơn',
    );
    invoiceDiscountValue = invoiceDiscount.value;
    invoiceDiscountAmount = invoiceDiscount.amount;
  }

  const discountAmount = safeMoney(
    lineDiscountTotal + invoiceDiscountAmount,
    'Tổng giảm giá',
  );

  return {
    items,
    subtotal,
    lineDiscountTotal,
    invoiceDiscountType,
    invoiceDiscountValue,
    invoiceDiscountAmount,
    discountAmount,
    totalAmount: safeMoney(afterLineDiscount - invoiceDiscountAmount, 'Tổng thanh toán'),
  };
}

function validateProduct(root: RootData, item: InventoryItem, delta: number): ProductRecord {
  const product = root.products?.[item.productId];
  if (!product || !Number.isSafeInteger(product.quantity) || product.quantity < 0) {
    throw new InventoryError('invalid-product', `Dữ liệu tồn kho của sản phẩm ${item.productId} không hợp lệ.`);
  }
  if (!Number.isSafeInteger(delta) || product.quantity + delta < 0) {
    throw new InventoryError(
      'insufficient-stock',
      `Sản phẩm ${item.productName || item.productId} không đủ tồn kho.`,
    );
  }
  return product;
}

function applyStock(
  root: RootData,
  items: InventoryItem[],
  direction: 1 | -1,
  type: OperationType,
  validatePrices = true,
): Array<{ item: InventoryItem; beforeStock: number; afterStock: number }> {
  const aggregated = new Map<string, { item: InventoryItem; delta: number }>();
  for (const item of items) {
    if (validatePrices && type === 'import' && item.importPrice !== undefined
      && (!Number.isFinite(item.importPrice) || item.importPrice < 0)) {
      throw new InventoryError('invalid-price', 'Giá nhập không hợp lệ.');
    }
    if (validatePrices && type !== 'import'
      && (!Number.isFinite(item.salePrice) || Number(item.salePrice) < 0)) {
      throw new InventoryError('invalid-price', 'Giá bán không hợp lệ.');
    }
    const existing = aggregated.get(item.productId);
    aggregated.set(item.productId, {
      item,
      delta: (existing?.delta ?? 0) + direction * item.quantity,
    });
  }

  const changes = [...aggregated.values()].map(({ item, delta }) => ({
    item,
    delta,
    product: validateProduct(root, item, delta),
  }));

  const applied: Array<{ item: InventoryItem; beforeStock: number; afterStock: number }> = [];
  for (const { item, delta, product } of changes) {
    const beforeStock = product.quantity;
    const quantity = product.quantity + delta;
    product.quantity = quantity;
    product.status = nextStatus(quantity, Number(product.minStock || 0));
    if (type === 'import' && item.importPrice !== undefined) {
      product.importPrice = item.importPrice;
    }
    applied.push({ item, beforeStock, afterStock: quantity });
  }
  return applied;
}

export function applyCreate(
  root: RootData,
  params: {
    type: OperationType;
    ticketKey: string;
    operationId: string;
    ticket: TicketRecord;
    actorUid: string;
    actorEmail: string;
    now: number;
  },
): 'created' | 'duplicate' {
  root.operations ??= {};
  const priorOperation = root.operations[params.operationId];
  if (priorOperation) {
    if (priorOperation.action === 'create' && priorOperation.type === params.type) {
      return 'duplicate';
    }
    throw new InventoryError('operation-conflict', 'Mã yêu cầu đã được dùng cho một nghiệp vụ khác.');
  }
  if (
    typeof params.ticket.date !== 'string' || !params.ticket.date
    || typeof params.ticket.invoiceNo !== 'string' || !params.ticket.invoiceNo
  ) {
    throw new InventoryError('invalid-ticket', 'Ngày hoặc mã hóa đơn không hợp lệ.');
  }

  const path = ticketPath(params.type);
  const invoiceNo = params.ticket.invoiceNo.trim();
  const duplicateInvoice = Object.values(
    (root[path] as Record<string, TicketRecord> | undefined) || {},
  ).some((ticket) =>
    ticket.status !== 'cancelled'
    && String(ticket.invoiceNo || '').trim().toUpperCase() === invoiceNo.toUpperCase()
  );
  if (duplicateInvoice) {
    throw new InventoryError('invoice-exists', `Mã chứng từ ${invoiceNo} đã tồn tại.`);
  }

  const financials = snapshotFinancials(root, params.type, params.ticket);
  const { items } = financials;
  const stockChanges = applyStock(
    root,
    items,
    params.type === 'import' ? 1 : -1,
    params.type,
  );

  root[path] ??= {};
  const safeTicket = { ...params.ticket };
  for (const field of [
    'key', 'operationId', 'status', 'createdBy', 'createdByUid', 'createdAt',
    'createdByEmail', 'cancelledBy', 'cancelledByUid', 'cancelledAt',
  ]) {
    delete safeTicket[field];
  }
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const costTotal = safeMoney(
    items.reduce((sum, item) => sum + item.quantity * Number(item.costPrice || 0), 0),
    'Tổng giá vốn',
  );
  const firstItem = items[0];
  (root[path] as Record<string, TicketRecord>)[params.ticketKey] = {
    ...safeTicket,
    invoiceNo,
    productId: firstItem.productId,
    productName: items.length === 1 ? firstItem.productName : `${items.length} mặt hàng`,
    quantity: totalQuantity,
    items,
    subtotal: financials.subtotal,
    lineDiscountTotal: financials.lineDiscountTotal,
    invoiceDiscountType: financials.invoiceDiscountType,
    invoiceDiscountValue: financials.invoiceDiscountValue,
    invoiceDiscountAmount: financials.invoiceDiscountAmount,
    discountAmount: financials.discountAmount,
    totalAmount: financials.totalAmount,
    totalQuantity,
    ...(params.type === 'import'
      ? {
          unitPrice: firstItem.unitPrice,
          importPrice: firstItem.unitPrice,
        }
      : params.type === 'export'
        ? {
            unitPrice: firstItem.unitPrice,
            exportPrice: firstItem.unitPrice,
            salePrice: firstItem.unitPrice,
            costTotal,
            profit: financials.totalAmount - costTotal,
          }
        : {
            unitPrice: firstItem.unitPrice,
            actualUnitPrice: firstItem.unitPrice,
            listedPrice: firstItem.listedPrice,
            salePrice: firstItem.unitPrice,
            costTotal,
            profit: financials.totalAmount - costTotal,
          }),
    operationId: params.operationId,
    transactionId: params.operationId,
    status: 'active',
    createdBy: params.actorEmail,
    createdByEmail: params.actorEmail,
    createdByUid: params.actorUid,
    createdAt: params.now,
  };
  root.operations[params.operationId] = {
    action: 'create',
    type: params.type,
    ticketKey: params.ticketKey,
    actorUid: params.actorUid,
    createdAt: params.now,
  };
  root.auditLogs ??= {};
  root.auditLogs[params.operationId] = {
    ...root.operations[params.operationId],
    actorEmail: params.actorEmail,
    totalAmount: financials.totalAmount,
  };
  if (params.type === 'sale') {
    root.stockMovements ??= {};
    stockChanges.forEach(({ item, beforeStock, afterStock }, index) => {
      root.stockMovements![`${params.operationId}_${index}`] = {
        type: 'sale',
        referenceId: params.ticketKey,
        referenceCode: invoiceNo,
        productId: item.productId,
        productName: String(item.productName || item.productId),
        quantity: item.quantity,
        beforeStock,
        afterStock,
        unitPrice: Number(item.unitPrice || 0),
        amount: Number(item.lineTotal || 0),
        createdAt: params.now,
        createdBy: params.actorEmail,
      };
    });
  }
  return 'created';
}

export function applyCancel(
  root: RootData,
  params: {
    type: OperationType;
    ticketKey: string;
    operationId: string;
    actorUid: string;
    actorEmail: string;
    reason: string;
    now: number;
  },
): 'cancelled' | 'duplicate' {
  root.operations ??= {};
  const priorOperation = root.operations[params.operationId];
  if (priorOperation) {
    if (
      priorOperation.action === 'cancel'
      && priorOperation.type === params.type
      && priorOperation.ticketKey === params.ticketKey
    ) {
      return 'duplicate';
    }
    throw new InventoryError('operation-conflict', 'Mã yêu cầu đã được dùng cho một nghiệp vụ khác.');
  }

  const path = ticketPath(params.type);
  const ticket = (root[path] as Record<string, TicketRecord> | undefined)?.[params.ticketKey];
  if (!ticket) throw new InventoryError('ticket-not-found', 'Không tìm thấy chứng từ.');
  if (ticket.status === 'cancelled') {
    throw new InventoryError('already-cancelled', 'Chứng từ này đã được hủy trước đó.');
  }

  const items = normalizeItems(ticket);
  applyStock(root, items, params.type === 'import' ? -1 : 1, params.type, false);

  ticket.status = 'cancelled';
  ticket.cancelledBy = params.actorEmail;
  ticket.cancelledByUid = params.actorUid;
  ticket.cancelledAt = params.now;
  ticket.cancelReason = params.reason;
  root.operations[params.operationId] = {
    action: 'cancel',
    type: params.type,
    ticketKey: params.ticketKey,
    actorUid: params.actorUid,
    createdAt: params.now,
  };
  root.auditLogs ??= {};
  root.auditLogs[params.operationId] = {
    ...root.operations[params.operationId],
    actorEmail: params.actorEmail,
    reason: params.reason,
  };
  return 'cancelled';
}
