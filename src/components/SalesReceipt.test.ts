import { describe, expect, it } from 'vitest';
import { buildSalesReceiptHtml } from './SalesReceipt';

describe('sales receipt preview', () => {
  it('prints the immutable unitPrice snapshot after the catalog price changes', () => {
    const html = buildSalesReceiptHtml({
      invoiceNo: 'BL-SNAPSHOT',
      quantity: 100,
      unitPrice: 8_000,
      salePrice: 12_000,
      subtotal: 800_000,
      totalAmount: 800_000,
      items: [{
        productName: 'Sản phẩm bán sỉ',
        quantity: 100,
        unitPrice: 8_000,
        salePrice: 12_000,
        subtotal: 800_000,
      }],
    });

    expect(html).toContain('8.000 ₫');
    expect(html).toContain('800.000 ₫');
    expect(html).not.toContain('12.000 ₫');
  });

  it('renders a safe one-item A4 receipt with Times New Roman', () => {
    const html = buildSalesReceiptHtml({
      invoiceNo: 'BL-001',
      date: '2026-07-26 14:05',
      customerName: '',
      createdBy: 'Nhân viên A',
      productId: 'SP-01',
      productName: '<script>alert("x")</script>',
      quantity: 1,
      salePrice: 20_000_000,
      totalAmount: 20_000_000,
      discountAmount: 0,
    });

    expect(html).toContain('Xem trước phiếu bán hàng');
    expect(html).toContain('PHIẾU BÁN HÀNG');
    expect(html).toContain('26/07/2026 14:05');
    expect(html).toContain('20.000.000 ₫');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert("x")</script>');
    expect(html).toContain('font-family: "Times New Roman", Times, serif');
    expect(html).toContain('size: A4 portrait');
    expect(html).toContain('.receipt-toolbar,');
    expect(html).toContain('display: none !important');
    expect(html).not.toContain('Giảm giá (');
  });

  it('renders multiple items, long names, and totals over one billion', () => {
    const html = buildSalesReceiptHtml({
      invoiceNo: 'BL-LARGE',
      customerName: 'Công ty khách hàng',
      subtotal: 1_500_000_000,
      discountAmount: 100_000_000,
      totalAmount: 1_400_000_000,
      voucherUsed: 'VIP100',
      items: [
        {
          productCode: 'SP-01',
          productName: 'Tên sản phẩm rất dài dùng để kiểm tra việc tự động xuống dòng trong bảng phiếu bán hàng',
          unit: 'Bộ',
          quantity: 2,
          salePrice: 500_000_000,
          lineTotal: 1_000_000_000,
        },
        {
          productCode: 'SP-02',
          productName: 'Sản phẩm thứ hai',
          unit: 'Cái',
          quantity: 1,
          salePrice: 500_000_000,
          lineTotal: 500_000_000,
        },
      ],
    });

    expect(html).toContain('SP-01');
    expect(html).toContain('SP-02');
    expect(html).toContain('VIP100');
    expect(html).toContain('1.500.000.000 ₫');
    expect(html).toContain('1.400.000.000 ₫');
    expect(html).toContain('break-inside: avoid');
  });

  it('never exposes missing or invalid business values as undefined, NaN, or Invalid Date', () => {
    const html = buildSalesReceiptHtml({
      invoiceNo: undefined,
      date: '2026-99-99 99:99',
      customerName: undefined,
      createdBy: null as unknown as string,
      productName: undefined,
      quantity: Number.NaN,
      salePrice: Number.NaN,
      totalAmount: Number.NaN,
    });

    expect(html).not.toContain('undefined');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('Invalid Date');
    expect(html).toContain('—');
    expect(html).toContain('0 ₫');
  });

  it('keeps print and close as separate user actions', () => {
    const html = buildSalesReceiptHtml({ invoiceNo: 'BL-ACTIONS' });

    expect(html).toContain('id="print-button"');
    expect(html).toContain('id="close-button"');
    expect(html).toContain("window.electronAPI.printReceiptPreview()");
    expect(html).toContain('window.electronAPI.saveReceiptPreviewPdf()');
    expect(html).toContain('window.electronAPI.closeReceiptPreview()');
    expect(html).not.toContain('window.print()</script>');
  });
});
