import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAriaId } from '../useAccessibility';

describe('useAriaId', () => {
  it('should generate an id with the given prefix', () => {
    const { result } = renderHook(() => useAriaId('test'));
    expect(result.current).toMatch(/^test-/);
  });

  it('should return stable id across re-renders', () => {
    const { result, rerender } = renderHook(() => useAriaId('stable'));
    const id1 = result.current;
    rerender();
    expect(result.current).toBe(id1);
  });

  it('should generate unique ids for different instances', () => {
    const { result: r1 } = renderHook(() => useAriaId('a'));
    const { result: r2 } = renderHook(() => useAriaId('a'));
    expect(r1.current).not.toBe(r2.current);
  });
});