export const COMPANY_LEGAL_NAME = '';

const EMPTY_VALUE = '—';

export const escapeReceiptHtml = (value: unknown) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

export const safeReceiptText = (value: unknown, fallback = EMPTY_VALUE) => {
  const text = String(value ?? '').trim();
  return text || fallback;
};

export interface ReceiptDocumentItem {
  code: unknown;
  name: unknown;
  unit: unknown;
  quantity: unknown;
  unitPrice: unknown;
  discount?: unknown;
  lineTotal: unknown;
}

export interface ReceiptDocumentMeta {
  label: string;
  value: unknown;
  wide?: boolean;
}

export interface ReceiptDocumentSummary {
  label: string;
  value: unknown;
  total?: boolean;
}

export interface ReceiptDocumentConfig {
  previewTitle: string;
  title: string;
  subtitle: string;
  receiptNo: unknown;
  date: unknown;
  dateLabel?: string;
  ariaLabel: string;
  meta: ReceiptDocumentMeta[];
  items: ReceiptDocumentItem[];
  unitPriceLabel: string;
  discountLabel?: string;
  summary: ReceiptDocumentSummary[];
  note?: unknown;
  leftSignature: string;
  rightSignature: string;
}

const RECEIPT_PREVIEW_STYLES = `
    :root { color-scheme: light; font-synthesis: none; }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; }
    body { overflow: hidden; color: #111827; background: #e8ebef; }
    button { font: inherit; }

    .receipt-preview-shell {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      height: 100vh;
      background: #e8ebef;
    }

    .receipt-toolbar {
      z-index: 10;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      min-height: 64px;
      padding: 12px 24px;
      color: #f8fafc;
      background: #151f32;
      box-shadow: 0 2px 12px rgba(15, 23, 42, 0.22);
      font-family: "Segoe UI", Arial, sans-serif;
    }

    .receipt-toolbar__heading { min-width: 0; }
    .receipt-toolbar__title { margin: 0; font-size: 17px; font-weight: 650; line-height: 1.35; }
    .receipt-toolbar__meta { margin: 2px 0 0; color: #cbd5e1; font-size: 12px; line-height: 1.4; }
    .receipt-toolbar__actions { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; }

    .receipt-toolbar__button {
      min-height: 38px;
      padding: 8px 14px;
      border: 1px solid rgba(255, 255, 255, 0.26);
      border-radius: 7px;
      color: #f8fafc;
      background: transparent;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      transition: background-color 120ms ease-out, border-color 120ms ease-out;
    }

    .receipt-toolbar__button:hover:not(:disabled) { background: rgba(255, 255, 255, 0.1); border-color: rgba(255, 255, 255, 0.48); }
    .receipt-toolbar__button:focus-visible { outline: 3px solid #93c5fd; outline-offset: 2px; }
    .receipt-toolbar__button:disabled { cursor: wait; opacity: 0.6; }
    .receipt-toolbar__button--primary { color: #0f172a; border-color: #ffffff; background: #ffffff; }
    .receipt-toolbar__button--primary:hover:not(:disabled) { border-color: #dbeafe; background: #dbeafe; }

    .receipt-preview-scroll { min-height: 0; overflow: auto; padding: 28px; scrollbar-gutter: stable; }
    .receipt-paper {
      width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      padding: 14mm;
      overflow: visible;
      color: #000000;
      background: #ffffff;
      box-shadow: 0 10px 30px rgba(15, 23, 42, 0.18);
      font-family: "Times New Roman", Times, serif;
      font-size: 12pt;
      line-height: 1.35;
    }
    .receipt-paper, .receipt-paper * { font-family: "Times New Roman", Times, serif; }

    .receipt-header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12mm;
      padding-bottom: 6mm;
      border-bottom: 1px solid #111111;
    }
    .receipt-header__line, .receipt-header__code { margin: 1mm 0; font-size: 10.5pt; }
    .receipt-header__code { text-align: right; white-space: nowrap; }

    .receipt-title { margin: 8mm 0 6mm; text-align: center; }
    .receipt-title h1 { margin: 0 0 2mm; font-size: 20pt; line-height: 1.2; }
    .receipt-title p { margin: 0; font-size: 10.5pt; font-style: italic; }

    .receipt-meta {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 2mm 10mm;
      margin-bottom: 6mm;
      font-size: 11pt;
    }
    .receipt-meta__wide { grid-column: 1 / -1; }

    .receipt-table { width: 100%; margin: 0; border-collapse: collapse; table-layout: fixed; font-size: 9.5pt; }
    .receipt-table thead { display: table-header-group; }
    .receipt-table tr { break-inside: avoid; page-break-inside: avoid; }
    .receipt-table th, .receipt-table td {
      padding: 2.2mm 1.5mm;
      border: 1px solid #222222;
      vertical-align: middle;
      overflow-wrap: anywhere;
    }
    .receipt-table th { text-align: center; font-weight: 700; background: #f2f2f2; }
    .receipt-table th:nth-child(1) { width: 6%; }
    .receipt-table th:nth-child(2) { width: 13%; }
    .receipt-table th:nth-child(3) { width: 29%; }
    .receipt-table th:nth-child(4) { width: 9%; }
    .receipt-table th:nth-child(5) { width: 10%; }
    .receipt-table th:nth-child(6) { width: 15%; }
    .receipt-table th:nth-child(7) { width: 18%; }
    .receipt-table--discount th:nth-child(1) { width: 5%; }
    .receipt-table--discount th:nth-child(2) { width: 12%; }
    .receipt-table--discount th:nth-child(3) { width: 25%; }
    .receipt-table--discount th:nth-child(4) { width: 8%; }
    .receipt-table--discount th:nth-child(5) { width: 9%; }
    .receipt-table--discount th:nth-child(6) { width: 14%; }
    .receipt-table--discount th:nth-child(7) { width: 14%; }
    .receipt-table--discount th:nth-child(8) { width: 13%; }
    .receipt-table__index, .receipt-table__unit { text-align: center; }
    .receipt-table__number { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .receipt-table__product { font-weight: 600; }

    .receipt-summary {
      width: 92mm;
      margin: 6mm 0 0 auto;
      break-inside: avoid;
      page-break-inside: avoid;
      font-size: 11pt;
    }
    .receipt-summary__row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8mm; padding: 1.5mm 0; }
    .receipt-summary__value { min-width: 34mm; text-align: right; font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .receipt-summary__total { margin-top: 1.5mm; padding-top: 3mm; border-top: 1.5px solid #000000; font-size: 13pt; font-weight: 700; }
    .receipt-note { min-height: 9mm; margin-top: 6mm; font-size: 10.5pt; }

    .receipt-footer {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 20mm;
      margin-top: 10mm;
      break-inside: avoid;
      page-break-inside: avoid;
      text-align: center;
      font-size: 11pt;
    }
    .receipt-footer__signature { min-height: 28mm; }
    .receipt-footer__hint { display: block; margin-top: 1mm; font-size: 9.5pt; font-style: italic; font-weight: 400; }

    .receipt-status {
      position: fixed;
      right: 20px;
      bottom: 20px;
      z-index: 20;
      max-width: min(420px, calc(100vw - 40px));
      padding: 10px 14px;
      border-radius: 7px;
      color: #ffffff;
      background: #151f32;
      box-shadow: 0 6px 20px rgba(15, 23, 42, 0.24);
      font-family: "Segoe UI", Arial, sans-serif;
      font-size: 13px;
    }
    .receipt-status[hidden] { display: none; }

    @page { size: A4 portrait; margin: 0; }
    @media (max-width: 820px) {
      .receipt-toolbar { align-items: flex-start; flex-direction: column; gap: 10px; }
      .receipt-toolbar__actions { width: 100%; flex-wrap: wrap; }
      .receipt-preview-scroll { padding: 16px; }
    }
    @media print {
      html, body {
        width: 210mm;
        height: auto;
        overflow: visible;
        color: #000000;
        background: #ffffff;
        font-family: "Times New Roman", Times, serif;
      }
      .receipt-preview-shell { display: block; height: auto; background: #ffffff; }
      .receipt-toolbar, .receipt-status, .no-print { display: none !important; }
      .receipt-preview-scroll { overflow: visible; padding: 0; background: #ffffff; }
      .receipt-paper { width: 210mm; min-height: 0; margin: 0; padding: 14mm; border: 0; box-shadow: none; color: #000000; animation: none !important; }
      .receipt-paper, .receipt-paper * { font-family: "Times New Roman", Times, serif !important; animation: none !important; transition: none !important; }
    }
`;

