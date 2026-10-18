import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { FIELD_COLORS, FIELD_TYPES, getFieldColor, extractGroupPattern } from '../parserConstants';
import { HighlightedLine } from '../parserHelpers';

describe('parserConstants', () => {
  it('exposes the field color/type palettes', () => {
    expect(FIELD_COLORS.length).toBeGreaterThan(0);
    expect(FIELD_TYPES).toContain('ip');
    expect(FIELD_TYPES).toContain('level');
  });

  it('getFieldColor wraps around the palette', () => {
    expect(getFieldColor(0)).toBe(FIELD_COLORS[0]);
    expect(getFieldColor(FIELD_COLORS.length)).toBe(FIELD_COLORS[0]);
    expect(getFieldColor(FIELD_COLORS.length + 2)).toBe(FIELD_COLORS[2]);
  });

  it('extractGroupPattern returns the full named group including nested parens', () => {
    const re = String.raw`^(?<ts>\d{4}-\d{2}-\d{2}) (?<msg>failed \((?<code>\d+)\))$`;
    expect(extractGroupPattern(re, 'ts')).toBe('(?<ts>\\d{4}-\\d{2}-\\d{2})');
    expect(extractGroupPattern(re, 'msg')).toBe(String.raw`(?<msg>failed \((?<code>\d+)\))`);
    expect(extractGroupPattern(re, 'code')).toBe(String.raw`(?<code>\d+)`);
  });

  it('extractGroupPattern returns null for missing groups or empty input', () => {
    const re = String.raw`^(?<ts>\d+)$`;
    expect(extractGroupPattern(re, 'nope')).toBeNull();
    expect(extractGroupPattern('', 'ts')).toBeNull();
    expect(extractGroupPattern(null, 'ts')).toBeNull();
  });
});

describe('HighlightedLine', () => {
  const fieldColors = { user: '#22c55e' };

  it('renders a miss line when there are no matched groups', () => {
    const { container } = render(<HighlightedLine line="plain text" matchedGroups={{}} index={0} />);
    expect(container.querySelector('.pl-preview-line-miss')).toBeTruthy();
    expect(container.textContent).toContain('#1: plain text');
  });

  it('truncates long lines at 120 chars', () => {
    const long = 'x'.repeat(200);
    const { container } = render(<HighlightedLine line={long} matchedGroups={{}} index={4} />);
    expect(container.textContent).toContain('#5: ' + 'x'.repeat(120) + '...');
    expect(container.textContent).not.toContain('x'.repeat(121));
  });

  it('highlights matched group values and keeps surrounding text', () => {
    const { container } = render(
      <HighlightedLine line="login user=alice ok" matchedGroups={{ user: 'alice' }} fieldColors={fieldColors} index={1} />
    );
    expect(container.querySelector('.pl-preview-line-match')).toBeTruthy();
    const marks = container.querySelectorAll('mark');
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('alice');
    // jsdom normalizes the 8-digit hex (#22c55e33) to rgba
    expect(marks[0].style.background).toBe('rgba(34, 197, 94, 0.2)');
    expect(container.textContent).toContain('login user=alice ok');
  });

  it('falls back to palette colors when no field color is provided', () => {
    const { container } = render(
      <HighlightedLine line="ip=10.0.0.1" matchedGroups={{ src: '10.0.0.1' }} fieldColors={{}} index={0} />
    );
    const marks = container.querySelectorAll('mark');
    expect(marks).toHaveLength(1);
    expect(marks[0].style.background).toBe('rgba(99, 102, 241, 0.2)'); // FIELD_COLORS[0] with 0x33 alpha
  });

  it('renders a miss line when a matched value is not present in the line', () => {
    const { container } = render(
      <HighlightedLine line="nothing here" matchedGroups={{ user: 'alice' }} fieldColors={fieldColors} index={0} />
    );
    expect(container.querySelector('.pl-preview-line-miss')).toBeTruthy();
  });
});
