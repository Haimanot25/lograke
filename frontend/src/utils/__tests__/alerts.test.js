import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock document.body.appendChild/removeChild for modal rendering
const mockAppendChild = vi.fn();
const mockRemoveChild = vi.fn();
vi.spyOn(document.body, 'appendChild').mockImplementation(mockAppendChild);
vi.spyOn(document.body, 'removeChild').mockImplementation(mockRemoveChild);

// We need to dynamically import after mocking
describe('showAlert / showConfirm', () => {
  let showAlert, showConfirm;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../alerts.jsx');
    showAlert = mod.showAlert;
    showConfirm = mod.showConfirm;
  });

  it('should export showAlert and showConfirm as functions', () => {
    expect(typeof showAlert).toBe('function');
    expect(typeof showConfirm).toBe('function');
  });

  it('showAlert should return a promise', () => {
    // The promise won't resolve until the modal is clicked, but it should be a promise
    const result = showAlert('Test message');
    expect(result).toBeInstanceOf(Promise);
    // Clean up - we can't easily close the modal in test
    result.catch(() => {}); // prevent unhandled rejection
  });

  it('showConfirm should return a promise', () => {
    const result = showConfirm('Test confirm');
    expect(result).toBeInstanceOf(Promise);
    result.catch(() => {}); // prevent unhandled rejection
  });
});