export function buildReceiptDocumentHtml(config: ReceiptDocumentConfig): string {
  const nonce = `receipt-${Date.now().toString(36)}`;
  const receiptNo = safeReceiptText(config.receiptNo);
  const rows = config.items.map((item, index) => `
          <tr>
            <td class="receipt-table__index">${index + 1}</td>
            <td>${escapeReceiptHtml(safeReceiptText(item.code))}</td>
            <td class="receipt-table__product">${escapeReceiptHtml(safeReceiptText(item.name))}</td>
            <td class="receipt-table__unit">${escapeReceiptHtml(safeReceiptText(item.unit))}</td>
            <td class="receipt-table__number">${escapeReceiptHtml(safeReceiptText(item.quantity, '0'))}</td>
            <td class="receipt-table__number">${escapeReceiptHtml(safeReceiptText(item.unitPrice, '0 ₫'))}</td>
            ${config.discountLabel ? `<td class="receipt-table__number">${escapeReceiptHtml(safeReceiptText(item.discount, '0 ₫'))}</td>` : ''}
            <td class="receipt-table__number">${escapeReceiptHtml(safeReceiptText(item.lineTotal, '0 ₫'))}</td>
          </tr>`).join('');
  const meta = config.meta.map((item) => {
    const label = item.label.trim().replace(/:+$/u, '');
    return `
          <div${item.wide ? ' class="receipt-meta__wide"' : ''}><strong>${escapeReceiptHtml(label)}:</strong> ${escapeReceiptHtml(safeReceiptText(item.value))}</div>`;
  }).join('');
  const summary = config.summary.map((item) => `
          <div class="receipt-summary__row${item.total ? ' receipt-summary__total' : ''}">
            <span>${escapeReceiptHtml(item.label)}</span>
            <span class="receipt-summary__value">${escapeReceiptHtml(safeReceiptText(item.value, '0'))}</span>
          </div>`).join('');

  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>${escapeReceiptHtml(config.previewTitle)} ${escapeReceiptHtml(receiptNo)}</title>
  <style>${RECEIPT_PREVIEW_STYLES}</style>
</head>
<body>
  <div class="receipt-preview-shell">
    <header class="receipt-toolbar no-print">
      <div class="receipt-toolbar__heading">
        <h2 class="receipt-toolbar__title">${escapeReceiptHtml(config.previewTitle)}</h2>
        <p class="receipt-toolbar__meta">Khổ A4 dọc · Phiếu ${escapeReceiptHtml(receiptNo)}</p>
      </div>
      <div class="receipt-toolbar__actions">
        <button class="receipt-toolbar__button" id="save-pdf-button" type="button">Lưu PDF</button>
        <button class="receipt-toolbar__button receipt-toolbar__button--primary" id="print-button" type="button">In phiếu</button>
        <button class="receipt-toolbar__button" id="close-button" type="button">Đóng</button>
      </div>
    </header>

    <div class="receipt-preview-scroll">
      <main class="receipt-paper" aria-label="${escapeReceiptHtml(config.ariaLabel)}">
        <section class="receipt-header">
          <div>
          </div>
          <div>
            <p class="receipt-header__code"><strong>Mã phiếu:</strong> ${escapeReceiptHtml(receiptNo)}</p>
            <p class="receipt-header__code"><strong>${escapeReceiptHtml(config.dateLabel || 'Ngày giờ')}:</strong> ${escapeReceiptHtml(safeReceiptText(config.date))}</p>
          </div>
        </section>

        <section class="receipt-title">
          <h1>${escapeReceiptHtml(config.title)}</h1>
          <p>${escapeReceiptHtml(config.subtitle)}</p>
        </section>

        <section class="receipt-meta">${meta}
        </section>

        <table class="receipt-table${config.discountLabel ? ' receipt-table--discount' : ''}">
          <thead>
            <tr>
              <th>STT</th>
              <th>Mã hàng</th>
              <th>Tên sản phẩm</th>
              <th>Đơn vị</th>
              <th>Số lượng</th>
              <th>${escapeReceiptHtml(config.unitPriceLabel)}</th>
              ${config.discountLabel ? `<th>${escapeReceiptHtml(config.discountLabel)}</th>` : ''}
              <th>Thành tiền</th>
            </tr>
          </thead>
          <tbody>${rows}
          </tbody>
        </table>

        <section class="receipt-summary">${summary}
        </section>

        <section class="receipt-note"><strong>Ghi chú:</strong> ${escapeReceiptHtml(safeReceiptText(config.note))}</section>

        <footer class="receipt-footer">
          <div>
            <strong>${escapeReceiptHtml(config.leftSignature)}</strong>
            <span class="receipt-footer__hint">(Ký, ghi rõ họ tên)</span>
            <div class="receipt-footer__signature"></div>
          </div>
          <div>
            <strong>${escapeReceiptHtml(config.rightSignature)}</strong>
            <span class="receipt-footer__hint">(Ký, ghi rõ họ tên)</span>
            <div class="receipt-footer__signature"></div>
          </div>
        </footer>
      </main>
    </div>
  </div>

  <div class="receipt-status no-print" id="receipt-status" role="status" aria-live="polite" hidden></div>

  <script nonce="${nonce}">
    (() => {
      const printButton = document.getElementById('print-button');
      const savePdfButton = document.getElementById('save-pdf-button');
      const closeButton = document.getElementById('close-button');
      const status = document.getElementById('receipt-status');
      const showStatus = (message) => { status.textContent = message; status.hidden = false; };
      const setBusy = (button, busy, busyText, normalText) => {
        button.disabled = busy;
        button.textContent = busy ? busyText : normalText;
      };

      printButton.addEventListener('click', async () => {
        if (!window.electronAPI?.printReceiptPreview) { window.print(); return; }
        setBusy(printButton, true, 'Đang mở hộp thoại…', 'In phiếu');
        try {
          const result = await window.electronAPI.printReceiptPreview();
          showStatus(result.message);
        } catch {
          showStatus('Không thể mở hộp thoại in. Vui lòng thử lại.');
        } finally {
          setBusy(printButton, false, 'Đang mở hộp thoại…', 'In phiếu');
        }
      });

      savePdfButton.addEventListener('click', async () => {
        if (!window.electronAPI?.saveReceiptPreviewPdf) {
          showStatus('Tính năng lưu PDF chỉ khả dụng trong ứng dụng.');
          return;
        }
        setBusy(savePdfButton, true, 'Đang lưu…', 'Lưu PDF');
        try {
          const result = await window.electronAPI.saveReceiptPreviewPdf();
          showStatus(result.message);
        } catch {
          showStatus('Không thể lưu PDF. Vui lòng thử lại.');
        } finally {
          setBusy(savePdfButton, false, 'Đang lưu…', 'Lưu PDF');
        }
      });

      closeButton.addEventListener('click', () => {
        if (window.electronAPI?.closeReceiptPreview) {
          window.electronAPI.closeReceiptPreview();
          return;
        }
        window.close();
      });
    })();
  </script>
</body>
</html>`;
}

export async function openReceiptDocumentPreview(receiptId: string, html: string): Promise<void> {
  const electronAPI = window.electronAPI;
  if (electronAPI?.openReceiptPreview) {
    await electronAPI.openReceiptPreview({ receiptId, html });
    return;
  }

  const previewWindow = window.open('', '_blank');
  if (!previewWindow) throw new Error('Trình duyệt đã chặn cửa sổ xem trước phiếu.');
  previewWindow.document.open();
  previewWindow.document.write(html);
  previewWindow.document.close();
}
