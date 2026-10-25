import { describe, expect, it } from 'vitest';
import {
  calculateTransactionSubtotal,
  getTransactionItems,
  getTransactionTotal,
  normalizeSaleBill,
  normalizeTransactionItem,
  requireTransactionValues,
} from './transaction-money';

describe('transaction money snapshots', () => {
  it('keeps an actual zero price instead of falling back to a listed price', () => {
    expect(normalizeTransactionItem(
      { quantity: 2, unitPrice: 0, salePrice: 10_000 },
      'sale',
      { salePrice: 12_000 },
    )).toMatchObject({ unitPrice: 0, subtotal: 0 });
  });

  it('prioritizes the transaction snapshot over legacy and product prices', () => {
    const item = normalizeTransactionItem(
      { quantity: 100, unitPrice: 8_000, salePrice: 10_000 },
      'sale',
      { salePrice: 12_000 },
    );
    expect(item.unitPrice).toBe(8_000);
    expect(item.subtotal).toBe(800_000);
  });

  it('uses legacy aliases only when a snapshot field is missing', () => {
    expect(normalizeTransactionItem({ quantity: 2, importPrice: 45_000 }, 'import').unitPrice)
      .toBe(45_000);
    expect(normalizeTransactionItem({ quantity: 2, exportPrice: 65_000 }, 'export').unitPrice)
      .toBe(65_000);
  });

  it('normalizes top-level legacy tickets and calculates a shared total', () => {
    const items = getTransactionItems({
      productId: 'p-1',
      productName: 'Sản phẩm',
      quantity: 100,
      salePrice: 8_000,
    }, 'sale');
    expect(calculateTransactionSubtotal(items)).toBe(800_000);
  });

  it('rejects empty, negative, non-finite prices and invalid quantities', () => {
    expect(() => requireTransactionValues(1, '')).toThrow(/Đơn giá/);
    expect(() => requireTransactionValues(1, -1)).toThrow(/Đơn giá/);
    expect(() => requireTransactionValues(1, Number.POSITIVE_INFINITY)).toThrow(/Đơn giá/);
    expect(() => requireTransactionValues(0, 0)).toThrow(/Số lượng/);
  });

  it('normalizes line and invoice discounts without querying current product prices', () => {
    const bill = normalizeSaleBill({
      productName: 'Root fallback',
      subtotal: 20_000,
      lineDiscountTotal: 5_000,
      invoiceDiscountAmount: 2_000,
      totalAmount: 13_000,
      items: [{
        productId: 'p-1', productName: 'Snapshot', quantity: 2,
        unitPrice: 10_000, listedPrice: 99_000,
        subtotalBeforeDiscount: 20_000,
        lineDiscountType: 'amount', lineDiscountValue: 5_000,
        lineDiscountAmount: 5_000, lineTotal: 15_000,
      }],
    });
    expect(bill.items[0]).toMatchObject({
      productName: 'Snapshot', unitPrice: 10_000,
      lineDiscountAmount: 5_000, lineTotal: 15_000,
    });
    expect(bill).toMatchObject({
      subtotal: 20_000, lineDiscountTotal: 5_000,
      invoiceDiscountAmount: 2_000, totalAmount: 13_000, totalQuantity: 2,
    });
  });

  it('keeps legacy one-product sales readable', () => {
    const legacy = {
      productId: 'legacy', productName: 'Hàng cũ', quantity: 2,
      salePrice: 5_000, totalAmount: 9_000, discountAmount: 1_000,
    };
    expect(getTransactionTotal(legacy, 'sale')).toBe(9_000);
    expect(normalizeSaleBill(legacy)).toMatchObject({
      subtotal: 10_000,
      invoiceDiscountAmount: 1_000,
      totalAmount: 9_000,
      totalQuantity: 2,
    });
  });
});
