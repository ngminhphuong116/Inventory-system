import type { SalesTicketType } from './Db';
import { formatDateTimeVi, formatNumberVi, formatVnd, toSafeNumber } from '../utils/format';
import {
  buildReceiptDocumentHtml,
  escapeReceiptHtml,
  openReceiptDocumentPreview,
  safeReceiptText,
} from './ReceiptDocument';
import {
  getTransactionItems,
  getTransactionSubtotal,
  getTransactionTotal,
  type TransactionTicketLike,
} from '../utils/transaction-money';

interface SalesReceiptItem {
  productId?: string;
  productCode?: string;
  productName?: string;
  unit?: string;
  quantity?: unknown;
  unitPrice?: unknown;
  actualUnitPrice?: unknown;
  salePrice?: unknown;
  subtotal?: unknown;
  subtotalBeforeDiscount?: unknown;
  lineDiscountType?: unknown;
  lineDiscountValue?: unknown;
  lineDiscountAmount?: unknown;
  lineTotal?: unknown;
}

export type SalesReceiptRecord = Omit<Partial<SalesTicketType>, 'items'> & {
  items?: SalesReceiptItem[];
  customerPhone?: unknown;
  phone?: unknown;
  note?: unknown;
  notes?: unknown;
  productCode?: unknown;
  unit?: unknown;
};

export { escapeReceiptHtml };

const getPreviewId = (record: SalesReceiptRecord) =>
  safeReceiptText(record.invoiceNo, safeReceiptText(record.key, `sales-receipt-${Date.now()}`));

export function buildSalesReceiptHtml(record: SalesReceiptRecord): string {
  const transaction = record as unknown as TransactionTicketLike;
  const items = getTransactionItems(transaction, 'sale');
  const normalizedItems = items.map((item) => {
    const quantity = Math.max(0, item.quantity);
    const unitPrice = Math.max(0, item.unitPrice);
    const lineTotal = Math.max(0, item.lineTotal);

    return {
      code: safeReceiptText(item.productCode || item.productId),
      name: safeReceiptText(item.productName),
      unit: safeReceiptText(item.unit),
      quantity: formatNumberVi(quantity),
      unitPrice: formatVnd(unitPrice),
      discount: formatVnd(item.lineDiscountAmount),
      lineTotal: formatVnd(lineTotal),
    };
  });

  const subtotal = getTransactionSubtotal(transaction, 'sale');
  const lineDiscount = Math.max(0, toSafeNumber(record.lineDiscountTotal));
  const invoiceDiscount = Math.max(
    0,
    toSafeNumber(record.invoiceDiscountAmount, Math.max(
      0,
      toSafeNumber(record.discountAmount) - lineDiscount,
    )),
  );
  const total = getTransactionTotal(transaction, 'sale');
  const totalQuantity = items.reduce(
    (sum, item) => sum + Math.max(0, toSafeNumber(item.quantity)),
    0,
  );
  const voucherCode = safeReceiptText(record.voucherUsed, '');
  const discountLabel = voucherCode && voucherCode !== 'Không có'
    ? `Giảm giá (${voucherCode})`
    : 'Giảm giá';

  return buildReceiptDocumentHtml({
    previewTitle: 'Xem trước phiếu bán hàng',
    title: 'PHIẾU BÁN HÀNG',
    subtitle: 'Liên giao khách hàng',
    receiptNo: record.invoiceNo,
    date: formatDateTimeVi(record.date),
    ariaLabel: 'Nội dung phiếu bán hàng',
    meta: [
      { label: 'Khách hàng', value: record.customerName },
      { label: 'Số điện thoại', value: record.customerPhone || record.phone },
      { label: 'Người lập', value: record.createdBy, wide: true },
    ],
    items: normalizedItems,
    unitPriceLabel: 'Đơn giá',
    discountLabel: 'Giảm giá',
    summary: [
      { label: 'Tổng số lượng', value: formatNumberVi(totalQuantity) },
      { label: 'Tạm tính', value: formatVnd(subtotal) },
      { label: 'Giảm giá dòng', value: `−${formatVnd(lineDiscount)}` },
      ...(invoiceDiscount > 0
        ? [{ label: discountLabel, value: `−${formatVnd(invoiceDiscount)}` }]
        : [{ label: 'Giảm giá hóa đơn', value: formatVnd(0) }]),
      { label: 'Tổng thanh toán', value: formatVnd(total), total: true },
    ],
    note: record.note || record.notes,
    leftSignature: 'Người lập phiếu',
    rightSignature: 'Khách hàng',
  });
}

export async function openSalesReceiptPreview(record: SalesReceiptRecord): Promise<void> {
  await openReceiptDocumentPreview(getPreviewId(record), buildSalesReceiptHtml(record));
}
