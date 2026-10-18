import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useChartData } from '../useChartData';

const ok = (data) => ({ ok: true, json: async () => data });

describe('useChartData', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches all paths in parallel and returns parsed results in order', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ n: 1 }))
      .mockResolvedValueOnce(ok({ n: 2 }));

    const { result } = renderHook(() =>
      useChartData('file-1', (id) => [`/logs/${id}/a`, `/logs/${id}/b`])
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.results).toEqual([{ n: 1 }, { n: 2 }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain('/logs/file-1/a');
    expect(fetchMock.mock.calls[1][0]).toContain('/logs/file-1/b');
  });

  it('does not fetch without a fileId', () => {
    const { result } = renderHook(() => useChartData(null, (id) => [`/logs/${id}/a`]));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);
  });

  it('surfaces HTTP errors instead of parsing error bodies', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    const { result } = renderHook(() =>
      useChartData('file-1', (id) => [`/logs/${id}/a`])
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('HTTP 500');
    expect(result.current.results).toBeNull();
  });

  it('keeps results null and reports error when any request in the batch fails', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ n: 1 }))
      .mockResolvedValueOnce({ ok: false, status: 404 });

    const { result } = renderHook(() =>
      useChartData('file-1', (id) => [`/logs/${id}/a`, `/logs/${id}/b`])
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('HTTP 404');
    expect(result.current.results).toBeNull();
  });
});
