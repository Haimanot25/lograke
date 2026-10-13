import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { useUrlState } from '../useUrlState';

describe('useUrlState', () => {
  function wrapper({ children }) {
    return <BrowserRouter>{children}</BrowserRouter>;
  }

  it('should return default value when param is not in URL', () => {
    const { result } = renderHook(() => useUrlState('search', 'default'), { wrapper });
    expect(result.current[0]).toBe('default');
  });

  it('should update value and reflect in URL params', () => {
    const { result } = renderHook(() => useUrlState('filter', ''), { wrapper });
    act(() => { result.current[1]('test-value'); });
    expect(result.current[0]).toBe('test-value');
  });

  it('should clear param when set to default', () => {
    const { result } = renderHook(() => useUrlState('page', 1), { wrapper });
    act(() => { result.current[1](2); });
    expect(result.current[0]).toBe(2);
    act(() => { result.current[1](1); });
    expect(result.current[0]).toBe(1);
  });
});