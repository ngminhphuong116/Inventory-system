import type { ProductType } from '../../components/Db';

export type DiscountType = 'none' | 'amount' | 'percent';

export interface CartItem {
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  availableStock: number;
  quantity: number;
  listedPrice: number;
  unitPrice: number;
  lineDiscountType: DiscountType;
  lineDiscountValue: number;
  lineDiscountAmount: number;
  subtotalBeforeDiscount: number;
  lineTotal: number;
  unitCost?: number;
}

export interface InvoiceDiscount {
  type: DiscountType;
  value: number;
  amount: number;
  code?: string;
}

export interface CartSummary {
  subtotal: number;
  lineDiscountTotal: number;
  afterLineDiscount: number;
  invoiceDiscountAmount: number;
  grandTotal: number;
  totalQuantity: number;
}

function safeNonNegativeInteger(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

export function recalculateCartItem(item: CartItem): CartItem {
  const quantity = safeNonNegativeInteger(item.quantity);
  const unitPrice = safeNonNegativeInteger(item.unitPrice);
  const subtotalBeforeDiscount = Number.isSafeInteger(quantity * unitPrice)
    ? quantity * unitPrice
    : 0;
  const requestedValue = safeNonNegativeInteger(item.lineDiscountValue);
  const lineDiscountValue = item.lineDiscountType === 'percent'
    ? Math.min(100, requestedValue)
    : requestedValue;
  const requestedDiscount = item.lineDiscountType === 'percent'
    ? Math.floor((subtotalBeforeDiscount * lineDiscountValue) / 100)
    : item.lineDiscountType === 'amount'
      ? lineDiscountValue
      : 0;
  const lineDiscountAmount = Math.min(subtotalBeforeDiscount, requestedDiscount);

  return {
    ...item,
    quantity,
    unitPrice,
    lineDiscountValue,
    subtotalBeforeDiscount,
    lineDiscountAmount,
    lineTotal: Math.max(0, subtotalBeforeDiscount - lineDiscountAmount),
  };
}

export function createCartItem(
  product: ProductType,
  quantityInput: unknown,
  unitPriceInput: unknown,
): CartItem {
  const quantity = Number(quantityInput);
  const unitPrice = Number(unitPriceInput);
  const availableStock = safeNonNegativeInteger(product.quantity);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new Error('Số lượng phải là số nguyên lớn hơn 0.');
  }
  if (!Number.isSafeInteger(unitPrice) || unitPrice < 0) {
    throw new Error('Đơn giá phải là số hợp lệ và không được âm.');
  }
  if (quantity > availableStock) {
    throw new Error(`Số lượng vượt tồn kho khả dụng (${availableStock} ${product.unit || ''}).`);
  }

  return recalculateCartItem({
    productId: product.id,
    productCode: product.code || '',
    productName: product.name,
    unit: product.unit || '',
    availableStock,
    quantity,
    listedPrice: safeNonNegativeInteger(product.salePrice),
    unitPrice,
    lineDiscountType: 'none',
    lineDiscountValue: 0,
    lineDiscountAmount: 0,
    subtotalBeforeDiscount: 0,
    lineTotal: 0,
    unitCost: safeNonNegativeInteger(product.importPrice),
  });
}

export function addProductToCart(
  current: readonly CartItem[],
  product: ProductType,
  quantityInput: unknown,
  unitPriceInput: unknown,
) {
  const incoming = createCartItem(product, quantityInput, unitPriceInput);
  const existing = current.find((item) => item.productId === product.id);
  if (!existing) return [...current, incoming];

  const nextQuantity = existing.quantity + incoming.quantity;
  if (nextQuantity > existing.availableStock) {
    throw new Error(
      `Không thể thêm ${product.name}: tổng số lượng ${nextQuantity} vượt tồn kho ${existing.availableStock}.`,
    );
  }
  return current.map((item) => item.productId === product.id
    ? recalculateCartItem({ ...item, quantity: nextQuantity })
    : item);
}

export function calculateInvoiceDiscount(
  afterLineDiscount: number,
  discount: InvoiceDiscount,
) {
  const base = safeNonNegativeInteger(afterLineDiscount);
  const rawValue = safeNonNegativeInteger(discount.value);
  const value = discount.type === 'percent' ? Math.min(100, rawValue) : rawValue;
  const requested = discount.type === 'percent'
    ? Math.floor((base * value) / 100)
    : discount.type === 'amount'
      ? value
      : 0;
  return Math.min(base, requested);
}

export function summarizeCart(
  items: readonly CartItem[],
  discount: InvoiceDiscount,
): CartSummary {
  const subtotal = items.reduce((sum, item) => sum + item.subtotalBeforeDiscount, 0);
  const lineDiscountTotal = items.reduce((sum, item) => sum + item.lineDiscountAmount, 0);
  const afterLineDiscount = Math.max(0, subtotal - lineDiscountTotal);
  const invoiceDiscountAmount = calculateInvoiceDiscount(afterLineDiscount, discount);
  return {
    subtotal,
    lineDiscountTotal,
    afterLineDiscount,
    invoiceDiscountAmount,
    grandTotal: Math.max(0, afterLineDiscount - invoiceDiscountAmount),
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
  };
}

export function isCartItemValid(item: CartItem) {
  return Number.isSafeInteger(item.quantity)
    && item.quantity > 0
    && item.quantity <= item.availableStock
    && Number.isSafeInteger(item.unitPrice)
    && item.unitPrice >= 0
    && Number.isSafeInteger(item.lineTotal)
    && item.lineTotal >= 0;
}
