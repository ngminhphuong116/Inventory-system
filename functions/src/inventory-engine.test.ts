import { describe, expect, it } from 'vitest';
import {
  applyCancel,
  applyCreate,
  InventoryError,
  type OperationType,
  type RootData,
  type TicketRecord,
} from './inventory-engine.js';

const actor = { actorUid: 'admin-1', actorEmail: 'admin@example.com', now: 1000 };

function rootWithStock(stockA = 10, stockB = 10): RootData {
  return {
    products: {
      a: { quantity: stockA, minStock: 2, name: 'A', code: 'A', unit: 'cái', importPrice: 4, salePrice: 10 },
      b: { quantity: stockB, minStock: 2, name: 'B', code: 'B', unit: 'cái', importPrice: 5, salePrice: 10 },
    },
  };
}

function create(
  root: RootData,
  type: OperationType,
  operationId: string,
  ticket: TicketRecord,
  ticketKey = `ticket-${operationId}`,
) {
  const normalizedTicket: TicketRecord = {
    date: '2026-07-25 09:00',
    invoiceNo: `INV-${operationId}`,
    totalAmount: 0,
    ...(type === 'import' ? { importPrice: 5 } : { salePrice: 10 }),
    ...ticket,
  };
  if (normalizedTicket.items) {
    normalizedTicket.items = normalizedTicket.items.map((item) => ({
      ...(type === 'import' ? { importPrice: 5 } : { salePrice: 10 }),
      ...item,
    }));
  }
  return applyCreate(root, { type, operationId, ticketKey, ticket: normalizedTicket, ...actor });
}

function cancel(
  root: RootData,
  type: OperationType,
  ticketKey: string,
  operationId: string,
) {
  return applyCancel(root, {
    type,
    ticketKey,
    operationId,
    reason: 'Nhập nhầm chứng từ',
    ...actor,
    now: 2000,
  });
}

describe('concurrent stock semantics', () => {
  it('only one of two exports can consume the last unit', () => {
    const root = rootWithStock(1);
    create(root, 'export', 'export-op-1', { productId: 'a', quantity: 1 });
    expect(() => create(root, 'export', 'export-op-2', { productId: 'a', quantity: 1 }))
      .toThrow(InventoryError);
    expect(root.products?.a.quantity).toBe(0);
    expect(Object.keys(root.exportTickets ?? {})).toHaveLength(1);
  });

  it('only one of two sales can consume the last unit', () => {
    const root = rootWithStock(1);
    create(root, 'sale', 'sales-op-01', { productId: 'a', quantity: 1 });
    expect(() => create(root, 'sale', 'sales-op-02', { productId: 'a', quantity: 1 }))
      .toThrowError(/không đủ tồn kho/);
  });

  it('does not lose an import followed by an export', () => {
    const root = rootWithStock(5);
    create(root, 'import', 'import-op-1', { productId: 'a', quantity: 3, importPrice: 20 });
    create(root, 'export', 'export-op-3', { productId: 'a', quantity: 4 });
    expect(root.products?.a.quantity).toBe(4);
  });

  it('aggregates repeated product lines before checking stock', () => {
    const root = rootWithStock(3);
    expect(() => create(root, 'export', 'multi-op-001', {
      items: [
        { productId: 'a', quantity: 2 },
        { productId: 'a', quantity: 2 },
      ],
    })).toThrowError(/không đủ tồn kho/);
    expect(root.products?.a.quantity).toBe(3);
  });

  it('does not partially apply a multi-product ticket', () => {
    const root = rootWithStock(10, 1);
    expect(() => create(root, 'export', 'multi-op-002', {
      items: [
        { productId: 'a', quantity: 3 },
        { productId: 'b', quantity: 2 },
      ],
    })).toThrowError(/không đủ tồn kho/);
    expect(root.products?.a.quantity).toBe(10);
    expect(root.products?.b.quantity).toBe(1);
    expect(root.exportTickets).toBeUndefined();
  });
});

