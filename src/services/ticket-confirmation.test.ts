import { describe, expect, it, vi } from 'vitest';
import {
  TicketConfirmationGate,
  type TicketConfirmationDraft,
} from './ticket-confirmation';

const draft: TicketConfirmationDraft<{ invoiceNo: string }> = {
  kind: 'import',
  documentNo: 'TEST_UAT_HDN-001',
  date: '2026-07-26 10:00',
  partnerLabel: 'Nhà cung cấp',
  partnerName: 'TEST_UAT_NCC',
  items: [{
    productId: 'p1',
    productName: 'Sản phẩm',
    quantity: 2,
    unitPrice: 100,
  }],
  totalQuantity: 2,
  totalAmount: 200,
  payload: { invoiceNo: 'TEST_UAT_HDN-001' },
};

describe('ticket confirmation gate', () => {
  it('does not write when preparing or cancelling the first confirmation', () => {
    const gate = new TicketConfirmationGate<typeof draft.payload>();
    const writer = vi.fn();
    gate.prepare(draft);
    expect(writer).not.toHaveBeenCalled();
    gate.cancel();
    expect(writer).not.toHaveBeenCalled();
    expect(gate.draft).toBeNull();
  });

  it('writes only after the second confirmation', async () => {
    const gate = new TicketConfirmationGate<typeof draft.payload>();
    const writer = vi.fn().mockResolvedValue(undefined);
    gate.prepare(draft);
    await gate.confirm(writer);
    expect(writer).toHaveBeenCalledTimes(1);
    expect(gate.draft).toBeNull();
  });

  it('coalesces double-click into one database write', async () => {
    const gate = new TicketConfirmationGate<typeof draft.payload>();
    let resolveWrite!: () => void;
    const writer = vi.fn(() => new Promise<void>((resolve) => {
      resolveWrite = resolve;
    }));
    gate.prepare(draft);
    const first = gate.confirm(writer);
    const second = gate.confirm(writer);
    expect(first).toBe(second);
    expect(writer).toHaveBeenCalledTimes(1);
    resolveWrite();
    await first;
  });

  it('keeps the draft after a failed RTDB write', async () => {
    const gate = new TicketConfirmationGate<typeof draft.payload>();
    gate.prepare(draft);
    await expect(gate.confirm(async () => {
      throw new Error('permission_denied');
    })).rejects.toThrow('permission_denied');
    expect(gate.draft).toEqual(draft);
  });

  it('supports the same two-step confirmation for a sales ticket', async () => {
    const salesDraft: TicketConfirmationDraft<{ invoiceNo: string }> = {
      ...draft,
      kind: 'sale',
      documentNo: 'BL-001',
      partnerLabel: 'Khách hàng',
      partnerName: 'Khách bán lẻ',
      subtotal: 220,
      discountAmount: 20,
      totalAmount: 200,
      payload: { invoiceNo: 'BL-001' },
    };
    const gate = new TicketConfirmationGate<typeof salesDraft.payload>();
    const writer = vi.fn().mockResolvedValue(undefined);

    gate.prepare(salesDraft);
    expect(writer).not.toHaveBeenCalled();
    await gate.confirm(writer);

    expect(writer).toHaveBeenCalledWith(salesDraft);
    expect(gate.draft).toBeNull();
  });
});
