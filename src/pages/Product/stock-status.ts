import type { ProductType } from '../../components/Db';

export type StockStatus = 'all' | 'normal' | 'warning' | 'critical' | 'out';

export interface ProductFilters {
  term?: string;
  category?: string;
  status: StockStatus;
}

const safeNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function normalizeStockStatus(value: string | null | undefined): StockStatus {
  if (value === 'normal' || value === 'warning' || value === 'critical' || value === 'out') {
    return value;
  }
  if (value === 'low') return 'critical';
  return 'all';
}

export function getStockStatus(
  product: Pick<ProductType, 'quantity' | 'minStock'>,
): Exclude<StockStatus, 'all'> {
  const quantity = safeNumber(product.quantity);
  const minimumStock = Math.max(0, safeNumber(product.minStock));

  if (quantity <= 0) return 'out';
  if (minimumStock > 0 && quantity <= minimumStock) return 'critical';
  if (minimumStock > 0 && quantity <= minimumStock * 2) return 'warning';
  return 'normal';
}

export function filterProducts(
  products: ProductType[],
  filters: ProductFilters,
): ProductType[] {
  const term = filters.term?.trim().toLocaleLowerCase('vi-VN');

  return products.filter((product) => {
    if (
      term
      && !product.name.toLocaleLowerCase('vi-VN').includes(term)
      && !product.code.toLocaleLowerCase('vi-VN').includes(term)
    ) {
      return false;
    }
    if (filters.category && product.category !== filters.category) return false;
    return filters.status === 'all' || getStockStatus(product) === filters.status;
  });
}

export function filtersToSearchParams(filters: ProductFilters): URLSearchParams {
  const params = new URLSearchParams();
  const term = filters.term?.trim();
  if (term) params.set('q', term);
  if (filters.category) params.set('category', filters.category);
  if (filters.status !== 'all') params.set('stockStatus', filters.status);
  return params;
}

export function pageForQuery(
  pagination: { queryString: string; page: number },
  queryString: string,
): number {
  return pagination.queryString === queryString ? pagination.page : 1;
}
