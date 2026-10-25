import { describe, expect, it } from 'vitest';
import type {
  ExportTicketType,
  ImportTicketType,
  SalesTicketType,
} from '../../components/Db';
import { buildFinancialReport } from './report-data';
import {
  buildFinancialReportWorkbook,
  financialReportFileName,
} from './report-excel';

const startDate = new Date(2026, 6, 1, 0, 0, 0, 0);
const endDate = new Date(2026, 6, 31, 23, 59, 59, 999);

const report = buildFinancialReport({
  imports: [{
    key: 'import-1',
    date: '2026-07-05 09:00',
    supplier: 'Nhà cung cấp',
    productName: 'Máy in',
    productId: 'p-1',
    quantity: 2,
    importPrice: 100,
    totalAmount: 200,
    invoiceNo: 'PN-1',
    status: 'active',
    createdBy: 'admin@example.com',
  } satisfies ImportTicketType],
  exports: [{
    key: 'export-1',
    date: '2026-07-06 10:00',
    customer: 'Khách hàng',
    productName: 'Máy in',
    productId: 'p-1',
    quantity: 1,
    salePrice: 180,
    totalAmount: 180,
    invoiceNo: 'PX-1',
    status: 'active',
  } satisfies ExportTicketType],
  sales: [{
    key: 'sale-1',
    date: '2026-07-07 11:00',
    customerName: 'Khách lẻ',
    productName: 'Giấy in',
    productId: 'p-2',
    quantity: 3,
    unitPrice: 50,
    salePrice: 12_000,
    totalAmount: 150,
    costTotal: 90,
    invoiceNo: 'BH-1',
    type: 'sale',
    status: 'active',
  } satisfies SalesTicketType],
  startTime: startDate.getTime(),
  endTime: endDate.getTime(),
});

describe('financial report Excel workbook', () => {
  it('uses the required filename pattern', () => {
    expect(financialReportFileName(startDate, endDate))
      .toBe('Bao_cao_tai_chinh_Tu_01-07-2026_Den_31-07-2026.xlsx');
  });

  it('creates four readable, formatted sheets from the same report source', async () => {
    const workbook = await buildFinancialReportWorkbook({ report, startDate, endDate });
    const buffer = await workbook.xlsx.writeBuffer();
    const { Workbook } = await import('exceljs');
    const reopened = new Workbook();
    await reopened.xlsx.load(buffer);

    expect(reopened.worksheets.map((sheet) => sheet.name)).toEqual([
      'Tổng quan',
      'Theo ngày',
      'Chi tiết chứng từ',
      'Chi tiết mặt hàng',
    ]);

    const overview = reopened.getWorksheet('Tổng quan');
    const daily = reopened.getWorksheet('Theo ngày');
    const details = reopened.getWorksheet('Chi tiết chứng từ');
    const itemDetails = reopened.getWorksheet('Chi tiết mặt hàng');
    expect(overview?.getCell('B4').value).toBe(report.totalIncome);
    expect(daily?.getCell('D2').value).toBe(200);
    expect(details?.rowCount).toBe(report.documents.length + 1);
    expect(details?.getCell('H2').value).toBeTypeOf('number');
    expect(details?.getCell('I3').value).toBeNull();
    expect(details?.getCell('A1').font.bold).toBe(true);
    expect(details?.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(details?.autoFilter).toBe('A1:K1');
    expect(details?.getColumn(8).numFmt).toContain('₫');
    expect(itemDetails?.rowCount).toBe(4);
    expect(itemDetails?.getColumn(8).numFmt).toContain('₫');
    expect(itemDetails?.getColumn(8).values).toEqual(expect.arrayContaining([100, 180, 50]));
  });
});
