import type { Cell, Row, Workbook, Worksheet } from 'exceljs';
import type { ReportSummary } from './report-data';

export interface FinancialReportExportInput {
  report: ReportSummary;
  startDate: Date;
  endDate: Date;
}

const MONEY_FORMAT = '#,##0 "₫"';
const DATE_FORMAT = 'dd/mm/yyyy';
const DATE_TIME_FORMAT = 'dd/mm/yyyy hh:mm';
const HEADER_FILL = 'FF2563EB';

function safeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function localDateOnly(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dateKeyToDate(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function vietnamTimestampToDate(timestamp: number) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const values = Object.fromEntries(
    formatter.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]),
  );
  return new Date(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour) % 24,
    Number(values.minute),
    Number(values.second),
  );
}

function styleHeader(row: Row) {
  row.height = 24;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
}

function styleMoneyCell(cell: Cell) {
  cell.numFmt = MONEY_FORMAT;
  cell.alignment = { ...cell.alignment, horizontal: 'right' };
}

function finishSheet(worksheet: Worksheet, columnCount: number) {
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columnCount },
  };
  styleHeader(worksheet.getRow(1));
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.alignment = { vertical: 'top' };
  });
}

function addOverviewSheet(
  workbook: Workbook,
  { report, startDate, endDate }: FinancialReportExportInput,
) {
  const worksheet = workbook.addWorksheet('Tổng quan');
  worksheet.columns = [
    { header: 'Chỉ tiêu', key: 'metric', width: 38 },
    { header: 'Giá trị', key: 'value', width: 32 },
  ];

  const rows: Array<[string, string | number | Date]> = [
    ['Từ ngày', localDateOnly(startDate)],
    ['Đến ngày', localDateOnly(endDate)],
    ['Tổng thu', safeNumber(report.totalIncome)],
    ['Tổng chi', safeNumber(report.totalOutcome)],
    ['Lợi nhuận gộp', safeNumber(report.grossProfit)],
    ['Tổng số chứng từ', safeNumber(report.totalOrders)],
    ['Số chứng từ bán hàng', report.documentDistribution.find((item) => item.kind === 'sale')?.value ?? 0],
    ['Số chứng từ nhập kho', report.documentDistribution.find((item) => item.kind === 'import')?.value ?? 0],
    ['Số chứng từ xuất kho', report.documentDistribution.find((item) => item.kind === 'export')?.value ?? 0],
    ['Số chứng từ thiếu giá vốn', safeNumber(report.missingCostSnapshots)],
    ['Ngày có doanh thu cao nhất', report.highestIncomeDay ? dateKeyToDate(report.highestIncomeDay.dateKey) : ''],
    ['Giá trị doanh thu cao nhất', safeNumber(report.highestIncomeDay?.income)],
    ['Ngày có chi phí cao nhất', report.highestOutcomeDay ? dateKeyToDate(report.highestOutcomeDay.dateKey) : ''],
    ['Giá trị chi phí cao nhất', safeNumber(report.highestOutcomeDay?.outcome)],
    ['Sản phẩm nổi bật', report.topProduct?.name ?? ''],
    ['Tổng số lượng sản phẩm đã bán/xuất', safeNumber(report.totalExportQty)],
  ];
  rows.forEach(([metric, value]) => worksheet.addRow({ metric, value }));

  [2, 3, 12, 14].forEach((rowNumber) => {
    if (worksheet.getCell(rowNumber, 2).value instanceof Date) {
      worksheet.getCell(rowNumber, 2).numFmt = DATE_FORMAT;
    }
  });
  [4, 5, 6, 13, 15].forEach((rowNumber) => styleMoneyCell(worksheet.getCell(rowNumber, 2)));
  finishSheet(worksheet, 2);
}

function addDailySheet(workbook: Workbook, report: ReportSummary) {
  const worksheet = workbook.addWorksheet('Theo ngày');
  worksheet.columns = [
    { header: 'STT', key: 'index', width: 8 },
    { header: 'Ngày', key: 'date', width: 14 },
    { header: 'Tổng thu', key: 'income', width: 20 },
    { header: 'Tổng chi', key: 'outcome', width: 20 },
    { header: 'Lợi nhuận gộp', key: 'profit', width: 20 },
    { header: 'Số chứng từ', key: 'totalDocuments', width: 16 },
    { header: 'Số chứng từ bán hàng', key: 'saleDocuments', width: 22 },
    { header: 'Số chứng từ nhập kho', key: 'importDocuments', width: 22 },
    { header: 'Số chứng từ xuất kho', key: 'exportDocuments', width: 22 },
  ];
  report.dailyRows.forEach((day, index) => {
    worksheet.addRow({
      index: index + 1,
      date: dateKeyToDate(day.dateKey),
      income: safeNumber(day.income),
      outcome: safeNumber(day.outcome),
      profit: day.profit === null ? null : safeNumber(day.profit),
      totalDocuments: safeNumber(day.totalDocuments),
      saleDocuments: safeNumber(day.saleDocuments),
      importDocuments: safeNumber(day.importDocuments),
      exportDocuments: safeNumber(day.exportDocuments),
    });
  });
  worksheet.getColumn('date').numFmt = DATE_FORMAT;
  ['income', 'outcome', 'profit'].forEach((key) => {
    worksheet.getColumn(key).numFmt = MONEY_FORMAT;
    worksheet.getColumn(key).alignment = { horizontal: 'right' };
  });
  finishSheet(worksheet, 9);
}

