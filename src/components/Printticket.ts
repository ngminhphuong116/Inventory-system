import { formatDateTimeVi, formatNumberVi, formatVnd, toSafeNumber } from '../utils/format';
import {
  buildReceiptDocumentHtml,
  COMPANY_LEGAL_NAME,
  openReceiptDocumentPreview,
  safeReceiptText,
} from './ReceiptDocument';
import {
  getTransactionItems,
  getTransactionSubtotal,
  getTransactionTotal,
  type TransactionKind,
} from '../utils/transaction-money';

export { COMPANY_LEGAL_NAME };

export interface TicketPresentation {
  titlePage: string;
  previewTitle: string;
  subtitle: string;
  partnerLabel: string;
  partnerValue: unknown;
  reasonLabel: string;
  reasonValue: string;
  priceLabel: string;
  recipientSignatureTitle: string;
}

export function resolveTicketPresentation(record: any): TicketPresentation {
  const typeStr = String(record?.type || '').toLowerCase();
  const presentation: TicketPresentation = {
    titlePage: 'PHIẾU BÁN HÀNG CỦA CỬA HÀNG',
    previewTitle: 'Xem trước phiếu bán hàng',
    subtitle: 'Liên giao khách hàng',
    partnerLabel: 'Tên khách mua hàng:',
    partnerValue: record?.customerName || record?.customer || 'Khách bán lẻ vãng lai',
    reasonLabel: 'Lý do xuất bán:',
    reasonValue: 'Bán lẻ hàng hóa trực tiếp tại quầy',
    priceLabel: 'Giá bán',
    recipientSignatureTitle: 'Khách hàng',
  };

  if (typeStr.includes('nhập') || typeStr.includes('import')) {
    return {
      ...presentation,
      titlePage: 'PHIẾU NHẬP KHO HÀNG HÓA',
      previewTitle: 'Xem trước phiếu nhập kho',
      subtitle: 'Liên lưu tại kho',
      partnerLabel: 'Nhà cung cấp / Đối tác:',
      partnerValue: record?.supplier || 'Đối tác vãng lai',
      reasonLabel: 'Lý do nhập kho:',
      reasonValue: 'Nhập hàng hóa bổ sung kho định kỳ',
      priceLabel: 'Giá nhập',
      recipientSignatureTitle: 'Người giao hàng / Nhà cung cấp',
    };
  }

  if (typeStr.includes('xuất') || typeStr.includes('export')) {
    return {
      ...presentation,
      titlePage: 'PHIẾU XUẤT KHO HÀNG HÓA',
      previewTitle: 'Xem trước phiếu xuất kho',
      subtitle: 'Liên giao đơn vị nhận',
      partnerLabel: 'Khách hàng / Đơn vị nhận:',
      partnerValue: record?.customer || 'Đối tác vãng lai',
      reasonLabel: 'Lý do xuất kho:',
      reasonValue: 'Xuất chuyển kho nội bộ / phục vụ kinh doanh',
      priceLabel: 'Giá bán',
      recipientSignatureTitle: 'Người nhận hàng / Khách hàng',
    };
  }

  return presentation;
}

export function buildTicketHtml(record: any): string {
  const presentation = resolveTicketPresentation(record);
  const isImportTicket = presentation.priceLabel === 'Giá nhập';
  const kind: TransactionKind = isImportTicket
    ? 'import'
    : String(record?.type || '').toLocaleLowerCase('vi-VN').includes('xuất')
      || String(record?.type || '').toLowerCase().includes('export')
      ? 'export'
      : 'sale';
  const items = getTransactionItems(record, kind);
  const normalizedItems = items.map((item) => {
    const quantity = Math.max(0, item.quantity);
    const unitPrice = Math.max(0, item.unitPrice);
    const lineTotal = Math.max(0, item.subtotal);

    return {
      code: item.productCode || item.code || item.productId,
      name: item.productName || item.name || 'Sản phẩm không tên',
      unit: item.unit,
      quantity: formatNumberVi(quantity),
      unitPrice: formatVnd(unitPrice),
      lineTotal: formatVnd(lineTotal),
    };
  });
  const totalQuantity = items.reduce(
    (sum, item) => sum + Math.max(0, item.quantity),
    0,
  );
  const subtotal = getTransactionSubtotal(record, kind);
  const discount = Math.max(0, toSafeNumber(record.discountAmount));
  const total = record.totalAmount === undefined && record.totalPrice !== undefined
    ? Math.max(0, toSafeNumber(record.totalPrice))
    : getTransactionTotal(record, kind);
  const voucherCode = safeReceiptText(record.voucherUsed, '');
  const discountLabel = voucherCode && voucherCode !== 'Không có'
    ? `Chiết khấu (${voucherCode})`
    : 'Chiết khấu';

  return buildReceiptDocumentHtml({
    previewTitle: presentation.previewTitle,
    title: presentation.titlePage,
    subtitle: presentation.subtitle,
    receiptNo: record.invoiceNo,
    date: formatDateTimeVi(record.date),
    dateLabel: 'Ngày chứng từ',
    ariaLabel: `Nội dung ${presentation.titlePage.toLocaleLowerCase('vi-VN')}`,
    meta: [
      { label: presentation.partnerLabel, value: presentation.partnerValue, wide: true },
      { label: presentation.reasonLabel, value: presentation.reasonValue, wide: true },
    ],
    items: normalizedItems,
    unitPriceLabel: presentation.priceLabel,
    summary: [
      { label: 'Tổng số lượng', value: formatNumberVi(totalQuantity) },
      { label: 'Cộng tiền hàng', value: formatVnd(subtotal) },
      ...(discount > 0 ? [{ label: discountLabel, value: `−${formatVnd(discount)}` }] : []),
      { label: 'Tổng tiền thanh toán', value: formatVnd(total), total: true },
    ],
    note: record.note || record.notes,
    leftSignature: 'Người lập phiếu',
    rightSignature: presentation.recipientSignatureTitle,
  });
}

export function printTicket(record: any) {
  if (!record) return;

  const receiptId = safeReceiptText(
    record.invoiceNo,
    safeReceiptText(record.key, `warehouse-receipt-${Date.now()}`),
  );
  openReceiptDocumentPreview(receiptId, buildTicketHtml(record)).catch((error: unknown) => {
    console.error('Lỗi mở cửa sổ in:', error);
    alert('Không thể mở cửa sổ in phiếu. Vui lòng thử lại.');
  });
}
