import type {
  ExportTicketType,
  ImportTicketType,
  SalesTicketType,
  TicketItem,
} from '../../components/Db';
import {
  recordVietnamDateKey,
  resolveRecordTimestamp,
} from '../../utils/record-time';
import { toSafeNumber } from '../../utils/format';
import {
  getTransactionItems,
  getTransactionTotal,
  type TransactionKind,
  type TransactionTicketLike,
} from '../../utils/transaction-money';

export type ReportPeriod = 'day' | 'month' | 'quarter';
export type ReportDocumentKind = 'sale' | 'import' | 'export';

type OutboundTicket = ExportTicketType | SalesTicketType;
type AnyTicket = ImportTicketType | ExportTicketType | SalesTicketType;

export interface ReportDateRange {
  start: Date;
  end: Date;
}

export interface ReportChartPoint {
  dateKey: string;
  date: string;
  income: number;
  outcome: number;
  profit: number | null;
  totalDocuments: number;
  saleDocuments: number;
  importDocuments: number;
  exportDocuments: number;
}

export interface ReportDocument {
  kind: ReportDocumentKind;
  typeLabel: string;
  code: string;
  timestamp: number;
  dateKey: string;
  statusLabel: string;
  createdBy: string;
  totalQuantity: number;
  totalAmount: number;
  costTotal: number | null;
  profit: number | null;
  note: string;
  items: ReportDocumentItem[];
}

export interface ReportDocumentItem {
  productId: string;
  productCode: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface DocumentDistributionItem {
  kind: ReportDocumentKind;
  name: string;
  value: number;
}

export interface ReportSummary {
  totalIncome: number;
  totalOutcome: number;
  grossProfit: number;
  totalOrders: number;
  totalImportQty: number;
  totalExportQty: number;
  missingCostSnapshots: number;
  invalidTimeRecords: number;
  chartData: ReportChartPoint[];
  dailyRows: ReportChartPoint[];
  documents: ReportDocument[];
  documentDistribution: DocumentDistributionItem[];
  highestIncomeDay?: ReportChartPoint;
  highestOutcomeDay?: ReportChartPoint;
  topProduct?: { name: string; quantity: number };
}

export interface ReportDataInput {
  imports: ImportTicketType[];
  exports: ExportTicketType[];
  sales: SalesTicketType[];
  startTime: number;
  endTime: number;
}

const VALID_STATUSES = new Set(['active', 'completed', 'complete', 'valid', 'success']);

function endOfLocalDay(date: Date) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999,
  );
}

export function resolveReportDateRange(
  period: ReportPeriod,
  now = new Date(),
): ReportDateRange {
  const year = now.getFullYear();
  const month = now.getMonth();

  if (period === 'day') {
    return {
      start: new Date(year, month, now.getDate(), 0, 0, 0, 0),
      end: endOfLocalDay(now),
    };
  }

  if (period === 'quarter') {
    const firstMonth = Math.floor(month / 3) * 3;
    return {
      start: new Date(year, firstMonth, 1, 0, 0, 0, 0),
      end: new Date(year, firstMonth + 3, 0, 23, 59, 59, 999),
    };
  }

  return {
    start: new Date(year, month, 1, 0, 0, 0, 0),
    end: new Date(year, month + 1, 0, 23, 59, 59, 999),
  };
}

function isValidTicket(record: AnyTicket) {
  const raw = record as unknown as Record<string, unknown>;
  if (
    raw.deleted === true
    || raw.isDeleted === true
    || raw.archived === true
    || raw.deletedAt
    || raw.removedAt
  ) return false;

  const status = String(raw.status ?? '').trim().toLocaleLowerCase('en-US');
  // Chứng từ cũ chưa có status được coi là hợp lệ để không làm mất số liệu lịch sử.
  return !status || VALID_STATUSES.has(status);
}

function activeUnique<T extends AnyTicket>(records: T[], kind: ReportDocumentKind) {
  const seen = new Set<string>();
  return records.filter((record) => {
    if (!isValidTicket(record)) return false;
    const identity = record.operationId || record.key;
    if (!identity) return true;
    const dedupeKey = `${kind}:${identity}`;
    if (seen.has(dedupeKey)) return false;
    seen.add(dedupeKey);
    return true;
  });
}

