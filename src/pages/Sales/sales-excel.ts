import type { SalesTicketType } from '../../components/Db';
import { formatDateTimeVi } from '../../utils/format';
import { normalizeSaleBill } from '../../utils/transaction-money';

export function buildSalesExcelRows(sales: readonly SalesTicketType[]) {
  const billRows = sales.map((record) => {
    const bill = normalizeSaleBill(record);
    return {
      'Mã bill': record.invoiceNo,
      'Thời gian': formatDateTimeVi(record.createdAt || record.date),
      'Khách hàng': record.customerName || 'Khách bán lẻ vãng lai',
      'Người tạo': record.createdBy || record.createdByEmail || '',
      'Tổng số mặt hàng': bill.items.length,
      'Tổng số lượng': bill.totalQuantity,
      'Tạm tính (đ)': bill.subtotal,
      'Giảm giá (đ)': bill.lineDiscountTotal + bill.invoiceDiscountAmount,
      'Tổng tiền (đ)': bill.totalAmount,
    };
  });

  const itemRows = sales.flatMap((record) => {
    const bill = normalizeSaleBill(record);
    return bill.items.map((item) => ({
      'Mã bill': record.invoiceNo,
      'Mã sản phẩm': item.productCode,
      'Tên sản phẩm': item.productName,
      'Số lượng': item.quantity,
      'Giá niêm yết (đ)': Number(item.listedPrice || 0),
      'Giá thực tế (đ)': item.unitPrice,
      'Giảm dòng (đ)': item.lineDiscountAmount,
      'Thành tiền (đ)': item.lineTotal,
    }));
  });

  return { billRows, itemRows };
}
