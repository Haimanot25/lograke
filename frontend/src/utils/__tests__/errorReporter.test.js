import { describe, it, expect, beforeEach } from 'vitest';
import { captureError } from '../errorReporter';

describe('captureError', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('queues an error entry with message, stack and page url', () => {
    captureError(new Error('boom'), { page: 'Dashboard' });
    const queue = JSON.parse(sessionStorage.getItem('lograke-error-queue'));
    expect(queue).toHaveLength(1);
    expect(queue[0].message).toBe('boom');
    expect(queue[0].stack).toContain('Error: boom');
    expect(queue[0].page).toBe('Dashboard');
    expect(queue[0].url).toBe(location.href);
    expect(queue[0].ts).toBeTruthy();
  });

  it('handles non-Error values', () => {
    captureError('plain string');
    const queue = JSON.parse(sessionStorage.getItem('lograke-error-queue'));
    expect(queue[0].message).toBe('plain string');
    expect(queue[0].stack).toBe('');
  });

  it('caps the queue at 50 entries (keeps newest)', () => {
    for (let i = 0; i < 60; i++) captureError(new Error(`err-${i}`));
    const queue = JSON.parse(sessionStorage.getItem('lograke-error-queue'));
    expect(queue).toHaveLength(50);
    expect(queue[49].message).toBe('err-59');
    expect(queue[0].message).toBe('err-10');
  });

  it('appends across calls', () => {
    captureError(new Error('one'));
    captureError(new Error('two'));
    const queue = JSON.parse(sessionStorage.getItem('lograke-error-queue'));
    expect(queue.map((e) => e.message)).toEqual(['one', 'two']);
  });
});
