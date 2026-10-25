import { describe, expect, it } from 'vitest';
import type { SalesTicketType } from '../../components/Db';
import { buildSalesExcelRows } from './sales-excel';

describe('sales Excel rows', () => {
  it('creates one bill row and one detail row per immutable item snapshot', () => {
    const sale = {
      key: 'bill-1', invoiceNo: 'BL-01', date: '2026-08-03 10:00',
      customerName: 'Khách A', productId: 'p-1', productName: 'A', quantity: 3,
      salePrice: 10_000, totalAmount: 24_000, type: 'Bán lẻ',
      subtotal: 30_000, lineDiscountTotal: 2_000, invoiceDiscountAmount: 4_000,
      items: [
        { productId: 'p-1', productCode: 'A', productName: 'A', quantity: 1, unitPrice: 10_000, listedPrice: 12_000, lineDiscountType: 'amount', lineDiscountValue: 2_000, lineDiscountAmount: 2_000, subtotalBeforeDiscount: 10_000, lineTotal: 8_000 },
        { productId: 'p-2', productCode: 'B', productName: 'B', quantity: 2, unitPrice: 10_000, listedPrice: 10_000, lineTotal: 20_000 },
      ],
    } as SalesTicketType;
    const rows = buildSalesExcelRows([sale]);
    expect(rows.billRows).toHaveLength(1);
    expect(rows.itemRows).toHaveLength(2);
    expect(rows.billRows[0]).toMatchObject({
      'Tổng số mặt hàng': 2,
      'Tổng số lượng': 3,
      'Giảm giá (đ)': 6_000,
      'Tổng tiền (đ)': 24_000,
    });
    expect(rows.itemRows[0]).toMatchObject({
      'Giá thực tế (đ)': 10_000,
      'Giảm dòng (đ)': 2_000,
      'Thành tiền (đ)': 8_000,
    });
  });

  it('normalizes a legacy one-product bill without mutating it', () => {
    const legacy = {
      key: 'legacy', invoiceNo: 'OLD-1', date: '2025-01-01 10:00',
      customerName: '', productId: 'old', productName: 'Hàng cũ', quantity: 2,
      salePrice: 5_000, totalAmount: 10_000, type: 'Bán lẻ',
    } as SalesTicketType;
    const before = JSON.stringify(legacy);
    const rows = buildSalesExcelRows([legacy]);
    expect(rows.itemRows).toHaveLength(1);
    expect(rows.itemRows[0]).toMatchObject({ 'Tên sản phẩm': 'Hàng cũ', 'Thành tiền (đ)': 10_000 });
    expect(JSON.stringify(legacy)).toBe(before);
  });
});
