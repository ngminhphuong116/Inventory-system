import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  profiles: {} as Record<string, Record<string, unknown>>,
  root: {} as Record<string, any>,
  nextProductId: 0,
}));

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(),
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn(() => ({})),
}));

vi.mock('firebase-admin/database', () => ({
  getDatabase: vi.fn(() => ({
    ref: (path = '') => ({
      get: async () => ({
        val: () => {
          if (path.startsWith('users/')) return state.profiles[path.slice(6)] || null;
          return path.split('/').filter(Boolean).reduce<any>(
            (value, key) => value?.[key],
            state.root,
          ) ?? null;
        },
        exists: () => path.split('/').filter(Boolean).reduce<any>(
          (value, key) => value?.[key],
          state.root,
        ) !== undefined,
      }),
      push: () => ({ key: `new-product-${++state.nextProductId}` }),
      transaction: async (updater: (current: Record<string, any>) => Record<string, any> | undefined) => {
        const next = updater(state.root);
        if (next === undefined) return { committed: false };
        state.root = next;
        return { committed: true };
      },
    }),
  })),
}));

import {
  cancelInventoryOperation,
  createInventoryOperation,
  archiveWarehouseProduct,
  saveWarehouseProduct,
} from './index.js';

describe('callable authentication and authorization contract', () => {
  beforeEach(() => {
    state.profiles = {};
    state.root = {};
    state.nextProductId = 0;
  });

  it('rejects unauthenticated create requests', async () => {
    await expect(createInventoryOperation.run({
      data: {
        type: 'import',
        operationId: 'request-0001',
        ticket: {},
      },
      auth: undefined,
    } as never)).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects a user without import permission', async () => {
    state.profiles.staff = {
      role: 'staff',
      status: 'active',
      permissions: { import: false },
    };
    await expect(createInventoryOperation.run({
      data: {
        type: 'import',
        operationId: 'request-0002',
        ticket: {},
      },
      auth: { uid: 'staff', token: { email: 'staff@example.com' } },
    } as never)).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('rejects an active basic user even when legacy permissions are missing', async () => {
    state.profiles.basic = {
      role: 'user',
      status: 'active',
    };
    await expect(createInventoryOperation.run({
      data: {
        type: 'import',
        operationId: 'request-basic-user',
        ticket: {},
      },
      auth: { uid: 'basic', token: { email: 'basic@example.com' } },
    } as never)).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('rejects cancellation by a non-admin user', async () => {
    state.profiles.staff = {
      role: 'staff',
      status: 'active',
      permissions: { import: true },
    };
    await expect(cancelInventoryOperation.run({
      data: {
        type: 'import',
        key: 'ticket-1',
        operationId: 'request-0003',
        reason: 'Test',
      },
      auth: { uid: 'staff', token: { email: 'staff@example.com' } },
    } as never)).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('creates products at zero stock and ignores client stock fields', async () => {
    state.profiles.admin = { role: 'admin', status: 'active' };
    const result = await saveWarehouseProduct.run({
      data: {
        requestId: 'product-request-1',
        product: {
          code: 'SP-01',
          name: 'Sản phẩm',
          unit: 'cái',
          category: 'Chung',
          supplier: 'NCC',
          importPrice: 10,
          salePrice: 20,
          minStock: 2,
          quantity: 999,
          status: 'Normal',
        },
      },
      auth: { uid: 'admin', token: { email: 'admin@example.com' } },
    } as never);
    expect(result).toMatchObject({ id: 'new-product-1', duplicate: false });
    expect(state.root.products['new-product-1'].quantity).toBe(0);
    expect(state.root.products['new-product-1'].status).toBe('Critical');
  });

  it('returns the original product when a create request is submitted twice', async () => {
    state.profiles.admin = { role: 'admin', status: 'active' };
    const request = {
      data: {
        requestId: 'product-request-retry',
        product: {
          code: 'SP-RETRY',
          name: 'Sản phẩm gửi lại',
          unit: 'cái',
          category: 'Chung',
          supplier: 'NCC',
          importPrice: 10,
          salePrice: 20,
          minStock: 2,
        },
      },
      auth: { uid: 'admin', token: { email: 'admin@example.com' } },
    };
    const first = await saveWarehouseProduct.run(request as never);
    const retry = await saveWarehouseProduct.run(request as never);

    expect(first).toMatchObject({ id: 'new-product-1', duplicate: false });
    expect(retry).toMatchObject({ id: 'new-product-1', duplicate: true });
    expect(Object.keys(state.root.products)).toEqual(['new-product-1']);
  });

  it('enforces unique product codes in the backend transaction', async () => {
    state.profiles.admin = { role: 'admin', status: 'active' };
    state.root.products = {
      existing: {
        code: 'SP-01',
        name: 'Existing',
        quantity: 0,
        status: 'Critical',
      },
    };
    await expect(saveWarehouseProduct.run({
      data: {
        requestId: 'product-request-2',
        product: {
          code: 'sp-01',
          name: 'Duplicate',
          unit: 'cái',
          category: 'Chung',
          supplier: 'NCC',
          importPrice: 10,
          salePrice: 20,
          minStock: 2,
        },
      },
      auth: { uid: 'admin', token: { email: 'admin@example.com' } },
    } as never)).rejects.toMatchObject({ code: 'already-exists' });
  });

  it('blocks archiving products that still have stock', async () => {
    state.profiles.admin = { role: 'admin', status: 'active' };
    state.root.products = {
      stocked: { code: 'SP-02', quantity: 1, status: 'Normal' },
    };
    await expect(archiveWarehouseProduct.run({
      data: {
        requestId: 'product-request-3',
        id: 'stocked',
      },
      auth: { uid: 'admin', token: { email: 'admin@example.com' } },
    } as never)).rejects.toMatchObject({ code: 'failed-precondition' });
  });
});
