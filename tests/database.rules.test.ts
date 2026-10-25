import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  equalTo,
  get,
  orderByChild,
  query,
  ref,
  runTransaction,
  set,
  update,
  type Database,
} from 'firebase/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyCancel,
  applyCreate,
  type RootData,
} from '../functions/src/inventory-engine';

const COMPANY = 'company-a';
const BRANCH = 'branch-a';
const BRANCH_PATH = `companies/${COMPANY}/branches/${BRANCH}`;
let env: RulesTestEnvironment;

const permissions = {
  product: true,
  import: true,
  export: true,
  sales: true,
  history: true,
  report: false,
};

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-inventory',
    database: {
      rules: readFileSync(resolve('database.rules.json'), 'utf8'),
    },
  });
  await env.withSecurityRulesDisabled(async (context) => {
    await set(ref(context.database()), {
      users: {
        admin: {
          email: 'admin@example.com',
          role: 'admin',
          status: 'active',
          companyId: COMPANY,
          branchId: BRANCH,
          scopeKey: `${COMPANY}__${BRANCH}`,
          permissions,
        },
        staff: {
          email: 'staff@example.com',
          role: 'staff',
          status: 'active',
          companyId: COMPANY,
          branchId: BRANCH,
          scopeKey: `${COMPANY}__${BRANCH}`,
          permissions,
        },
        readonly: {
          email: 'readonly@example.com',
          role: 'staff',
          status: 'active',
          companyId: COMPANY,
          branchId: BRANCH,
          scopeKey: `${COMPANY}__${BRANCH}`,
          permissions: {
            product: false,
            import: false,
            export: false,
            sales: false,
            history: true,
            report: false,
          },
        },
        otherBranch: {
          email: 'other@example.com',
          role: 'staff',
          status: 'active',
          companyId: COMPANY,
          branchId: 'branch-b',
          scopeKey: `${COMPANY}__branch-b`,
          permissions,
        },
        disabled: {
          email: 'disabled@example.com',
          role: 'staff',
          status: 'disabled',
          companyId: COMPANY,
          branchId: BRANCH,
          scopeKey: `${COMPANY}__${BRANCH}`,
          permissions,
        },
        legacyAdmin: {
          email: 'legacy-admin@example.com',
          role: 'admin',
          status: 'active',
          permissions,
        },
      },
      companies: {
        [COMPANY]: {
          branches: {
            [BRANCH]: {
              categories: {
                categoryA: {
                  name: 'Thiết bị',
                  companyId: COMPANY,
                  branchId: BRANCH,
                  createdByUid: 'admin',
                  createdAt: 1,
                },
                legacyCategoryKey: 'Tên danh mục legacy.#$[]',
              },
              products: {
                p1: {
                  code: 'P1',
                  name: 'Product',
                  quantity: 5,
                  minStock: 1,
                  importPrice: 100,
                  salePrice: 150,
                  categoryId: 'categoryA',
                  companyId: COMPANY,
                  branchId: BRANCH,
                },
              },
            },
            'branch-b': {
              products: {
                p2: {
                  code: 'P2',
                  name: 'Other product',
                  quantity: 2,
                  companyId: COMPANY,
                  branchId: 'branch-b',
                },
              },
            },
          },
        },
      },
      products: {
        legacyProduct: {
          code: 'LEGACY-1',
          name: 'Legacy product',
          quantity: 0,
          minStock: 1,
          importPrice: 100,
          salePrice: 150,
        },
      },
      categories: {
        legacyCategoryKey: 'Tên danh mục root legacy.#$[]',
      },
    });
  });
});

afterAll(async () => {
  await env.cleanup();
});

async function transactBranch(
  database: Database,
  mutate: (root: RootData) => void,
) {
  const branchRef = ref(database, BRANCH_PATH);
  const initial = (await get(branchRef)).val() as RootData | null;
  return runTransaction(branchRef, (current: RootData | null) => {
    const root = current ?? structuredClone(initial) ?? {};
    mutate(root);
    return root;
  }, { applyLocally: false });
}

async function transactLegacyRoot(
  database: Database,
  mutate: (root: RootData) => void,
) {
  const rootRef = ref(database);
  const initial = (await get(rootRef)).val() as RootData | null;
  return runTransaction(rootRef, (current: RootData | null) => {
    const root = current ?? structuredClone(initial) ?? {};
    mutate(root);
    return root;
  }, { applyLocally: false });
}

