import { describe, it, expect } from 'vitest';
import { escapeForRegex, patternToRegex } from '../pattern';

describe('escapeForRegex', () => {
  it('escapes regex metacharacters', () => {
    const input = 'a+b*c?(x)[y]{z}.^$|\\';
    const escaped = escapeForRegex(input);
    expect(new RegExp(escaped).test(input)).toBe(true);
  });

  it('leaves plain text untouched', () => {
    expect(escapeForRegex('connection failed')).toBe('connection failed');
  });
});

describe('patternToRegex', () => {
  it('turns <placeholders> into wildcards', () => {
    const re = new RegExp(`^${patternToRegex('Connection from <IP> refused')}$`);
    expect(re.test('Connection from 10.0.0.1 refused')).toBe(true);
    expect(re.test('Connection from host-7 refused')).toBe(true);
    expect(re.test('Connection from  refused')).toBe(true); // .* matches empty
  });

  it('escapes metacharacters outside placeholders', () => {
    const re = new RegExp(`^${patternToRegex('value=(<v>) [ok]')}$`);
    expect(re.test('value=(42) [ok]')).toBe(true);
    // [ok] must be literal, not a character class
    expect(re.test('value=(42) o')).toBe(false);
  });

  it('supports multiple placeholders', () => {
    const re = new RegExp(`^${patternToRegex('<user> logged in from <ip>')}$`);
    expect(re.test('alice logged in from 192.168.1.5')).toBe(true);
  });
});
