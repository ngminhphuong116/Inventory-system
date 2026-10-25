import { describe, expect, it } from 'vitest';
import type { ProductType } from '../../components/Db';
import {
  addProductToCart,
  calculateInvoiceDiscount,
  createCartItem,
  recalculateCartItem,
  summarizeCart,
} from './sales-cart';

const product: ProductType = {
  id: 'p-1', code: 'SP01', name: 'Sản phẩm', unit: 'cái', category: 'A',
  importPrice: 8_000, salePrice: 10_000, supplier: '', quantity: 5,
  minStock: 1, status: 'Normal',
};

describe('POS cart calculations', () => {
  it('adds different products and merges repeated products without replacing the edited price', () => {
    const edited = { ...createCartItem(product, 1, 10_000), unitPrice: 9_000 };
    const merged = addProductToCart([edited], product, 2, 10_000);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ quantity: 3, unitPrice: 9_000, lineTotal: 27_000 });
  });

  it('rejects invalid, non-finite and over-stock additions', () => {
    expect(() => createCartItem(product, 0, 10_000)).toThrow(/Số lượng/);
    expect(() => createCartItem(product, 1, Number.POSITIVE_INFINITY)).toThrow(/Đơn giá/);
    expect(() => createCartItem(product, 6, 10_000)).toThrow(/vượt tồn/);
    expect(() => addProductToCart([createCartItem(product, 4, 0)], product, 2, 0))
      .toThrow(/vượt tồn/);
  });

  it('calculates amount and percent line discounts and clamps them safely', () => {
    const base = createCartItem(product, 2, 10_000);
    expect(recalculateCartItem({
      ...base, lineDiscountType: 'amount', lineDiscountValue: 5_000,
    })).toMatchObject({ lineDiscountAmount: 5_000, lineTotal: 15_000 });
    expect(recalculateCartItem({
      ...base, lineDiscountType: 'percent', lineDiscountValue: 25,
    })).toMatchObject({ lineDiscountAmount: 5_000, lineTotal: 15_000 });
    expect(recalculateCartItem({
      ...base, lineDiscountType: 'percent', lineDiscountValue: 150,
    })).toMatchObject({ lineDiscountValue: 100, lineTotal: 0 });
  });

  it('supports invoice discounts, zero prices and totals every line explicitly', () => {
    const gift = createCartItem({ ...product, id: 'gift', quantity: 100 }, 10, 0);
    const paid = createCartItem(product, 2, 10_000);
    const summary = summarizeCart([gift, paid], { type: 'percent', value: 10, amount: 0 });
    expect(summary).toEqual({
      subtotal: 20_000,
      lineDiscountTotal: 0,
      afterLineDiscount: 20_000,
      invoiceDiscountAmount: 2_000,
      grandTotal: 18_000,
      totalQuantity: 12,
    });
    expect(calculateInvoiceDiscount(20_000, { type: 'amount', value: 99_000, amount: 0 }))
      .toBe(20_000);
  });
});
