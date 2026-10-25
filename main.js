// ✅ Đổi sang import (ESM) vì package.json có "type": "module"
import { app, BrowserWindow, shell, ipcMain, Menu, dialog } from 'electron';
import { readFile, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join, isAbsolute } from 'path';

// __dirname không tồn tại trong ESM, phải tự tạo
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Optional isolated profile for acceptance tests; default profile stays unchanged.
if (process.env.INVENTORY_USER_DATA_DIR) {
  if (!isAbsolute(process.env.INVENTORY_USER_DATA_DIR)) {
    throw new Error('INVENTORY_USER_DATA_DIR phải là đường dẫn tuyệt đối.');
  }
  app.setPath('userData', process.env.INVENTORY_USER_DATA_DIR);
}
const salesReceiptPreviews = new Map();
const salesReceiptSmokeArg = process.argv.find((arg) => arg.startsWith('sales-receipt-smoke='));

if (salesReceiptSmokeArg) {
  app.commandLine.appendSwitch('disable-gpu');
}

const normalizeReceiptId = (value) => {
  const id = String(value ?? '').trim().slice(0, 160);
  if (!id) throw new Error('Mã phiếu không hợp lệ.');
  return id;
};

const getSalesReceiptWindow = (sender) => {
  for (const previewWindow of salesReceiptPreviews.values()) {
    if (!previewWindow.isDestroyed() && previewWindow.webContents.id === sender.id) {
      return previewWindow;
    }
  }
  throw new Error('Yêu cầu không đến từ cửa sổ xem trước phiếu.');
};

const isCancelledPrint = (reason) =>
  /cancel(?:led|ed)|canceled|hủy/i.test(String(reason || ''));

const sanitizePdfFileName = (value) => {
  const safeName = String(value || 'phieu')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/[.\s]+$/g, '')
    .slice(0, 100);
  return `${safeName || 'phieu'}.pdf`;
};

const sanitizeJsonFileName = (value) => {
  const safeName = String(value || 'inventory-backup.json')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/[.\s]+$/g, '')
    .slice(0, 180);
  return safeName.toLowerCase().endsWith('.json') ? safeName : `${safeName || 'backup'}.json`;
};

