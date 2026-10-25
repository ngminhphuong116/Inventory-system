// preload.cjs
// File CommonJS (.cjs) vì package.json có "type": "module" — preload script
// của Electron phải chạy bằng require(), nên không thể dùng đuôi .js (ESM)
// khi contextIsolation: true.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Gửi HTML phiếu in cho main process; main sẽ mở một BrowserWindow ẩn
  // riêng để hiển thị + in, không phụ thuộc trình duyệt ngoài máy.
  printTicket: (html) => ipcRenderer.invoke('print-ticket', html),
  openReceiptPreview: (payload) => ipcRenderer.invoke('open-sales-receipt-preview', payload),
  printReceiptPreview: () => ipcRenderer.invoke('print-sales-receipt'),
  saveReceiptPreviewPdf: () => ipcRenderer.invoke('save-sales-receipt-pdf'),
  closeReceiptPreview: () => ipcRenderer.invoke('close-sales-receipt-preview'),
  // Giữ alias cũ để tương thích với các cửa sổ preview đã mở từ phiên bản trước.
  openSalesReceiptPreview: (payload) => ipcRenderer.invoke('open-sales-receipt-preview', payload),
  printSalesReceipt: () => ipcRenderer.invoke('print-sales-receipt'),
  saveSalesReceiptPdf: () => ipcRenderer.invoke('save-sales-receipt-pdf'),
  closeSalesReceiptPreview: () => ipcRenderer.invoke('close-sales-receipt-preview'),
  saveBackupFile: (payload) => ipcRenderer.invoke('save-backup-file', payload),
});
