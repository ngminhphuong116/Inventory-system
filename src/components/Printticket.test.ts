import { describe, expect, it } from "vitest";
import {
  buildTicketHtml,
  COMPANY_LEGAL_NAME,
  resolveTicketPresentation,
} from "./Printticket";

describe("print ticket presentation", () => {
  it("has no default company legal name", () => {
    expect(COMPANY_LEGAL_NAME).toBe("");
  });

  it("keeps the import form specific to suppliers", () => {
    expect(resolveTicketPresentation({ type: "Nhập kho", supplier: "Nhà cung cấp A" }))
      .toMatchObject({
        titlePage: "PHIẾU NHẬP KHO HÀNG HÓA",
        partnerLabel: "Nhà cung cấp / Đối tác:",
        partnerValue: "Nhà cung cấp A",
        reasonLabel: "Lý do nhập kho:",
        priceLabel: "Giá nhập",
        recipientSignatureTitle: "Người giao hàng / Nhà cung cấp",
      });
  });

  it("keeps the export form specific to recipients", () => {
    expect(resolveTicketPresentation({ type: "Xuất kho", customer: "Khách hàng B" }))
      .toMatchObject({
        titlePage: "PHIẾU XUẤT KHO HÀNG HÓA",
        partnerLabel: "Khách hàng / Đơn vị nhận:",
        partnerValue: "Khách hàng B",
        reasonLabel: "Lý do xuất kho:",
        priceLabel: "Giá bán",
        recipientSignatureTitle: "Người nhận hàng / Khách hàng",
      });
  });

  it("renders import receipts with the shared A4 preview and PDF toolbar", () => {
    const html = buildTicketHtml({
      type: "Nhập kho",
      invoiceNo: "HDN-001",
      date: "2026-08-02 10:30",
      supplier: "Nhà cung cấp A",
      productId: "SP-01",
      productName: "Sản phẩm nhập",
      quantity: 2,
      importPrice: 1_000_000,
      salePrice: 9_000_000,
      totalAmount: 2_000_000,
    });

    expect(html).toContain("Xem trước phiếu nhập kho");
    expect(html).toContain("PHIẾU NHẬP KHO HÀNG HÓA");
    expect(html).toContain('size: A4 portrait');
    expect(html).toContain('font-family: "Times New Roman", Times, serif');
    expect(html).toContain('id="save-pdf-button"');
    expect(html).toContain('window.electronAPI.printReceiptPreview()');
    expect(html).toContain("2.000.000 ₫");
    expect(html).toContain("1.000.000 ₫");
    expect(html).not.toContain("9.000.000 ₫");
  });

  it("keeps export-specific partner and signature content in the shared layout", () => {
    const html = buildTicketHtml({
      type: "Xuất kho",
      invoiceNo: "HDX-001",
      customer: "Khách hàng B",
      productName: "Sản phẩm xuất",
      quantity: 1,
      salePrice: 500_000,
      totalAmount: 500_000,
    });

    expect(html).toContain("Xem trước phiếu xuất kho");
    expect(html).toContain("Khách hàng / Đơn vị nhận");
    expect(html).toContain("Người nhận hàng / Khách hàng");
    expect(html).toContain("500.000 ₫");
  });

  it('prints import and export snapshot unit prices before legacy aliases', () => {
    const importHtml = buildTicketHtml({
      type: 'Nhập kho',
      quantity: 2,
      unitPrice: 45_000,
      importPrice: 50_000,
      totalAmount: 90_000,
    });
    const exportHtml = buildTicketHtml({
      type: 'Xuất kho',
      quantity: 2,
      unitPrice: 65_000,
      salePrice: 70_000,
      totalAmount: 130_000,
    });

    expect(importHtml).toContain('45.000 ₫');
    expect(importHtml).not.toContain('50.000 ₫');
    expect(exportHtml).toContain('65.000 ₫');
    expect(exportHtml).not.toContain('70.000 ₫');
  });
});