function totalTicketQuantity(ticket: {
  totalQuantity?: number;
  quantity?: number;
  items?: TicketItem[];
}) {
  if (Number.isFinite(Number(ticket.totalQuantity))) {
    return toSafeNumber(ticket.totalQuantity);
  }
  if (Array.isArray(ticket.items) && ticket.items.length) {
    return ticket.items.reduce(
      (sum, item) => sum + toSafeNumber(item.quantity),
      0,
    );
  }
  return toSafeNumber(ticket.quantity);
}

function ticketFinancials(ticket: OutboundTicket, totalAmount: number) {
  if (Number.isFinite(Number(ticket.costTotal))) {
    const costTotal = toSafeNumber(ticket.costTotal);
    return {
      costTotal,
      profit: Number.isFinite(Number(ticket.profit))
        ? toSafeNumber(ticket.profit)
        : totalAmount - costTotal,
    };
  }
  if (Number.isFinite(Number(ticket.profit))) {
    const profit = toSafeNumber(ticket.profit);
    return { costTotal: totalAmount - profit, profit };
  }
  return { costTotal: null, profit: null };
}

function dayLabel(dateKey: string) {
  const [, month, day] = dateKey.split('-');
  return `${day}/${month}`;
}

function inRange(record: AnyTicket, startTime: number, endTime: number) {
  const timestamp = resolveRecordTimestamp(record as unknown as Record<string, unknown>);
  return timestamp > 0 && timestamp >= startTime && timestamp <= endTime;
}

function addProducts(
  products: Map<string, { name: string; quantity: number }>,
  ticket: { productName?: string; quantity?: number; items?: TicketItem[] },
) {
  const items = Array.isArray(ticket.items) && ticket.items.length
    ? ticket.items
    : [{
        productId: '',
        productName: ticket.productName || 'Sản phẩm chưa xác định',
        quantity: toSafeNumber(ticket.quantity),
      }];

  items.forEach((item) => {
    const name = item.productName?.trim() || 'Sản phẩm chưa xác định';
    const key = name.toLocaleLowerCase('vi-VN');
    const current = products.get(key) || { name, quantity: 0 };
    current.quantity += toSafeNumber(item.quantity);
    products.set(key, current);
  });
}

function documentNote(ticket: AnyTicket) {
  const raw = ticket as unknown as Record<string, unknown>;
  return String(raw.note ?? raw.notes ?? raw.description ?? '').trim();
}

function buildDocument(
  ticket: AnyTicket,
  kind: ReportDocumentKind,
): ReportDocument {
  const timestamp = resolveRecordTimestamp(ticket as unknown as Record<string, unknown>);
  const transactionKind: TransactionKind = kind;
  const transaction = ticket as unknown as TransactionTicketLike;
  const items = getTransactionItems(transaction, transactionKind);
  const totalAmount = getTransactionTotal(transaction, transactionKind);
  const outbound = kind === 'import'
    ? { costTotal: totalAmount, profit: null }
    : ticketFinancials(ticket as OutboundTicket, totalAmount);

  return {
    kind,
    typeLabel: kind === 'sale' ? 'Bán hàng' : kind === 'import' ? 'Nhập kho' : 'Xuất kho',
    code: String(ticket.invoiceNo || '').trim(),
    timestamp,
    dateKey: recordVietnamDateKey(ticket as unknown as Record<string, unknown>),
    statusLabel: 'Hoàn tất',
    createdBy: String(ticket.createdBy || '').trim(),
    totalQuantity: totalTicketQuantity(ticket),
    totalAmount,
    costTotal: outbound.costTotal,
    profit: outbound.profit,
    note: documentNote(ticket),
    items: items.map((item) => ({
      productId: item.productId,
      productCode: item.productCode,
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      subtotal: item.quantity * item.unitPrice,
    })),
  };
}

