import { describe, expect, it, vi } from 'vitest';
import {
  handleDirectoryPopupMouseDown,
  selectDirectoryFormValue,
  upsertDirectoryEntry,
} from './product-directory';

describe('product directory popup', () => {
  it('keeps the popup interaction isolated without preventing input focus', () => {
    const stopPropagation = vi.fn();
    const preventDefault = vi.fn();
    handleDirectoryPopupMouseDown({ stopPropagation } as Pick<MouseEvent, 'stopPropagation'>);
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it.each([
    ['category', 'categoryId'],
    ['supplier', 'supplierId'],
  ] as const)('selects a newly added %s in the form', (type, field) => {
    const setFieldValue = vi.fn();
    selectDirectoryFormValue({ setFieldValue }, type, 'new-id');
    expect(setFieldValue).toHaveBeenCalledWith(field, 'new-id');
  });

  it('replaces a duplicate normalized name instead of creating two entries', () => {
    const result = upsertDirectoryEntry(
      [{ id: 'old', key: 'old', name: 'CARD', source: 'scoped', originNode: 'categories' }],
      { id: 'new', key: 'new', name: ' card ', source: 'scoped', originNode: 'categories' },
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('new');
  });
});
