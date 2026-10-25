import { beforeEach, describe, expect, it, vi } from 'vitest';

const { subscribeBranchNode } = vi.hoisted(() => ({
  subscribeBranchNode: vi.fn(),
}));

vi.mock('../services/realtime-inventory', () => ({
  getWarehouseScope: vi.fn(),
  realtimeInventory: {},
  subscribeBranchNode,
  subscribeScopedUsers: vi.fn(),
}));

import { dbService } from './Db';

describe('database subscription errors', () => {
  beforeEach(() => {
    subscribeBranchNode.mockReset();
    subscribeBranchNode.mockReturnValue(() => undefined);
  });

  it('forwards product permission errors without replacing data with an empty list', () => {
    const onData = vi.fn();
    const onError = vi.fn();
    const permissionError = new Error('permission-denied');

    dbService.onProducts(onData, onError);
    const forwardedError = subscribeBranchNode.mock.calls[0][2] as (error: Error) => void;
    forwardedError(permissionError);

    expect(onError).toHaveBeenCalledWith(permissionError);
    expect(onData).not.toHaveBeenCalled();
  });

  it('forwards ticket permission errors without reporting No data', () => {
    const onData = vi.fn();
    const onError = vi.fn();
    const permissionError = new Error('permission-denied');

    dbService.onSalesTickets(onData, false, onError);
    const forwardedError = subscribeBranchNode.mock.calls[0][2] as (error: Error) => void;
    forwardedError(permissionError);

    expect(onError).toHaveBeenCalledWith(permissionError);
    expect(onData).not.toHaveBeenCalled();
  });
});
