import { describe, expect, it } from 'vitest';
import type {
  ExportTicketType,
  ImportTicketType,
  SalesTicketType,
} from '../../components/Db';
import {
  buildReportSummary,
  resolveReportDateRange,
} from './report-data';

const range = {
  startTime: Date.UTC(2026, 6, 1) - 7 * 60 * 60 * 1000,
  endTime: Date.UTC(2026, 6, 31, 23, 59, 59) - 7 * 60 * 60 * 1000,
};

const importTicket = (overrides: Partial<ImportTicketType> = {}): ImportTicketType => ({
  key: 'i-1',
  date: '2026-07-05 09:00',
  supplier: 'Nhà cung cấp',
  productName: 'Máy in',
  productId: 'p-1',
  quantity: 2,
  importPrice: 100,
  totalAmount: 200,
  invoiceNo: 'PN-1',
  ...overrides,
});

const exportTicket = (overrides: Partial<ExportTicketType> = {}): ExportTicketType => ({
  key: 'e-1',
  date: '05/07/2026 10:00',
  customer: 'Khách hàng',
  productName: 'Máy in',
  productId: 'p-1',
  quantity: 1,
  salePrice: 180,
  totalAmount: 180,
  costTotal: 100,
  invoiceNo: 'PX-1',
  ...overrides,
});

const saleTicket = (overrides: Partial<SalesTicketType> = {}): SalesTicketType => ({
  key: 's-1',
  date: '2026-07-06T03:00:00.000Z',
  customerName: 'Khách lẻ',
  productName: 'Giấy in',
  productId: 'p-2',
  quantity: 3,
  salePrice: 50,
  totalAmount: 150,
  profit: 60,
  invoiceNo: 'BH-1',
  type: 'sale',
  ...overrides,
});

describe('report financial aggregation', () => {
  it('keeps KPI and chart totals consistent across legacy date formats', () => {
    const summary = buildReportSummary({
      imports: [importTicket()],
      exports: [exportTicket()],
      sales: [saleTicket()],
      ...range,
    });

    expect(summary.totalIncome).toBe(330);
    expect(summary.totalOutcome).toBe(200);
    expect(summary.grossProfit).toBe(140);
    expect(summary.totalOrders).toBe(3);
    expect(summary.documentDistribution).toEqual([
      { kind: 'sale', name: 'Bán hàng', value: 1 },
      { kind: 'import', name: 'Nhập kho', value: 1 },
      { kind: 'export', name: 'Xuất kho', value: 1 },
    ]);
    expect(summary.documentDistribution.reduce((sum, item) => sum + item.value, 0))
      .toBe(summary.totalOrders);
    expect(summary.chartData.reduce((sum, day) => sum + day.income, 0)).toBe(330);
    expect(summary.chartData.reduce((sum, day) => sum + day.outcome, 0)).toBe(200);
    expect(summary.chartData.reduce((sum, day) => sum + (day.profit ?? 0), 0)).toBe(140);
  });

  it('excludes cancelled records and deduplicates the same operation', () => {
    const summary = buildReportSummary({
      imports: [
        importTicket({ operationId: 'op-1' }),
        importTicket({ key: 'i-copy', operationId: 'op-1' }),
        importTicket({ key: 'i-cancelled', status: 'cancelled', totalAmount: 999 }),
      ],
      exports: [],
      sales: [],
      ...range,
    });

    expect(summary.totalOutcome).toBe(200);
    expect(summary.totalOrders).toBe(1);
  });

  it('excludes soft-deleted and explicitly invalid records', () => {
    const summary = buildReportSummary({
      imports: [
        importTicket(),
        importTicket({ key: 'i-pending', status: 'pending' as 'active' }),
        { ...importTicket({ key: 'i-deleted' }), deletedAt: 1 } as ImportTicketType,
      ],
      exports: [],
      sales: [],
      ...range,
    });

    expect(summary.totalOrders).toBe(1);
    expect(summary.totalOutcome).toBe(200);
  });

  it('uses explicit profit snapshots and reports missing cost coverage', () => {
    const summary = buildReportSummary({
      imports: [],
      exports: [exportTicket({ costTotal: undefined, profit: undefined })],
      sales: [saleTicket({ profit: -20 })],
      ...range,
    });

    expect(summary.grossProfit).toBe(-20);
    expect(summary.missingCostSnapshots).toBe(1);
    expect(summary.dailyRows.find((day) => day.dateKey === '2026-07-05')?.profit).toBeNull();
  });

  it('excludes invalid or out-of-range times without crashing', () => {
    const summary = buildReportSummary({
      imports: [
        importTicket({ key: 'invalid', date: '31/02/2026 10:00' }),
        importTicket({ key: 'old', date: '2026-06-30 23:59' }),
      ],
      exports: [],
      sales: [],
      ...range,
    });

    expect(summary.totalOrders).toBe(0);
    expect(summary.invalidTimeRecords).toBe(1);
    expect(summary.chartData).toEqual([]);
  });

  it('uses item quantities and identifies the top outbound product', () => {
    const summary = buildReportSummary({
      imports: [importTicket({ totalQuantity: 4, quantity: 1 })],
      exports: [exportTicket({
        items: [
          { productId: 'p-1', productName: 'Máy in', quantity: 5 },
          { productId: 'p-2', productName: 'Giấy in', quantity: 2 },
        ],
      })],
      sales: [saleTicket()],
      ...range,
    });

    expect(summary.totalImportQty).toBe(4);
    expect(summary.totalExportQty).toBe(10);
    expect(summary.topProduct).toEqual({ name: 'Máy in', quantity: 5 });
  });

  it('resolves the full local quarter without UTC date drift', () => {
    const thirdQuarter = resolveReportDateRange('quarter', new Date(2026, 6, 31, 22, 30));

    expect([
      thirdQuarter.start.getFullYear(),
      thirdQuarter.start.getMonth(),
      thirdQuarter.start.getDate(),
      thirdQuarter.start.getHours(),
    ]).toEqual([2026, 6, 1, 0]);
    expect([
      thirdQuarter.end.getFullYear(),
      thirdQuarter.end.getMonth(),
      thirdQuarter.end.getDate(),
      thirdQuarter.end.getHours(),
      thirdQuarter.end.getMinutes(),
      thirdQuarter.end.getSeconds(),
    ]).toEqual([2026, 8, 30, 23, 59, 59]);
  });
});