export function buildDailyReportRows(documents: ReportDocument[]) {
  const dayMap = new Map<string, ReportChartPoint>();

  documents.forEach((document) => {
    if (!document.dateKey) return;
    const point = dayMap.get(document.dateKey) || {
      dateKey: document.dateKey,
      date: dayLabel(document.dateKey),
      income: 0,
      outcome: 0,
      profit: 0,
      totalDocuments: 0,
      saleDocuments: 0,
      importDocuments: 0,
      exportDocuments: 0,
    };
    point.totalDocuments += 1;
    if (document.kind === 'import') {
      point.importDocuments += 1;
      point.outcome += document.totalAmount;
    } else {
      point.income += document.totalAmount;
      point.profit = document.profit === null || point.profit === null
        ? null
        : point.profit + document.profit;
      if (document.kind === 'sale') point.saleDocuments += 1;
      if (document.kind === 'export') point.exportDocuments += 1;
    }
    dayMap.set(document.dateKey, point);
  });

  return [...dayMap.values()].sort(
    (left, right) => left.dateKey.localeCompare(right.dateKey),
  );
}

export function buildDocumentDistribution(
  documents: ReportDocument[],
): DocumentDistributionItem[] {
  const count = (kind: ReportDocumentKind) => (
    documents.filter((document) => document.kind === kind).length
  );
  return [
    { kind: 'sale', name: 'Bán hàng', value: count('sale') },
    { kind: 'import', name: 'Nhập kho', value: count('import') },
    { kind: 'export', name: 'Xuất kho', value: count('export') },
  ];
}

export function buildFinancialReport({
  imports,
  exports,
  sales,
  startTime,
  endTime,
}: ReportDataInput): ReportSummary {
  const uniqueImports = activeUnique(imports, 'import');
  const uniqueExports = activeUnique(exports, 'export');
  const uniqueSales = activeUnique(sales, 'sale');
  const allRecords = [...uniqueImports, ...uniqueExports, ...uniqueSales];
  const invalidTimeRecords = allRecords.filter(
    (record) => resolveRecordTimestamp(record as unknown as Record<string, unknown>) === 0,
  ).length;

  const filteredImports = uniqueImports.filter((record) => inRange(record, startTime, endTime));
  const filteredExports = uniqueExports.filter((record) => inRange(record, startTime, endTime));
  const filteredSales = uniqueSales.filter((record) => inRange(record, startTime, endTime));
  const documents = [
    ...filteredSales.map((ticket) => buildDocument(ticket, 'sale')),
    ...filteredImports.map((ticket) => buildDocument(ticket, 'import')),
    ...filteredExports.map((ticket) => buildDocument(ticket, 'export')),
  ].sort((left, right) => left.timestamp - right.timestamp);
  const dailyRows = buildDailyReportRows(documents);
  const products = new Map<string, { name: string; quantity: number }>();
  [...filteredExports, ...filteredSales].forEach((ticket) => addProducts(products, ticket));

  const totalIncome = documents
    .filter((document) => document.kind !== 'import')
    .reduce((sum, document) => sum + document.totalAmount, 0);
  const totalOutcome = documents
    .filter((document) => document.kind === 'import')
    .reduce((sum, document) => sum + document.totalAmount, 0);
  const grossProfit = documents
    .filter((document) => document.kind !== 'import' && document.profit !== null)
    .reduce((sum, document) => sum + (document.profit ?? 0), 0);
  const missingCostSnapshots = documents.filter(
    (document) => document.kind !== 'import' && document.costTotal === null,
  ).length;

  return {
    totalIncome,
    totalOutcome,
    grossProfit,
    totalOrders: documents.length,
    totalImportQty: filteredImports.reduce(
      (sum, ticket) => sum + totalTicketQuantity(ticket),
      0,
    ),
    totalExportQty: [...filteredExports, ...filteredSales].reduce(
      (sum, ticket) => sum + totalTicketQuantity(ticket),
      0,
    ),
    missingCostSnapshots,
    invalidTimeRecords,
    chartData: dailyRows,
    dailyRows,
    documents,
    documentDistribution: buildDocumentDistribution(documents),
    highestIncomeDay: dailyRows.filter((point) => point.income > 0).reduce<ReportChartPoint | undefined>(
      (best, point) => !best || point.income > best.income ? point : best,
      undefined,
    ),
    highestOutcomeDay: dailyRows.filter((point) => point.outcome > 0).reduce<ReportChartPoint | undefined>(
      (best, point) => !best || point.outcome > best.outcome ? point : best,
      undefined,
    ),
    topProduct: [...products.values()].sort(
      (left, right) => right.quantity - left.quantity,
    )[0],
  };
}

// Tên cũ được giữ để tránh làm ảnh hưởng các nơi/tests đang dùng service báo cáo.
export const buildReportSummary = buildFinancialReport;
