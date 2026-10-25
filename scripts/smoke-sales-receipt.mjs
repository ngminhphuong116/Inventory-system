import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import electronPath from 'electron';

const projectRoot = resolve(import.meta.dirname, '..');
const kindArg = process.argv.find((argument) => argument.startsWith('--kind='));
const executableArg = process.argv.find((argument) => argument.startsWith('--executable='));
const kind = kindArg?.slice('--kind='.length) || 'sales';

if (!['sales', 'import', 'export'].includes(kind)) {
  throw new Error('Loại phiếu smoke test phải là sales, import hoặc export.');
}

const smokeDir = resolve(projectRoot, 'tmp', 'pdfs', `${kind}-receipt-smoke`);
const bundlePath = resolve(smokeDir, `${kind}-receipt.bundle.mjs`);
const configPath = resolve(smokeDir, 'smoke-config.json');
const screenshotPath = resolve(smokeDir, 'receipt-preview.png');
const pdfPath = resolve(smokeDir, 'receipt-preview.pdf');
const resultPath = resolve(smokeDir, 'smoke-result.json');
const customExecutable = executableArg?.slice('--executable='.length);
const executablePath = customExecutable ? resolve(customExecutable) : electronPath;
const electronEnvironment = { ...process.env };
delete electronEnvironment.ELECTRON_RUN_AS_NODE;

await mkdir(smokeDir, { recursive: true });
await build({
  entryPoints: [resolve(
    projectRoot,
    'src',
    'components',
    kind === 'sales' ? 'SalesReceipt.ts' : 'Printticket.ts',
  )],
  outfile: bundlePath,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
});

const receiptModule = await import(`${pathToFileURL(bundlePath).href}?v=${Date.now()}`);
const sharedItems = Array.from({ length: 12 }, (_, index) => ({
  productId: `product-${index + 1}`,
  productCode: `VP-${String(index + 1).padStart(3, '0')}`,
  productName: index === 0
    ? 'Bộ thiết bị công nghệ có tên rất dài để kiểm tra tự động xuống dòng và không cắt nội dung trong bảng'
    : `Sản phẩm kiểm thử số ${index + 1}`,
  unit: index % 2 === 0 ? 'Bộ' : 'Cái',
  quantity: index + 1,
  salePrice: 100_000_000,
  importPrice: 80_000_000,
  lineTotal: (index + 1) * (kind === 'import' ? 80_000_000 : 100_000_000),
}));
const subtotal = sharedItems.reduce((sum, item) => sum + item.lineTotal, 0);

const html = kind === 'sales'
  ? receiptModule.buildSalesReceiptHtml({
      invoiceNo: 'BL-SMOKE-20260802',
      date: '2026-08-02 23:30',
      customerName: 'Khách hàng kiểm thử',
      createdBy: 'Nhân viên kiểm thử',
      voucherUsed: 'SMOKE100',
      discountAmount: 100_000_000,
      subtotal,
      totalAmount: subtotal - 100_000_000,
      note: 'Phiếu smoke test local.',
      items: sharedItems,
    })
  : receiptModule.buildTicketHtml({
      type: kind === 'import' ? 'Nhập kho' : 'Xuất kho',
      invoiceNo: kind === 'import' ? 'HDN-SMOKE-20260802' : 'HDX-SMOKE-20260802',
      date: '2026-08-02 23:30',
      supplier: 'Nhà cung cấp kiểm thử',
      customer: 'Khách hàng kiểm thử',
      totalAmount: subtotal,
      items: sharedItems,
      note: 'Phiếu smoke test local.',
    });

await writeFile(configPath, JSON.stringify({
  html,
  screenshotPath,
  pdfPath,
  resultPath,
}), 'utf8');

await new Promise((resolvePromise, rejectPromise) => {
  const smokeArgument = `sales-receipt-smoke=${configPath}`;
  const launchArguments = customExecutable
    ? [smokeArgument]
    : [projectRoot, smokeArgument];
  const child = spawn(executablePath, launchArguments, {
    cwd: projectRoot,
    env: electronEnvironment,
    windowsHide: true,
    stdio: 'inherit',
  });
  child.once('error', rejectPromise);
  child.once('exit', (code) => {
    if (code === 0) {
      resolvePromise();
      return;
    }
    rejectPromise(new Error(`Electron smoke test exited with code ${code}.`));
  });
});

console.log(resultPath);
