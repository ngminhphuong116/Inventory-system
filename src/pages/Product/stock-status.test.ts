import { describe, expect, it } from 'vitest';
import type { ProductType } from '../../components/Db';
import {
  filterProducts,
  filtersToSearchParams,
  getStockStatus,
  normalizeStockStatus,
  pageForQuery,
  type StockStatus,
} from './stock-status';

const product = (
  id: string,
  quantity: number,
  minStock?: number,
): ProductType => ({
  id,
  code: id.toUpperCase(),
  name: `Sản phẩm ${id}`,
  unit: 'cái',
  category: 'CARD',
  importPrice: 0,
  salePrice: 0,
  supplier: '',
  quantity,
  minStock: minStock as number,
  status: '',
});

describe('stock status', () => {
  it.each([
    [-1, 5, 'out'],
    [0, 5, 'out'],
    [5, 5, 'critical'],
    [6, 5, 'warning'],
    [10, 5, 'warning'],
    [11, 5, 'normal'],
    [1, undefined, 'normal'],
  ] as Array<[number, number | undefined, Exclude<StockStatus, 'all'>]>)(
    'classifies quantity=%s minimum=%s as %s without overlap',
    (quantity, minimumStock, expected) => {
      expect(getStockStatus(product('p', quantity, minimumStock))).toBe(expected);
    },
  );

  it.each(['normal', 'warning', 'critical', 'out'] as const)(
    'filters directly by %s',
    (status) => {
      const products = [
        product('normal', 11, 5),
        product('warning', 8, 5),
        product('critical', 5, 5),
        product('out', 0, 5),
      ];
      expect(filterProducts(products, { status }).map((item) => item.id)).toEqual([status]);
    },
  );

  it('normalizes URL aliases and keeps the filter on refresh', () => {
    expect(normalizeStockStatus('low')).toBe('critical');
    expect(normalizeStockStatus('warning')).toBe('warning');
    expect(normalizeStockStatus('unknown')).toBe('all');
    expect(
      filtersToSearchParams({ term: ' card ', category: 'CARD', status: 'critical' }).toString(),
    ).toBe('q=card&category=CARD&stockStatus=critical');
  });

  it('reset omits the stock status query', () => {
    expect(filtersToSearchParams({ status: 'all' }).toString()).toBe('');
  });

  it('resets pagination to page one when the filter query changes', () => {
    expect(pageForQuery({ queryString: 'stockStatus=normal', page: 3 }, 'stockStatus=out')).toBe(1);
    expect(pageForQuery({ queryString: 'stockStatus=normal', page: 3 }, 'stockStatus=normal')).toBe(3);
  });
});
