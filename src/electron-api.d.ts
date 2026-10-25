// Khai báo kiểu cho API được expose từ preload.cjs (contextBridge),
// để TypeScript không báo lỗi khi truy cập window.electronAPI.
export {};

type ReceiptActionStatus = 'success' | 'cancelled' | 'error';

interface ReceiptActionResult {
  status: ReceiptActionStatus;
  message: string;
  filePath?: string;
}

declare global {
  interface Window {
    electronAPI?: {
      printTicket: (html: string) => Promise<boolean>;
      openReceiptPreview: (payload: {
        receiptId: string;
        html: string;
      }) => Promise<{ status: 'opened' | 'focused' }>;
      printReceiptPreview: () => Promise<ReceiptActionResult>;
      saveReceiptPreviewPdf: () => Promise<ReceiptActionResult>;
      closeReceiptPreview: () => Promise<{ status: 'closed' }>;
      openSalesReceiptPreview: (payload: {
        receiptId: string;
        html: string;
      }) => Promise<{ status: 'opened' | 'focused' }>;
      printSalesReceipt: () => Promise<ReceiptActionResult>;
      saveSalesReceiptPdf: () => Promise<ReceiptActionResult>;
      closeSalesReceiptPreview: () => Promise<{ status: 'closed' }>;
      saveBackupFile: (payload: {
        fileName: string;
        content: string;
      }) => Promise<ReceiptActionResult>;
    };
  }
}