describe('Realtime Database tenant rules', () => {
  it('denies unauthenticated and disabled users', async () => {
    await assertFails(get(ref(env.unauthenticatedContext().database(), BRANCH_PATH)));
    await assertFails(get(ref(env.authenticatedContext('disabled').database(), BRANCH_PATH)));
  });

  it('allows an active user to read only their assigned branch', async () => {
    const database = env.authenticatedContext('staff').database();
    await assertSucceeds(get(ref(database, BRANCH_PATH)));
    await assertFails(get(ref(database, `companies/${COMPANY}/branches/branch-b`)));
  });

  it('supports a legacy admin at the root without using an empty path', async () => {
    const database = env.authenticatedContext('legacyAdmin').database();
    await assertSucceeds(get(ref(database)));
    const result = await assertSucceeds(transactLegacyRoot(database, (root) => {
      applyCreate(root, {
        type: 'import',
        ticketKey: 'legacyTicket',
        operationId: 'legacy-operation-1',
        ticket: {
          invoiceNo: 'LEGACY-IMP-001',
          date: '26/07/2026',
          items: [{ productId: 'legacyProduct', quantity: 2, importPrice: 100 }],
        },
        actorUid: 'legacyAdmin',
        actorEmail: 'legacy-admin@example.com',
        now: 1,
      });
    }));
    expect(result.committed).toBe(true);
    expect(result.snapshot.child('products/legacyProduct/quantity').val()).toBe(2);
  });

  it('still prevents a legacy admin from changing their own role', async () => {
    await assertFails(update(
      ref(env.authenticatedContext('legacyAdmin').database(), 'users/legacyAdmin'),
      { role: 'staff' },
    ));
  });

  it('allows users to read their own profile but not another profile directly', async () => {
    const database = env.authenticatedContext('staff').database();
    await assertSucceeds(get(ref(database, 'users/staff')));
    await assertFails(get(ref(database, 'users/admin')));
  });

  it('allows admins to query only the indexed scope', async () => {
    const usersQuery = query(
      ref(env.authenticatedContext('admin').database(), 'users'),
      orderByChild('scopeKey'),
      equalTo(`${COMPANY}__${BRANCH}`),
    );
    const snapshot = await assertSucceeds(get(usersQuery));
    expect(snapshot.hasChild('otherBranch')).toBe(false);
    expect(snapshot.hasChild('staff')).toBe(true);
  });

  it('rejects cross-branch writes and users without inventory permission', async () => {
    await assertFails(update(
      ref(env.authenticatedContext('otherBranch').database(), `${BRANCH_PATH}/products/p1`),
      { quantity: 3 },
    ));
    await assertFails(update(
      ref(env.authenticatedContext('readonly').database(), `${BRANCH_PATH}/products/p1`),
      { quantity: 3 },
    ));
  });

  it('rejects negative stock', async () => {
    await assertFails(update(
      ref(env.authenticatedContext('staff').database(), `${BRANCH_PATH}/products/p1`),
      { quantity: -1 },
    ));
  });

  it('stores category names as values and stable IDs as Firebase keys', async () => {
    const adminDatabase = env.authenticatedContext('admin').database();
    await assertSucceeds(set(
      ref(adminDatabase, `${BRANCH_PATH}/categories/category-special`),
      {
        name: 'Nhóm A.#$[]',
        companyId: COMPANY,
        branchId: BRANCH,
        createdByUid: 'admin',
        createdAt: 2,
      },
    ));
    await assertSucceeds(set(
      ref(adminDatabase, `${BRANCH_PATH}/products/product-special`),
      {
        code: 'SPECIAL-1',
        name: 'Sản phẩm ký tự đặc biệt',
          quantity: 0,
          categoryId: 'category-special',
        companyId: COMPANY,
        branchId: BRANCH,
      },
    ));
    await assertFails(set(
      ref(env.authenticatedContext('staff').database(), `${BRANCH_PATH}/categories/staff-category`),
      {
        name: 'Không được phép',
        companyId: COMPANY,
        branchId: BRANCH,
        createdByUid: 'staff',
      },
    ));
  });

  it('allows only an admin to save scoped business settings', async () => {
    const settings = {
      businessName: 'Doanh nghiệp mẫu',
      address: '',
      phone: '',
      companyId: COMPANY,
      branchId: BRANCH,
      updatedAt: 2,
      updatedByUid: 'admin',
    };
    await assertSucceeds(set(
      ref(env.authenticatedContext('admin').database(), `${BRANCH_PATH}/settings`),
      settings,
    ));
    await assertFails(set(
      ref(env.authenticatedContext('staff').database(), `${BRANCH_PATH}/settings`),
      { ...settings, updatedByUid: 'staff' },
    ));
  });

  it('allows a scoped atomic import transaction', async () => {
    const database = env.authenticatedContext('staff').database();
    const result = await assertSucceeds(transactBranch(database, (root) => {
      applyCreate(root, {
        type: 'import',
        ticketKey: 'ticket1',
        operationId: 'op-import-1',
        ticket: {
          invoiceNo: 'IMP-001',
          date: '26/07/2026',
          companyId: COMPANY,
          branchId: BRANCH,
          items: [{ productId: 'p1', quantity: 2, importPrice: 100 }],
        },
        actorUid: 'staff',
        actorEmail: 'staff@example.com',
        now: 1,
      });
    }));
    expect(result.committed).toBe(true);
    expect(result.snapshot.child('products/p1/quantity').val()).toBe(7);
  });

  it('runs export, sale, cancellation and duplicate protection in the emulator', async () => {
    const database = env.authenticatedContext('admin').database();

    await assertSucceeds(transactBranch(database, (root) => {
      applyCreate(root, {
        type: 'export',
        ticketKey: 'export1',
        operationId: 'op-export-1',
        ticket: {
          invoiceNo: 'EXP-001',
          date: '26/07/2026',
          companyId: COMPANY,
          branchId: BRANCH,
          items: [{ productId: 'p1', quantity: 1, unitPrice: 20 }],
        },
        actorUid: 'admin',
        actorEmail: 'admin@example.com',
        now: 2,
      });
    }));

    await assertSucceeds(transactBranch(database, (root) => {
      applyCreate(root, {
        type: 'sale',
        ticketKey: 'sale1',
        operationId: 'op-sale-1',
        ticket: {
          invoiceNo: 'SALE-001',
          date: '26/07/2026',
          companyId: COMPANY,
          branchId: BRANCH,
          items: [{ productId: 'p1', quantity: 1, unitPrice: 20 }],
        },
        actorUid: 'admin',
        actorEmail: 'admin@example.com',
        now: 3,
      });
    }));

    const branchRef = ref(database, BRANCH_PATH);
    const duplicateInitial = (await get(branchRef)).val() as RootData | null;
    const duplicateResult = await runTransaction(branchRef, (current: RootData | null) => {
      const root = current ?? structuredClone(duplicateInitial) ?? {};
      const outcome = applyCreate(root, {
        type: 'sale',
        ticketKey: 'ignored-duplicate-key',
        operationId: 'op-sale-1',
        ticket: {},
        actorUid: 'admin',
        actorEmail: 'admin@example.com',
        now: 4,
      });
      return outcome === 'duplicate' ? undefined : root;
    }, { applyLocally: false });
    expect(duplicateResult.committed).toBe(false);
    expect((await get(branchRef)).child('operations/op-sale-1/ticketKey').val()).toBe('sale1');

    const cancelled = await assertSucceeds(transactBranch(database, (root) => {
      applyCancel(root, {
        type: 'import',
        ticketKey: 'ticket1',
        operationId: 'op-cancel-import-1',
        actorUid: 'admin',
        actorEmail: 'admin@example.com',
        reason: 'Kiểm thử hoàn tác',
        now: 5,
      });
    }));
    expect(cancelled.snapshot.child('products/p1/quantity').val()).toBe(3);
    expect(cancelled.snapshot.child('importTickets/ticket1/status').val()).toBe('cancelled');
    expect(
      Object.keys(cancelled.snapshot.child('salesTickets').val() || {}),
    ).toHaveLength(1);
  });

  it('rejects forged actor identity in an operation', async () => {
    await assertFails(set(
      ref(env.authenticatedContext('staff').database(), `${BRANCH_PATH}/operations/forged`),
      {
        action: 'create',
        type: 'import',
        ticketKey: 'forged',
        actorUid: 'admin',
        createdAt: 2,
      },
    ));
  });

  it('prevents a user from elevating their own role', async () => {
    await assertFails(update(
      ref(env.authenticatedContext('staff').database(), 'users/staff'),
      { role: 'admin' },
    ));
  });

  it('prevents staff from unlocking self or locking an admin', async () => {
    const database = env.authenticatedContext('staff').database();
    await assertFails(update(ref(database, 'users/staff'), { status: 'active' }));
    await assertFails(update(ref(database, 'users/admin'), { status: 'disabled' }));
  });

  it('prevents an admin from locking self or changing another admin', async () => {
    const database = env.authenticatedContext('admin').database();
    await assertFails(update(ref(database, 'users/admin'), { status: 'disabled' }));
    await assertFails(update(ref(database, 'users/legacyAdmin'), { status: 'disabled' }));
  });

  it('allows an active admin to disable a staff profile without changing its scope', async () => {
    await assertSucceeds(update(
      ref(env.authenticatedContext('admin').database(), 'users/readonly'),
      {
        status: 'disabled',
        statusChangedAt: 2,
        statusChangedByUid: 'admin',
        adminOperations: {
          request1: { action: 'status-disabled', actorUid: 'admin', createdAt: 2 },
        },
      },
    ));
    await assertFails(update(
      ref(env.authenticatedContext('admin').database(), 'users/staff'),
      { companyId: 'company-b' },
    ));
  });

  it('allows an admin to soft-archive and restore staff without deleting the profile', async () => {
    const userRef = ref(env.authenticatedContext('admin').database(), 'users/staff');
    await assertSucceeds(update(userRef, {
      status: 'disabled',
      archived: true,
      archivedAt: 3,
      archivedByUid: 'admin',
    }));
    const archivedUsers = await assertSucceeds(get(query(
      ref(env.authenticatedContext('admin').database(), 'users'),
      orderByChild('scopeKey'),
      equalTo(`${COMPANY}__${BRANCH}`),
    )));
    expect(archivedUsers.child('staff').exists()).toBe(true);
    expect(archivedUsers.child('staff/email').val()).toBe('staff@example.com');
    expect(archivedUsers.child('staff/archived').val()).toBe(true);

    await assertSucceeds(update(userRef, {
      status: 'active',
      archived: false,
      restoredAt: 4,
      restoredByUid: 'admin',
    }));
  });

  it.todo(
    'prevents hard deletion of audit logs while retaining branch-level transactions',
  );
});
