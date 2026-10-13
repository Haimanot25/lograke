import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import ThemeSwitcher from '../ThemeSwitcher';

describe('ThemeSwitcher', () => {
  it('should render both theme buttons', () => {
    render(<ThemeSwitcher theme="black" onThemeChange={() => {}} />);
    expect(screen.getByLabelText('Black')).toBeInTheDocument();
    expect(screen.getByLabelText('White')).toBeInTheDocument();
  });

  it('should mark active theme as checked', () => {
    render(<ThemeSwitcher theme="white" onThemeChange={() => {}} />);
    expect(screen.getByLabelText('White')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Black')).toHaveAttribute('aria-checked', 'false');
  });

  it('should call onThemeChange when a theme is clicked', () => {
    const onChange = vi.fn();
    render(<ThemeSwitcher theme="black" onThemeChange={onChange} />);
    fireEvent.click(screen.getByLabelText('White'));
    expect(onChange).toHaveBeenCalledWith('white');
  });
});