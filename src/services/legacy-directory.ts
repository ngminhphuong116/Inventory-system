import { assertValidPathSegment, normalizeOptionalText } from './data-integrity';

export type DirectorySource = 'legacy-root' | 'scoped' | 'embedded-product';
export type DirectoryKind = 'category' | 'supplier';

export interface DirectoryItem {
  id: string;
  key: string;
  name: string;
  source: DirectorySource;
  originNode: 'categories' | 'productCategories' | 'suppliers' | 'partners' | 'products';
  legacyValue?: boolean;
  legacyIds?: string[];
  status?: string;
  archived?: boolean;
  createdAt?: number;
}

const nameFields: Record<DirectoryKind, string[]> = {
  category: ['name', 'categoryName', 'category', 'label', 'title'],
  supplier: ['name', 'supplierName', 'supplier', 'partnerName', 'partner', 'label', 'title'],
};

export const normalizeDirectoryNameKey = (value: unknown) =>
  normalizeOptionalText(value, 200)
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('vi-VN');

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function validId(value: unknown, fallbackSeed: string) {
  try {
    return assertValidPathSegment(value, 'directoryId');
  } catch {
    return `legacy-${stableHash(fallbackSeed)}`;
  }
}

function optionalValidId(value: unknown) {
  try {
    return assertValidPathSegment(value, 'directoryId');
  } catch {
    return '';
  }
}

function directoryIdentity(
  record: Record<string, unknown>,
  kind: DirectoryKind,
  snapshotKey: string,
  fallbackSeed: string,
) {
  const canonicalSnapshotId = optionalValidId(snapshotKey);
  const explicitIds = [
    record.id,
    kind === 'supplier' ? record.supplierId : record.categoryId,
    record.key,
  ]
    .map(optionalValidId)
    .filter(Boolean);
  const id = canonicalSnapshotId || explicitIds[0] || validId(undefined, fallbackSeed);
  const legacyIds = [...new Set(explicitIds.filter((candidate) => candidate !== id))];
  return { id, legacyIds };
}

function valueName(value: unknown, kind: DirectoryKind, fallbackKey = '') {
  if (typeof value === 'string') return normalizeOptionalText(value, 200);
  if (!value || typeof value !== 'object') {
    return value === true ? normalizeOptionalText(fallbackKey, 200) : '';
  }
  const record = value as Record<string, unknown>;
  for (const field of nameFields[kind]) {
    const candidate = normalizeOptionalText(record[field], 200);
    if (candidate) return candidate;
  }
  return '';
}

function isSingleDirectoryRecord(value: unknown, kind: DirectoryKind) {
  if (!value || Array.isArray(value) || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return nameFields[kind].some((field) => normalizeOptionalText(record[field], 200));
}

export function adaptDirectoryNode(
  raw: unknown,
  kind: DirectoryKind,
  source: Exclude<DirectorySource, 'embedded-product'>,
  originNode: DirectoryItem['originNode'],
): DirectoryItem[] {
  if (raw == null) return [];
  const singleRecord = isSingleDirectoryRecord(raw, kind);
  const collection = !singleRecord && typeof raw === 'object';
  const entries: Array<[string, unknown]> = singleRecord
    ? [['', raw]]
    : collection
      ? Object.entries(raw as Record<string, unknown>)
      : [['', raw]];

  return entries.flatMap(([key, value]) => {
    const name = valueName(value, kind, key);
    if (!name) return [];
    const record = value && typeof value === 'object'
      ? value as Record<string, unknown>
      : {};
    const { id, legacyIds } = directoryIdentity(
      record,
      kind,
      collection ? key : '',
      `${originNode}:${key}:${name}`,
    );
    const status = normalizeOptionalText(record.status, 50).toLocaleLowerCase('vi-VN') || 'active';
    const createdAt = Number(record.createdAt);
    return [{
      id,
      key: id,
      name,
      source,
      originNode,
      legacyValue: typeof value === 'string' || !optionalValidId(record.id),
      ...(legacyIds.length ? { legacyIds } : {}),
      status,
      archived: record.archived === true,
      ...(Number.isFinite(createdAt) ? { createdAt } : {}),
    }];
  });
}

export function adaptEmbeddedProductDirectories(
  rawProducts: unknown,
  kind: DirectoryKind,
): DirectoryItem[] {
  if (!rawProducts || typeof rawProducts !== 'object') return [];
  return Object.entries(rawProducts as Record<string, unknown>).flatMap(([productKey, value]) => {
    if (!value || typeof value !== 'object') return [];
    const product = value as Record<string, unknown>;
    const name = kind === 'category'
      ? valueName({ categoryName: product.categoryName, category: product.category }, kind)
      : valueName({ supplierName: product.supplierName, supplier: product.supplier }, kind);
    if (!name) return [];
    const explicitId = kind === 'category' ? product.categoryId : product.supplierId;
    const id = validId(
      explicitId,
      `embedded:${kind}:${productKey}:${normalizeDirectoryNameKey(name)}`,
    );
    return [{
      id,
      key: id,
      name,
      source: 'embedded-product',
      originNode: 'products',
      legacyValue: !explicitId,
      status: 'active',
      archived: false,
    }];
  });
}

export function supplierNameFromRecord(value: unknown) {
  return valueName(value, 'supplier');
}

export function resolveSupplierReference(
  value: unknown,
  suppliers: DirectoryItem[],
): { supplierId?: string; supplierName: string } {
  const record = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  const requestedId = optionalValidId(record.supplierId);
  const supplier = requestedId
    ? suppliers.find(
        (entry) => entry.id === requestedId || entry.legacyIds?.includes(requestedId),
      )
    : undefined;
  return {
    ...(supplier ? { supplierId: supplier.id } : {}),
    supplierName: supplier?.name || supplierNameFromRecord(value),
  };
}

export function mergeDirectoryItems(...groups: DirectoryItem[][]): DirectoryItem[] {
  const byName = new Map<string, DirectoryItem>();
  for (const group of groups) {
    for (const item of group) {
      const normalizedName = normalizeDirectoryNameKey(item.name);
      if (normalizedName && !byName.has(normalizedName)) {
        byName.set(normalizedName, item);
      }
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}

export function adaptDirectorySources(input: {
  kind: DirectoryKind;
  source: Exclude<DirectorySource, 'embedded-product'>;
  primary: unknown;
  alias: unknown;
  products: unknown;
}): DirectoryItem[] {
  const primaryNode = input.kind === 'category' ? 'categories' : 'suppliers';
  const aliasNode = input.kind === 'category' ? 'productCategories' : 'partners';
  return mergeDirectoryItems(
    adaptDirectoryNode(input.primary, input.kind, input.source, primaryNode),
    adaptDirectoryNode(input.alias, input.kind, input.source, aliasNode),
    adaptEmbeddedProductDirectories(input.products, input.kind),
  );
}
