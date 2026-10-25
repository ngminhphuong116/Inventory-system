import { toSafeNumber } from './format';

export type TransactionKind = 'import' | 'export' | 'sale';

export interface TransactionProductFallback {
  id?: string;
  code?: string;
  name?: string;
  unit?: string;
  importPrice?: unknown;
  salePrice?: unknown;
  price?: unknown;
}

export interface TransactionItemLike {
  productId?: unknown;
  productCode?: unknown;
  productName?: unknown;
  code?: unknown;
  name?: unknown;
  unit?: unknown;
  quantity?: unknown;
  qty?: unknown;
  amount?: unknown;
  unitPrice?: unknown;
  actualUnitPrice?: unknown;
  listedPrice?: unknown;
  importPrice?: unknown;
  exportPrice?: unknown;
  salePrice?: unknown;
  price?: unknown;
  subtotal?: unknown;
  subtotalBeforeDiscount?: unknown;
  lineDiscountType?: unknown;
  lineDiscountValue?: unknown;
  lineDiscountAmount?: unknown;
  lineTotal?: unknown;
  total?: unknown;
  costPrice?: unknown;
}

export interface NormalizedTransactionItem extends TransactionItemLike {
  productId: string;
  productCode: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  subtotalBeforeDiscount: number;
  lineDiscountType: 'none' | 'amount' | 'percent';
  lineDiscountValue: number;
  lineDiscountAmount: number;
  lineTotal: number;
}

export interface TransactionTicketLike extends TransactionItemLike {
  items?: TransactionItemLike[];
  totalAmount?: unknown;
  discountAmount?: unknown;
  lineDiscountTotal?: unknown;
  invoiceDiscountType?: unknown;
  invoiceDiscountValue?: unknown;
  invoiceDiscountAmount?: unknown;
  totalQuantity?: unknown;
}

const firstPresent = (...values: unknown[]) =>
  values.find((value) => value !== undefined && value !== null && value !== '');

function legacyPrice(item: TransactionItemLike, kind: TransactionKind) {
  if (kind === 'import') {
    return firstPresent(item.importPrice, item.price, item.salePrice, item.exportPrice);
  }
  if (kind === 'export') {
    return firstPresent(item.exportPrice, item.salePrice, item.price, item.importPrice);
  }
  return firstPresent(item.salePrice, item.price, item.exportPrice, item.importPrice);
}

function productFallbackPrice(
  product: TransactionProductFallback | undefined,
  kind: TransactionKind,
) {
  if (!product) return undefined;
  return kind === 'import'
    ? firstPresent(product.importPrice, product.price, product.salePrice)
    : firstPresent(product.salePrice, product.price, product.importPrice);
}

export function calculateLineSubtotal(quantity: unknown, unitPrice: unknown) {
  return toSafeNumber(quantity) * toSafeNumber(unitPrice);
}

export function normalizeTransactionItem(
  item: TransactionItemLike,
  kind: TransactionKind,
  product?: TransactionProductFallback,
): NormalizedTransactionItem {
  const quantity = toSafeNumber(firstPresent(item.quantity, item.qty, item.amount));
  const rawUnitPrice = firstPresent(
    item.unitPrice,
    item.actualUnitPrice,
    legacyPrice(item, kind),
    productFallbackPrice(product, kind),
  );
  const unitPrice = toSafeNumber(rawUnitPrice);
  const computedSubtotal = calculateLineSubtotal(quantity, unitPrice);
  const subtotalBeforeDiscount = toSafeNumber(
    firstPresent(item.subtotalBeforeDiscount, item.subtotal),
    computedSubtotal,
  );
  const lineDiscountType = item.lineDiscountType === 'amount'
    || item.lineDiscountType === 'percent'
    ? item.lineDiscountType
    : 'none';
  const rawDiscountValue = Math.max(0, toSafeNumber(item.lineDiscountValue));
  const lineDiscountValue = lineDiscountType === 'percent'
    ? Math.min(100, rawDiscountValue)
    : rawDiscountValue;
  const calculatedLineDiscount = lineDiscountType === 'percent'
    ? Math.floor((subtotalBeforeDiscount * lineDiscountValue) / 100)
    : lineDiscountType === 'amount'
      ? lineDiscountValue
      : 0;
  const lineDiscountAmount = Math.min(
    subtotalBeforeDiscount,
    Math.max(0, toSafeNumber(item.lineDiscountAmount, calculatedLineDiscount)),
  );
  const lineTotal = Math.min(
    subtotalBeforeDiscount,
    Math.max(0, toSafeNumber(
      firstPresent(item.lineTotal, item.total),
      subtotalBeforeDiscount - lineDiscountAmount,
    )),
  );

  return {
    ...item,
    productId: String(firstPresent(item.productId, product?.id) ?? ''),
    productCode: String(firstPresent(item.productCode, item.code, product?.code) ?? ''),
    productName: String(firstPresent(item.productName, item.name, product?.name) ?? ''),
    unit: String(firstPresent(item.unit, product?.unit) ?? ''),
    quantity,
    unitPrice,
    subtotal: subtotalBeforeDiscount,
    subtotalBeforeDiscount,
    lineDiscountType,
    lineDiscountValue,
    lineDiscountAmount,
    lineTotal,
  };
}

