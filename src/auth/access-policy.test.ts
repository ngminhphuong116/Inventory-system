import { describe, expect, it } from 'vitest';
import { canRole, type Capability } from './access-policy';

describe('staff capability matrix', () => {
  it.each<Capability>([
    'viewInventory',
    'printTickets',
    'exportOperationalData',
    'changeFirebaseConfig',
    'createSale',
  ])('allows staff capability %s', (capability) => {
    expect(canRole('staff', capability)).toBe(true);
  });

  it.each<Capability>([
    'manageProducts',
    'createImport',
    'createExport',
    'cancelTickets',
    'viewFinancialDashboard',
    'viewReports',
    'manageAccounts',
  ])('blocks staff capability %s', (capability) => {
    expect(canRole('staff', capability)).toBe(false);
  });

  it('preserves every capability for admin', () => {
    const capabilities: Capability[] = [
      'viewInventory',
      'printTickets',
      'exportOperationalData',
      'changeFirebaseConfig',
      'manageProducts',
      'createImport',
      'createExport',
      'createSale',
      'cancelTickets',
      'viewFinancialDashboard',
      'viewReports',
      'manageAccounts',
    ];
    expect(capabilities.every((capability) => canRole('admin', capability))).toBe(true);
  });
});
