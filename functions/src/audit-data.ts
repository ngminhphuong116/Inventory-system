import { initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFile, writeFile } from 'node:fs/promises';

type Severity = 'P0' | 'P1' | 'P2' | 'P3';
type Finding = {
  severity: Severity;
  code: string;
  path: string;
  message: string;
};

type RecordMap = Record<string, Record<string, unknown>>;

function markdownEscape(value: unknown): string {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

async function main() {
  const databaseURL = process.env.FIREBASE_DATABASE_URL;
  const input = process.env.AUDIT_INPUT;
  if (!databaseURL && !input) {
    throw new Error('Thiếu AUDIT_INPUT hoặc FIREBASE_DATABASE_URL. Script không tự suy đoán project.');
  }

  let root: Record<string, unknown> | null;
  if (input) {
    root = JSON.parse(await readFile(input, 'utf8')) as Record<string, unknown>;
  } else {
    initializeApp({ databaseURL });
    root = (await getDatabase().ref().get()).val() as Record<string, unknown> | null;
  }
  const data = root || {};
  const products = (data.products || {}) as RecordMap;
  const users = (data.users || {}) as RecordMap;
  const ticketPaths = ['importTickets', 'exportTickets', 'salesTickets'] as const;
  const findings: Finding[] = [];
  const operationOwners = new Map<string, string>();
  const metrics = {
    products: Object.keys(products).length,
    importTickets: 0,
    exportTickets: 0,
    salesTickets: 0,
    cancelledTickets: 0,
    negativeStockProducts: 0,
    missingItemsTickets: 0,
    orphanItemRows: 0,
  };

  const add = (severity: Severity, code: string, path: string, message: string) => {
    findings.push({ severity, code, path, message });
  };

  for (const [id, product] of Object.entries(products)) {
    const quantity = Number(product.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 0) {
      add('P0', 'INVALID_STOCK', `products/${id}`, `Tồn kho không hợp lệ: ${String(product.quantity)}`);
      if (quantity < 0) metrics.negativeStockProducts += 1;
    }
    if (
      product.status !== undefined
      && !['Critical', 'Low', 'Normal'].includes(String(product.status))
    ) {
      add('P2', 'INVALID_PRODUCT_STATUS', `products/${id}`, `Trạng thái sản phẩm không hợp lệ: ${String(product.status)}`);
    }
  }

  for (const ticketPath of ticketPaths) {
    const tickets = (data[ticketPath] || {}) as RecordMap;
    metrics[ticketPath] = Object.keys(tickets).length;
    const invoiceOwners = new Map<string, string>();

    for (const [key, ticket] of Object.entries(tickets)) {
      const path = `${ticketPath}/${key}`;
      const invoiceNo = String(ticket.invoiceNo || '').trim().toUpperCase();
      const operationId = String(ticket.operationId || '');
      const items = Array.isArray(ticket.items)
        ? ticket.items as Array<Record<string, unknown>>
        : [];

      if (!items.length) {
        add('P1', 'MISSING_ITEMS', path, 'Phiếu không có danh sách items.');
        metrics.missingItemsTickets += 1;
      }
      if (ticket.status === 'cancelled') metrics.cancelledTickets += 1;
      if (ticket.status !== undefined && !['active', 'cancelled'].includes(String(ticket.status))) {
        add('P2', 'INVALID_TICKET_STATUS', path, `Trạng thái chứng từ không hợp lệ: ${String(ticket.status)}`);
      }
      if (!operationId) add('P1', 'MISSING_OPERATION_ID', path, 'Phiếu thiếu operationId.');
      if (!Number.isFinite(Number(ticket.createdAt))) {
        add('P2', 'MISSING_SERVER_TIMESTAMP', path, 'Phiếu thiếu createdAt dạng server timestamp.');
      }
      if (!ticket.companyId) add('P2', 'MISSING_COMPANY', path, 'Schema hiện tại chưa có companyId.');
      if (!ticket.branchId) add('P2', 'MISSING_BRANCH', path, 'Schema hiện tại chưa có branchId.');
      if (ticketPath === 'salesTickets' && !Number.isFinite(Number(ticket.costTotal))) {
        add('P1', 'MISSING_COST_SNAPSHOT', path, 'Phiếu bán thiếu costTotal snapshot.');
      }

      if (invoiceNo) {
        const prior = invoiceOwners.get(invoiceNo);
        if (prior) add('P1', 'DUPLICATE_INVOICE', path, `Trùng mã phiếu với ${prior}.`);
        else invoiceOwners.set(invoiceNo, path);
      }
      if (operationId) {
        const prior = operationOwners.get(operationId);
        if (prior) add('P0', 'DUPLICATE_OPERATION', path, `Trùng operationId với ${prior}.`);
        else operationOwners.set(operationId, path);
      }

      let computedTotal = 0;
      for (const [index, item] of items.entries()) {
        const productId = String(item.productId || '');
        if (!products[productId]) {
          add('P1', 'ORPHAN_PRODUCT', `${path}/items/${index}`, `Không tìm thấy products/${productId}.`);
          metrics.orphanItemRows += 1;
        }
        const unitPrice = Number(item.unitPrice);
        if (!Number.isFinite(unitPrice) || unitPrice < 0) {
          add('P1', 'MISSING_UNIT_PRICE', `${path}/items/${index}`, 'Dòng thiếu unitPrice snapshot phía backend.');
        }
        const lineTotal = Number(item.subtotal ?? item.lineTotal);
        if (!Number.isFinite(lineTotal)) {
          add('P1', 'MISSING_LINE_TOTAL', `${path}/items/${index}`, 'Dòng thiếu subtotal snapshot phía backend.');
        } else {
          computedTotal += lineTotal;
        }
      }
      const expected = Math.max(0, computedTotal - Number(ticket.discountAmount || 0));
      if (items.length && Number(ticket.totalAmount) !== expected) {
        add('P1', 'TOTAL_MISMATCH', path, `Tổng lưu ${String(ticket.totalAmount)}, tổng tính lại ${expected}.`);
      }

      const creator = String(ticket.createdByUid || '');
      if (creator && !users[creator]) {
        add('P2', 'MISSING_CREATOR', path, `Không tìm thấy users/${creator}.`);
      }
    }
  }

  for (const [uid, user] of Object.entries(users)) {
    if (
      user.status !== undefined
      && !['active', 'disabled', 'deleting'].includes(String(user.status))
    ) {
      add('P2', 'INVALID_USER_STATUS', `users/${uid}`, `Trạng thái người dùng không hợp lệ: ${String(user.status)}`);
    }
    if (!['admin', 'staff', 'user'].includes(String(user.role || ''))) {
      add('P1', 'INVALID_USER_ROLE', `users/${uid}`, `Vai trò người dùng không hợp lệ: ${String(user.role)}`);
    }
  }

  const operationRecords = (data.operations || {}) as RecordMap;
  for (const [operationId, operation] of Object.entries(operationRecords)) {
    const type = String(operation.type || '');
    const path = type === 'import' ? 'importTickets'
      : type === 'export' ? 'exportTickets'
        : type === 'sale' ? 'salesTickets'
          : '';
    const ticketKey = String(operation.ticketKey || '');
    if (!path || !ticketKey || !(data[path] as RecordMap | undefined)?.[ticketKey]) {
      add('P1', 'ORPHAN_OPERATION', `operations/${operationId}`, 'Operation không trỏ tới chứng từ cha hợp lệ.');
    }
  }

  const counts = findings.reduce<Record<Severity, number>>((result, finding) => {
    result[finding.severity] = (result[finding.severity] || 0) + 1;
    return result;
  }, { P0: 0, P1: 0, P2: 0, P3: 0 });
  const report = {
    generatedAt: new Date().toISOString(),
    source: input || new URL(databaseURL!).hostname,
    readOnly: true,
    metrics,
    counts,
    limitations: [
      'Không thể đối chiếu tồn hiện tại với tổng biến động nếu dữ liệu không có openingBalance.',
      'Chi tiết phiếu nằm trong ticket.items nên không tồn tại collection dòng chi tiết độc lập để có dòng thiếu phiếu cha.',
      'Không tự sửa, backfill hoặc xóa bất kỳ bản ghi nào.',
    ],
    findings,
  };

  const output = process.env.AUDIT_OUTPUT || 'inventory-audit-report.json';
  const jsonOutput = output.toLowerCase().endsWith('.md')
    ? output.replace(/\.md$/i, '.json')
    : output;
  await writeFile(jsonOutput, JSON.stringify(report, null, 2), 'utf8');

  let markdownOutput: string | undefined;
  if (output.toLowerCase().endsWith('.md')) {
    markdownOutput = output;
    const metricRows = [
      ['Tổng sản phẩm', metrics.products],
      ['Tổng phiếu nhập', metrics.importTickets],
      ['Tổng phiếu xuất', metrics.exportTickets],
      ['Tổng giao dịch bán', metrics.salesTickets],
      ['Chứng từ đã hủy', metrics.cancelledTickets],
      ['Sản phẩm tồn âm', metrics.negativeStockProducts],
      ['Chứng từ thiếu dòng', metrics.missingItemsTickets],
      ['Dòng tham chiếu product không tồn tại', metrics.orphanItemRows],
    ].map(([name, value]) => `| ${name} | ${value} |`).join('\n');
    const findingRows = findings.length
      ? findings.map((finding) =>
          `| ${finding.severity} | ${markdownEscape(finding.code)} | ${markdownEscape(finding.path)} | ${markdownEscape(finding.message)} |`
        ).join('\n')
      : '| - | - | - | Không phát hiện bất thường trong phạm vi kiểm tra. |';
    const markdown = `# Production Data Audit

- Thời gian UTC: ${report.generatedAt}
- Nguồn: \`${markdownEscape(report.source)}\`
- Chế độ: **READ ONLY**

## Thống kê

| Chỉ số | Số lượng |
|---|---:|
${metricRows}

## Mức độ

| P0 | P1 | P2 | P3 |
|---:|---:|---:|---:|
| ${counts.P0} | ${counts.P1} | ${counts.P2} | ${counts.P3} |

## Phát hiện

| Mức | Mã | Đường dẫn | Nội dung |
|---|---|---|---|
${findingRows}

## Giới hạn

${report.limitations.map((item) => `- ${item}`).join('\n')}
`;
    await writeFile(markdownOutput, markdown, 'utf8');
  }
  console.log(JSON.stringify({
    output: markdownOutput || jsonOutput,
    jsonOutput,
    counts,
    metrics,
    total: findings.length,
  }));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