export function getTransactionItems(
  ticket: TransactionTicketLike,
  kind: TransactionKind,
  products?: ReadonlyMap<string, TransactionProductFallback>,
) {
  const source = Array.isArray(ticket.items) && ticket.items.length > 0
    ? ticket.items
    : [ticket];

  return source.map((item) => {
    const productId = String(item.productId ?? ticket.productId ?? '');
    const mergedItem = item === ticket
      ? item
      : {
          ...item,
          productId,
          productCode: firstPresent(item.productCode, ticket.productCode),
          productName: firstPresent(item.productName, ticket.productName),
        };
    return normalizeTransactionItem(mergedItem, kind, products?.get(productId));
  });
}

export function calculateTransactionSubtotal(
  items: ReadonlyArray<Pick<NormalizedTransactionItem, 'quantity' | 'unitPrice'>>,
) {
  return items.reduce(
    (sum, item) => sum + calculateLineSubtotal(item.quantity, item.unitPrice),
    0,
  );
}

export function getTransactionSubtotal(
  ticket: TransactionTicketLike,
  kind: TransactionKind,
  products?: ReadonlyMap<string, TransactionProductFallback>,
) {
  const items = getTransactionItems(ticket, kind, products);
  return calculateTransactionSubtotal(items);
}

export function getTransactionTotal(
  ticket: TransactionTicketLike,
  kind: TransactionKind,
  products?: ReadonlyMap<string, TransactionProductFallback>,
) {
  const source = Array.isArray(ticket.items) && ticket.items.length > 0
    ? ticket.items
    : [ticket];
  const hasTransactionPrice = source.some((item) => firstPresent(
    item.unitPrice,
    item.actualUnitPrice,
    item.importPrice,
    item.exportPrice,
    item.salePrice,
    item.price,
  ) !== undefined);
  const subtotal = getTransactionSubtotal(ticket, kind, products);
  if (kind === 'sale' && hasTransactionPrice) {
    const items = getTransactionItems(ticket, kind, products);
    const calculatedLineDiscount = items.reduce(
      (sum, item) => sum + item.lineDiscountAmount,
      0,
    );
    const lineDiscountTotal = Math.min(
      subtotal,
      Math.max(0, toSafeNumber(ticket.lineDiscountTotal, calculatedLineDiscount)),
    );
    const afterLineDiscount = Math.max(0, subtotal - lineDiscountTotal);
    const legacyDiscount = Math.max(0, toSafeNumber(ticket.discountAmount));
    const invoiceDiscountFallback = ticket.lineDiscountTotal !== undefined
      ? Math.max(0, legacyDiscount - lineDiscountTotal)
      : legacyDiscount;
    const invoiceDiscount = Math.min(
      afterLineDiscount,
      Math.max(0, toSafeNumber(ticket.invoiceDiscountAmount, invoiceDiscountFallback)),
    );
    return Math.max(0, afterLineDiscount - invoiceDiscount);
  }
  if (hasTransactionPrice) return Math.max(0, subtotal);
  const storedTotal = Number(ticket.totalAmount);
  return Number.isFinite(storedTotal) && storedTotal >= 0 ? storedTotal : 0;
}

export function normalizeSaleBill<T extends TransactionTicketLike>(bill: T) {
  const items = getTransactionItems(bill, 'sale');
  const subtotal = calculateTransactionSubtotal(items);
  const lineDiscountTotal = Math.min(
    subtotal,
    Math.max(0, toSafeNumber(
      bill.lineDiscountTotal,
      items.reduce((sum, item) => sum + item.lineDiscountAmount, 0),
    )),
  );
  const totalAmount = getTransactionTotal(bill, 'sale');
  const invoiceDiscountAmount = Math.max(
    0,
    subtotal - lineDiscountTotal - totalAmount,
  );
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);

  return {
    ...bill,
    items,
    subtotal,
    lineDiscountTotal,
    invoiceDiscountAmount,
    discountAmount: lineDiscountTotal + invoiceDiscountAmount,
    totalAmount,
    totalQuantity,
  };
}

export function requireTransactionValues(quantityInput: unknown, unitPriceInput: unknown) {
  const quantity = Number(quantityInput);
  const unitPrice = Number(unitPriceInput);

  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new Error('Số lượng phải là số nguyên lớn hơn 0.');
  }
  if (unitPriceInput === '' || unitPriceInput === null || unitPriceInput === undefined
    || !Number.isSafeInteger(unitPrice) || unitPrice < 0) {
    throw new Error('Đơn giá phải là số hợp lệ và không được âm.');
  }
  const subtotal = quantity * unitPrice;
  if (!Number.isSafeInteger(subtotal) || subtotal < 0) {
    throw new Error('Thành tiền vượt giới hạn cho phép.');
  }

  return { quantity, unitPrice, subtotal };
}

export const transactionQuantityRule = {
  validator: (_: unknown, value: unknown) => {
    try {
      requireTransactionValues(value, 0);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  },
};

export const transactionUnitPriceRule = {
  validator: (_: unknown, value: unknown) => {
    const unitPrice = Number(value);
    if (value === '' || value === null || value === undefined
      || !Number.isSafeInteger(unitPrice) || unitPrice < 0) {
      return Promise.reject(new Error('Đơn giá phải là số hợp lệ và không được âm.'));
    }
    return Promise.resolve();
  },
};