async function runSalesReceiptSmoke(configPath) {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  if (
    typeof config.html !== 'string'
    || !config.html.trim()
    || typeof config.screenshotPath !== 'string'
    || typeof config.pdfPath !== 'string'
    || typeof config.resultPath !== 'string'
  ) {
    throw new Error('Cấu hình smoke test phiếu bán hàng không hợp lệ.');
  }

  const smokeWindow = new BrowserWindow({
    title: 'Smoke test xem trước phiếu bán hàng',
    width: 1120,
    height: 900,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: join(__dirname, 'preload.cjs'),
    },
  });
  const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(config.html)}`;
  await smokeWindow.loadURL(dataUrl);

  const screenMetrics = await smokeWindow.webContents.executeJavaScript(`(() => {
    const paper = document.querySelector('.receipt-paper');
    const toolbar = document.querySelector('.receipt-toolbar');
    const paperStyle = getComputedStyle(paper);
    const paperRect = paper.getBoundingClientRect();
    return {
      title: document.title,
      paperFontFamily: paperStyle.fontFamily,
      paperWidthCss: paperStyle.width,
      paperWidthPixels: paperRect.width,
      paperHeightPixels: paperRect.height,
      toolbarDisplay: getComputedStyle(toolbar).display,
      bodyTextHasInvalidValue: /undefined|NaN|Invalid Date/.test(document.body.innerText),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  })()`);

  const screenshot = await smokeWindow.webContents.capturePage();
  await writeFile(config.screenshotPath, screenshot.toPNG());

  smokeWindow.webContents.debugger.attach('1.3');
  await smokeWindow.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { media: 'print' });
  const printMetrics = await smokeWindow.webContents.executeJavaScript(`(() => {
    const paper = document.querySelector('.receipt-paper');
    const toolbar = document.querySelector('.receipt-toolbar');
    const bodyStyle = getComputedStyle(document.body);
    return {
      paperFontFamily: getComputedStyle(paper).fontFamily,
      toolbarDisplay: getComputedStyle(toolbar).display,
      bodyBackground: bodyStyle.backgroundColor,
      bodyOverflow: bodyStyle.overflow,
    };
  })()`);
  await smokeWindow.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { media: 'screen' });
  smokeWindow.webContents.debugger.detach();

  const pdf = await smokeWindow.webContents.printToPDF({
    printBackground: true,
    landscape: false,
    pageSize: 'A4',
    margins: { marginType: 'none' },
    preferCSSPageSize: true,
  });
  await writeFile(config.pdfPath, pdf);
  await writeFile(config.resultPath, JSON.stringify({
    screenMetrics,
    printMetrics,
    screenshotPath: config.screenshotPath,
    pdfPath: config.pdfPath,
  }, null, 2));
  smokeWindow.destroy();
}

function createWindow() {
  const win = new BrowserWindow({
    title: 'Quản Lý Kho Hàng',
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    autoHideMenuBar: true,
    icon: join(__dirname, 'public/favicon.svg'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // ✅ preload để expose API in phiếu an toàn (contextBridge) cho renderer
      preload: join(__dirname, 'preload.cjs'),
    },
    show: false,
  });

  win.setMenuBarVisibility(false);

  // ✅ Load đúng file dist
  win.loadFile(join(__dirname, 'dist/index.html'));

  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ✅ In phiếu trong cửa sổ Electron riêng — không phụ thuộc trình duyệt
// ngoài máy người dùng. Renderer gửi HTML đã dựng sẵn qua IPC, main process
// tạo một BrowserWindow ẩn, load HTML bằng data URL (an toàn vì đây là
// loadURL nội bộ của BrowserWindow, không phải window.open từ renderer nên
// không bị Chromium chặn navigation), rồi hiện ra và mở hộp thoại in.
ipcMain.handle('print-ticket', (event, html) => {
  return new Promise((resolve, reject) => {
    if (typeof html !== 'string' || !html.trim()) {
      reject(new Error('HTML phiếu in trống.'));
      return;
    }

    const printWin = new BrowserWindow({
      title: 'Phiếu kho',
      width: 850,
      height: 1000,
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    printWin.setMenuBarVisibility(false);

    printWin.once('ready-to-show', () => {
      printWin.show();
      resolve(true);
    });

    printWin.on('closed', () => {
      // dọn dẹp tự nhiên khi người dùng bấm "Đóng" trong phiếu
    });

    const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
    printWin.loadURL(dataUrl).catch(reject);
  });
});

ipcMain.handle('open-sales-receipt-preview', async (event, payload) => {
  const receiptId = normalizeReceiptId(payload?.receiptId);
  const html = typeof payload?.html === 'string' ? payload.html : '';
  if (!html.trim() || html.length > 2_000_000) {
    throw new Error('Nội dung xem trước phiếu không hợp lệ.');
  }

  const existingWindow = salesReceiptPreviews.get(receiptId);
  if (existingWindow && !existingWindow.isDestroyed()) {
    if (existingWindow.isMinimized()) existingWindow.restore();
    existingWindow.show();
    existingWindow.focus();
    return { status: 'focused' };
  }

  const ownerWindow = BrowserWindow.fromWebContents(event.sender);
  const previewWindow = new BrowserWindow({
    title: `Xem trước phiếu - ${receiptId}`,
    width: 1120,
    height: 900,
    minWidth: 760,
    minHeight: 600,
    autoHideMenuBar: true,
    show: false,
    icon: join(__dirname, 'public/favicon.svg'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: join(__dirname, 'preload.cjs'),
    },
  });

  salesReceiptPreviews.set(receiptId, previewWindow);
  previewWindow.setMenuBarVisibility(false);
  previewWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  previewWindow.webContents.on('will-navigate', (navigationEvent, url) => {
    if (!url.startsWith('data:text/html;charset=utf-8,')) {
      navigationEvent.preventDefault();
    }
  });
  previewWindow.once('ready-to-show', () => previewWindow.show());
  previewWindow.on('closed', () => {
    if (salesReceiptPreviews.get(receiptId) === previewWindow) {
      salesReceiptPreviews.delete(receiptId);
    }
    if (ownerWindow && !ownerWindow.isDestroyed()) ownerWindow.focus();
  });

  try {
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    await previewWindow.loadURL(dataUrl);
    return { status: 'opened' };
  } catch (error) {
    salesReceiptPreviews.delete(receiptId);
    if (!previewWindow.isDestroyed()) previewWindow.destroy();
    throw error;
  }
});

ipcMain.handle('print-sales-receipt', (event) => {
  const previewWindow = getSalesReceiptWindow(event.sender);
  return new Promise((resolve) => {
    previewWindow.webContents.print({
      silent: false,
      printBackground: true,
      landscape: false,
      margins: { marginType: 'none' },
      pageSize: 'A4',
    }, (success, failureReason) => {
      if (success) {
        resolve({
          status: 'success',
          message: 'Đã gửi phiếu đến máy in.',
        });
        return;
      }

      if (isCancelledPrint(failureReason)) {
        resolve({
          status: 'cancelled',
          message: 'Bạn đã hủy in. Phiếu xem trước vẫn được giữ nguyên.',
        });
        return;
      }

      resolve({
        status: 'error',
        message: `Không thể in phiếu${failureReason ? `: ${failureReason}` : '.'}`,
      });
    });
  });
});

ipcMain.handle('save-sales-receipt-pdf', async (event) => {
  const previewWindow = getSalesReceiptWindow(event.sender);
  const receiptId = [...salesReceiptPreviews.entries()]
    .find(([, candidate]) => candidate === previewWindow)?.[0];
  const saveResult = await dialog.showSaveDialog(previewWindow, {
    title: 'Lưu phiếu dưới dạng PDF',
    defaultPath: join(app.getPath('documents'), sanitizePdfFileName(receiptId)),
    filters: [{ name: 'Tệp PDF', extensions: ['pdf'] }],
    properties: ['showOverwriteConfirmation'],
  });

  if (saveResult.canceled || !saveResult.filePath) {
    return {
      status: 'cancelled',
      message: 'Đã hủy lưu PDF. Phiếu xem trước vẫn được giữ nguyên.',
    };
  }

  try {
    const pdf = await previewWindow.webContents.printToPDF({
      printBackground: true,
      landscape: false,
      pageSize: 'A4',
      margins: { marginType: 'none' },
      preferCSSPageSize: true,
    });
    await writeFile(saveResult.filePath, pdf);
    return {
      status: 'success',
      message: `Đã lưu PDF tại: ${saveResult.filePath}`,
      filePath: saveResult.filePath,
    };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error
        ? `Không thể lưu PDF: ${error.message}`
        : 'Không thể lưu PDF. Vui lòng thử lại.',
    };
  }
});

ipcMain.handle('close-sales-receipt-preview', (event) => {
  const previewWindow = getSalesReceiptWindow(event.sender);
  previewWindow.close();
  return { status: 'closed' };
});

ipcMain.handle('save-backup-file', async (event, payload) => {
  const content = typeof payload?.content === 'string' ? payload.content : '';
  if (!content || Buffer.byteLength(content, 'utf8') > 25 * 1024 * 1024) {
    return { status: 'error', message: 'Nội dung sao lưu trống hoặc vượt quá giới hạn an toàn.' };
  }
  try {
    const parsed = JSON.parse(content);
    if (parsed?.backupFormat !== 'vuong-phat-inventory-backup') {
      return { status: 'error', message: 'Nội dung không phải tệp sao lưu hợp lệ của ứng dụng.' };
    }
  } catch {
    return { status: 'error', message: 'Nội dung sao lưu không phải JSON hợp lệ.' };
  }
  const ownerWindow = BrowserWindow.fromWebContents(event.sender);
  if (!ownerWindow || ownerWindow.isDestroyed()) {
    return { status: 'error', message: 'Không xác định được cửa sổ yêu cầu lưu tệp.' };
  }
  const fileName = sanitizeJsonFileName(payload?.fileName);
  const saveResult = await dialog.showSaveDialog(ownerWindow, {
    title: 'Lưu bản sao dữ liệu kho',
    defaultPath: join(app.getPath('documents'), fileName),
    filters: [{ name: 'Tệp sao lưu JSON', extensions: ['json'] }],
    properties: ['showOverwriteConfirmation'],
  });
  if (saveResult.canceled || !saveResult.filePath) {
    return { status: 'cancelled', message: 'Đã hủy lưu bản sao dữ liệu.' };
  }
  try {
    await writeFile(saveResult.filePath, content, { encoding: 'utf8', flag: 'w' });
    return {
      status: 'success',
      message: `Đã lưu bản sao tại: ${saveResult.filePath}`,
      filePath: saveResult.filePath,
    };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? `Không thể lưu tệp: ${error.message}` : 'Không thể lưu tệp sao lưu.',
    };
  }
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  if (salesReceiptSmokeArg) {
    try {
      const configPath = salesReceiptSmokeArg.slice('sales-receipt-smoke='.length);
      await runSalesReceiptSmoke(configPath);
      app.quit();
    } catch (error) {
      console.error('Smoke test phiếu bán hàng thất bại:', error);
      app.exit(1);
    }
    return;
  }

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