describe('atomicity and idempotency', () => {
  it('does not create a ticket when stock validation fails', () => {
    const root = rootWithStock(0);
    expect(() => create(root, 'sale', 'atomic-op-1', { productId: 'a', quantity: 1 }))
      .toThrow();
    expect(root.salesTickets).toBeUndefined();
  });

  it('rejects an invalid second item without changing the first', () => {
    const root = rootWithStock();
    expect(() => create(root, 'import', 'atomic-op-2', {
      items: [
        { productId: 'a', quantity: 2, importPrice: 10 },
        { productId: 'b', quantity: 2, importPrice: -1 },
      ],
    })).toThrowError(/giá nhập/i);
    expect(root.products?.a.quantity).toBe(10);
  });

  it('processes the same operationId once', () => {
    const root = rootWithStock();
    expect(create(root, 'export', 'same-operation', { productId: 'a', quantity: 2 }, 'ticket-1'))
      .toBe('created');
    expect(create(root, 'export', 'same-operation', { productId: 'a', quantity: 2 }, 'ticket-2'))
      .toBe('duplicate');
    expect(root.products?.a.quantity).toBe(8);
    expect(Object.keys(root.exportTickets ?? {})).toHaveLength(1);
  });

  it('creates one multi-item sale, discounts on the server, and records every stock movement', () => {
    const root = rootWithStock(10, 10);
    create(root, 'sale', 'multi-sale-discount', {
      invoiceDiscountType: 'percent',
      invoiceDiscountValue: 10,
      items: [
        {
          productId: 'a', quantity: 2, unitPrice: 10,
          lineDiscountType: 'amount', lineDiscountValue: 5,
          lineDiscountAmount: 999, lineTotal: 1,
        },
        {
          productId: 'b', quantity: 3, unitPrice: 20,
          lineDiscountType: 'percent', lineDiscountValue: 50,
        },
      ],
    }, 'multi-sale-ticket');

    expect(root.products?.a.quantity).toBe(8);
    expect(root.products?.b.quantity).toBe(7);
    expect(root.salesTickets?.['multi-sale-ticket']).toMatchObject({
      transactionId: 'multi-sale-discount',
      subtotal: 80,
      lineDiscountTotal: 35,
      invoiceDiscountType: 'percent',
      invoiceDiscountValue: 10,
      invoiceDiscountAmount: 4,
      discountAmount: 39,
      totalAmount: 41,
      totalQuantity: 5,
    });
    expect(root.salesTickets?.['multi-sale-ticket'].items?.[0]).toMatchObject({
      subtotalBeforeDiscount: 20,
      lineDiscountAmount: 5,
      lineTotal: 15,
    });
    expect(Object.values(root.stockMovements || {})).toEqual(expect.arrayContaining([
      expect.objectContaining({
        referenceId: 'multi-sale-ticket', productId: 'a', beforeStock: 10,
        afterStock: 8, quantity: 2, amount: 15,
      }),
      expect.objectContaining({
        referenceId: 'multi-sale-ticket', productId: 'b', beforeStock: 10,
        afterStock: 7, quantity: 3, amount: 30,
      }),
    ]));
  });

  it('leaves tickets, movements and every stock untouched when one sale item is unavailable', () => {
    const root = rootWithStock(10, 1);
    expect(() => create(root, 'sale', 'atomic-multi-sale', {
      items: [
        { productId: 'a', quantity: 2, unitPrice: 10 },
        { productId: 'b', quantity: 2, unitPrice: 10 },
      ],
    })).toThrowError(/không đủ tồn kho/);
    expect(root.products?.a.quantity).toBe(10);
    expect(root.products?.b.quantity).toBe(1);
    expect(root.salesTickets).toBeUndefined();
    expect(root.stockMovements).toBeUndefined();
  });

  it('does not duplicate a bill or its movements when operationId is retried', () => {
    const root = rootWithStock();
    const ticket = { items: [{ productId: 'a', quantity: 2, unitPrice: 10 }] };
    expect(create(root, 'sale', 'retry-sale-operation', ticket, 'sale-ticket-1')).toBe('created');
    expect(create(root, 'sale', 'retry-sale-operation', ticket, 'sale-ticket-2')).toBe('duplicate');
    expect(root.products?.a.quantity).toBe(8);
    expect(Object.keys(root.salesTickets || {})).toHaveLength(1);
    expect(Object.keys(root.stockMovements || {})).toHaveLength(1);
  });

  it('rejects reusing an operationId for a different operation type', () => {
    const root = rootWithStock();
    create(root, 'import', 'operation-conflict', { productId: 'a', quantity: 1 });
    expect(() => create(root, 'export', 'operation-conflict', {
      productId: 'a',
      quantity: 1,
    })).toThrowError(/nghiệp vụ khác/);
  });

  it('sets status from the committed quantity', () => {
    const root = rootWithStock(3);
    create(root, 'sale', 'status-op-01', { productId: 'a', quantity: 1 });
    expect(root.products?.a.status).toBe('Warning');
  });

  it('replaces client-supplied audit identity with verified actor data', () => {
    const root = rootWithStock();
    create(root, 'sale', 'audit-operation', {
      productId: 'a',
      quantity: 1,
      createdBy: 'forged@example.com',
      createdByUid: 'forged-uid',
      cancelledBy: 'forged@example.com',
      status: 'cancelled',
    }, 'audit-ticket');
    const ticket = root.salesTickets?.['audit-ticket'];
    expect(ticket?.createdBy).toBe(actor.actorEmail);
    expect(ticket?.createdByUid).toBe(actor.actorUid);
    expect(ticket?.status).toBe('active');
    expect(ticket?.cancelledBy).toBeUndefined();
  });

  it('calculates line totals and grand total on the backend', () => {
    const root = rootWithStock();
    create(root, 'import', 'server-total-1', {
      totalAmount: 1,
      items: [
        { productId: 'a', quantity: 2, importPrice: 7 },
        { productId: 'b', quantity: 3, importPrice: 9 },
      ],
    }, 'server-total-ticket');

    const ticket = root.importTickets?.['server-total-ticket'];
    expect(ticket?.totalAmount).toBe(41);
    expect(ticket?.totalQuantity).toBe(5);
    expect(ticket?.items?.map((item) => item.lineTotal)).toEqual([14, 27]);
  });

  it('persists the actual sale price submitted at the point of sale', () => {
    const root = rootWithStock(200);
    root.products!.a.salePrice = 10_000;
    create(root, 'sale', 'trusted-price-1', {
      productId: 'a',
      quantity: 100,
      unitPrice: 8_000,
      salePrice: 8_000,
      totalAmount: 1,
    }, 'trusted-price-ticket');
    const ticket = root.salesTickets?.['trusted-price-ticket'];
    expect(ticket?.totalAmount).toBe(800_000);
    expect(ticket?.unitPrice).toBe(8_000);
    expect(ticket?.salePrice).toBe(8_000);
    expect(ticket?.items?.[0]).toMatchObject({
      unitPrice: 8_000,
      actualUnitPrice: 8_000,
      listedPrice: 10_000,
      subtotal: 800_000,
    });

    root.products!.a.salePrice = 12_000;
    expect(ticket?.items?.[0].unitPrice).toBe(8_000);
    expect(ticket?.totalAmount).toBe(800_000);
  });

  it('accepts zero-priced gifts without falling back to the catalog price', () => {
    const root = rootWithStock();
    create(root, 'sale', 'gift-price-01', {
      productId: 'a',
      quantity: 2,
      unitPrice: 0,
      salePrice: 0,
    }, 'gift-ticket');
    expect(root.salesTickets?.['gift-ticket']).toMatchObject({
      unitPrice: 0,
      subtotal: 0,
      totalAmount: 0,
    });
  });

  it.each([
    ['import', 45_000, 'importTickets', 'importPrice'],
    ['export', 65_000, 'exportTickets', 'exportPrice'],
  ] as const)('persists an actual %s unit price snapshot', (type, unitPrice, path, alias) => {
    const root = rootWithStock(200);
    create(root, type, `${type}-snapshot`, {
      productId: 'a',
      quantity: 2,
      unitPrice,
    }, `${type}-snapshot-ticket`);
    const ticket = (root[path] as Record<string, TicketRecord>)[`${type}-snapshot-ticket`];
    expect(ticket.unitPrice).toBe(unitPrice);
    expect(ticket[alias]).toBe(unitPrice);
    expect(ticket.items?.[0]).toMatchObject({
      unitPrice,
      subtotal: unitPrice * 2,
    });
  });

  it('validates and calculates vouchers from server data', () => {
    const root = rootWithStock();
    root.vouchers = {
      voucher: { code: 'GIAM10', type: 'percentage', value: 10, minOrder: 10 },
    };
    create(root, 'sale', 'voucher-total-1', {
      productId: 'a',
      quantity: 2,
      voucherUsed: 'giam10',
      discountAmount: 999,
      totalAmount: 1,
    }, 'voucher-ticket');
    expect(root.salesTickets?.['voucher-ticket'].subtotal).toBe(20);
    expect(root.salesTickets?.['voucher-ticket'].discountAmount).toBe(2);
    expect(root.salesTickets?.['voucher-ticket'].totalAmount).toBe(18);
  });

  it('rejects a duplicate active invoice number', () => {
    const root = rootWithStock();
    create(root, 'import', 'invoice-unique-1', {
      productId: 'a',
      quantity: 1,
      invoiceNo: 'PN-001',
    }, 'invoice-ticket-1');
    expect(() => create(root, 'import', 'invoice-unique-2', {
      productId: 'a',
      quantity: 1,
      invoiceNo: 'pn-001',
    }, 'invoice-ticket-2')).toThrowError(/đã tồn tại/);
  });
});