function addDocumentSheet(workbook: Workbook, report: ReportSummary) {
  const worksheet = workbook.addWorksheet('Chi tiết chứng từ');
  worksheet.columns = [
    { header: 'STT', key: 'index', width: 8 },
    { header: 'Mã chứng từ', key: 'code', width: 20 },
    { header: 'Ngày tạo', key: 'createdAt', width: 20 },
    { header: 'Loại chứng từ', key: 'type', width: 18 },
    { header: 'Trạng thái', key: 'status', width: 16 },
    { header: 'Người tạo', key: 'creator', width: 28 },
    { header: 'Tổng số lượng', key: 'quantity', width: 18 },
    { header: 'Tổng tiền', key: 'totalAmount', width: 20 },
    { header: 'Giá vốn', key: 'costTotal', width: 20 },
    { header: 'Lợi nhuận', key: 'profit', width: 20 },
    { header: 'Ghi chú', key: 'note', width: 36 },
  ];
  report.documents.forEach((document, index) => {
    worksheet.addRow({
      index: index + 1,
      code: document.code,
      createdAt: vietnamTimestampToDate(document.timestamp),
      type: document.typeLabel,
      status: document.statusLabel,
      creator: document.createdBy,
      quantity: safeNumber(document.totalQuantity),
      totalAmount: safeNumber(document.totalAmount),
      costTotal: document.costTotal === null ? null : safeNumber(document.costTotal),
      profit: document.profit === null ? null : safeNumber(document.profit),
      note: document.note,
    });
  });
  worksheet.getColumn('createdAt').numFmt = DATE_TIME_FORMAT;
  ['totalAmount', 'costTotal', 'profit'].forEach((key) => {
    worksheet.getColumn(key).numFmt = MONEY_FORMAT;
    worksheet.getColumn(key).alignment = { horizontal: 'right' };
  });
  worksheet.getColumn('note').alignment = { vertical: 'top', wrapText: true };
  finishSheet(worksheet, 11);
}

function addItemSnapshotSheet(workbook: Workbook, report: ReportSummary) {
  const worksheet = workbook.addWorksheet('Chi tiết mặt hàng');
  worksheet.columns = [
    { header: 'STT', key: 'index', width: 8 },
    { header: 'Mã chứng từ', key: 'code', width: 20 },
    { header: 'Ngày tạo', key: 'createdAt', width: 20 },
    { header: 'Loại chứng từ', key: 'type', width: 18 },
    { header: 'Mã sản phẩm', key: 'productCode', width: 18 },
    { header: 'Tên sản phẩm', key: 'productName', width: 34 },
    { header: 'Số lượng', key: 'quantity', width: 16 },
    { header: 'Đơn giá giao dịch', key: 'unitPrice', width: 22 },
    { header: 'Thành tiền', key: 'subtotal', width: 22 },
    { header: 'Tổng chứng từ', key: 'totalAmount', width: 22 },
  ];

  let index = 0;
  report.documents.forEach((document) => {
    document.items.forEach((item) => {
      index += 1;
      worksheet.addRow({
        index,
        code: document.code,
        createdAt: vietnamTimestampToDate(document.timestamp),
        type: document.typeLabel,
        productCode: item.productCode || item.productId,
        productName: item.productName,
        quantity: safeNumber(item.quantity),
        unitPrice: safeNumber(item.unitPrice),
        subtotal: safeNumber(item.subtotal),
        totalAmount: safeNumber(document.totalAmount),
      });
    });
  });
  worksheet.getColumn('createdAt').numFmt = DATE_TIME_FORMAT;
  ['unitPrice', 'subtotal', 'totalAmount'].forEach((key) => {
    worksheet.getColumn(key).numFmt = MONEY_FORMAT;
    worksheet.getColumn(key).alignment = { horizontal: 'right' };
  });
  finishSheet(worksheet, 10);
}

export async function buildFinancialReportWorkbook(input: FinancialReportExportInput) {
  const { Workbook: ExcelWorkbook } = await import('exceljs');
  const workbook = new ExcelWorkbook();
  workbook.creator = 'Hệ thống quản lý kho';
  workbook.created = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;
  addOverviewSheet(workbook, input);
  addDailySheet(workbook, input.report);
  addDocumentSheet(workbook, input.report);
  addItemSnapshotSheet(workbook, input.report);
  return workbook;
}

export function financialReportFileName(startDate: Date, endDate: Date) {
  const format = (date: Date) => [
    String(date.getDate()).padStart(2, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    date.getFullYear(),
  ].join('-');
  return `Bao_cao_tai_chinh_Tu_${format(startDate)}_Den_${format(endDate)}.xlsx`;
}

export async function exportFinancialReportToExcel(input: FinancialReportExportInput) {
  const workbook = await buildFinancialReportWorkbook(input);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([new Uint8Array(buffer)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = financialReportFileName(input.startDate, input.endDate);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
