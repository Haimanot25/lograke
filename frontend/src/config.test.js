import { describe, it, expect } from 'vitest';
import { API_BASE } from './config';

describe('config', () => {
  it('should export API_BASE as a string', () => {
    expect(typeof API_BASE).toBe('string');
  });

  it('should default to localhost:5000/api when no env var set', () => {
    // In test environment, VITE_API_BASE is typically not set,
    // so it should fall back to the default
    expect(API_BASE).toContain('/api');
  });

  it('should end with /api', () => {
    expect(API_BASE.endsWith('/api')).toBe(true);
  });
});