describe('safe cancellation', () => {
  it('reverses an import and soft-cancels its ticket', () => {
    const root = rootWithStock(5);
    create(root, 'import', 'create-import', { productId: 'a', quantity: 3 }, 'import-1');
    cancel(root, 'import', 'import-1', 'cancel-import');
    expect(root.products?.a.quantity).toBe(5);
    expect(root.importTickets?.['import-1'].status).toBe('cancelled');
    expect(root.importTickets?.['import-1'].cancelledByUid).toBe(actor.actorUid);
    expect(root.importTickets?.['import-1'].cancelReason).toBe('Nhập nhầm chứng từ');
    expect(root.auditLogs?.['cancel-import'].action).toBe('cancel');
  });

  it('rejects import cancellation if current stock is insufficient', () => {
    const root = rootWithStock(0);
    root.importTickets = { old: { productId: 'a', quantity: 2 } };
    expect(() => cancel(root, 'import', 'old', 'cancel-old-1')).toThrowError(/không đủ tồn kho/);
    expect(root.importTickets.old.status).toBeUndefined();
  });

  it.each([
    ['export', 'exportTickets'],
    ['sale', 'salesTickets'],
  ] as const)('returns stock when cancelling %s', (type, path) => {
    const root = rootWithStock(5);
    create(root, type, `create-${type}`, { productId: 'a', quantity: 2 }, 'ticket');
    cancel(root, type, 'ticket', `cancel-${type}`);
    expect(root.products?.a.quantity).toBe(5);
    expect((root[path] as Record<string, TicketRecord>).ticket.status).toBe('cancelled');
  });

  it('cannot cancel an already cancelled ticket', () => {
    const root = rootWithStock();
    create(root, 'sale', 'create-sale-2', { productId: 'a', quantity: 1 }, 'sale-2');
    cancel(root, 'sale', 'sale-2', 'cancel-sale-2');
    expect(() => cancel(root, 'sale', 'sale-2', 'cancel-sale-3')).toThrowError(/đã được hủy/);
    expect(root.products?.a.quantity).toBe(10);
  });

  it('reverses all items in a multi-product ticket', () => {
    const root = rootWithStock();
    create(root, 'export', 'multi-create', {
      items: [
        { productId: 'a', quantity: 2 },
        { productId: 'b', quantity: 3 },
      ],
    }, 'multi-ticket');
    cancel(root, 'export', 'multi-ticket', 'multi-cancel');
    expect(root.products?.a.quantity).toBe(10);
    expect(root.products?.b.quantity).toBe(10);
  });

  it('supports legacy tickets without status or items', () => {
    const root = rootWithStock(7);
    root.salesTickets = { legacy: { productId: 'a', quantity: 3 } };
    cancel(root, 'sale', 'legacy', 'legacy-cancel');
    expect(root.products?.a.quantity).toBe(10);
    expect(root.salesTickets.legacy.status).toBe('cancelled');
  });
});
