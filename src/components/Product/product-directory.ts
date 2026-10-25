import type { DirectoryType } from '../Db';
import { normalizeDirectoryNameKey } from '../../services/legacy-directory';

export type ProductDirectoryKind = 'category' | 'supplier';

export function handleDirectoryPopupMouseDown(
  event: Pick<MouseEvent, 'stopPropagation'>,
): void {
  event.stopPropagation();
}

export function selectDirectoryFormValue(
  form: { setFieldValue: (name: string, value: string) => void },
  type: ProductDirectoryKind,
  id: string,
): void {
  form.setFieldValue(type === 'category' ? 'categoryId' : 'supplierId', id);
}

export function upsertDirectoryEntry(
  entries: DirectoryType[],
  entry: DirectoryType,
): DirectoryType[] {
  return [
    ...entries.filter(
      (current) =>
        normalizeDirectoryNameKey(current.name) !== normalizeDirectoryNameKey(entry.name),
    ),
    entry,
  ].sort((left, right) => left.name.localeCompare(right.name, 'vi'));
}
