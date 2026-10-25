export type AccessRole = 'admin' | 'staff';

export type Capability =
  | 'viewInventory'
  | 'printTickets'
  | 'exportOperationalData'
  | 'changeFirebaseConfig'
  | 'manageProducts'
  | 'createImport'
  | 'createExport'
  | 'createSale'
  | 'cancelTickets'
  | 'viewFinancialDashboard'
  | 'viewReports'
  | 'manageAccounts';

const STAFF_CAPABILITIES = new Set<Capability>([
  'viewInventory',
  'printTickets',
  'exportOperationalData',
  'changeFirebaseConfig',
  'createSale',
]);

export function canRole(role: AccessRole, capability: Capability): boolean {
  return role === 'admin' || STAFF_CAPABILITIES.has(capability);
}
