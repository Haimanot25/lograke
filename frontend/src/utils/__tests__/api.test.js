import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchJSON } from '../api';

// Mock global fetch
const mockFetch = vi.fn();
// @ts-ignore
globalThis.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

describe('fetchJSON', () => {
  it('should return parsed JSON on success', async () => {
    const mockData = { logs: [], total: 0 };
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    });

    const result = await fetchJSON('/api/logs/1');
    expect(result).toEqual(mockData);
    expect(mockFetch).toHaveBeenCalledWith('/api/logs/1', {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });
  });

  it('should throw on non-ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });

    await expect(fetchJSON('/api/error')).rejects.toThrow('HTTP 500');
  });

  it('should include custom headers', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await fetchJSON('/api/test', {
      headers: { Authorization: 'Bearer token123' },
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/test', {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token123',
      },
    });
  });

  it('should pass through POST options', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });

    await fetchJSON('/api/upload', {
      method: 'POST',
      body: JSON.stringify({ name: 'test' }),
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/upload', {
      credentials: 'include',
      method: 'POST',
      body: JSON.stringify({ name: 'test' }),
      headers: { 'Content-Type': 'application/json' },
    });
  });
});
