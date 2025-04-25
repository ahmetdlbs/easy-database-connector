// Mock provider for database tests
export const mockProvider = {
  query: jest.fn().mockResolvedValue([{ id: 1, name: 'Test' }]),
  execute: jest.fn().mockResolvedValue([{ affectedRows: 1 }]),
  queryWithPagination: jest.fn().mockResolvedValue({
    detail: [{ id: 1, name: 'Test' }],
    totalCount: 1,
    pageCount: 1,
    page: '1',
    pageSize: 10
  }),
  transaction: jest.fn().mockImplementation(async (callback) => {
    return callback('tx-mock');
  }),
  close: jest.fn().mockResolvedValue(undefined)
};

// Mock getProvider factory
export const mockGetProvider = jest.fn().mockReturnValue(mockProvider);
