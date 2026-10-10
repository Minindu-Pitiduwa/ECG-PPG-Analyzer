import { describe, expect, it } from 'vitest';
import { decimalsForStep, formatDuration, formatTime, formatValue } from '@/lib/format';

describe('formatTime', () => {
  it('shows whole seconds by default', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(75)).toBe('1:15');
  });

  it('adds the requested decimals', () => {
    expect(formatTime(75.25, 1)).toBe('1:15.3');
    expect(formatTime(75.25, 2)).toBe('1:15.25');
    expect(formatTime(5.1234, 3)).toBe('0:05.123');
  });

  it('carries into the minutes instead of showing 60 seconds', () => {
    expect(formatTime(59.9999, 2)).toBe('1:00.00');
    expect(formatTime(119.6)).toBe('2:00');
  });
});

describe('decimalsForStep', () => {
  it('needs no decimals for whole-second steps', () => {
    expect(decimalsForStep(1)).toBe(0);
    expect(decimalsForStep(30)).toBe(0);
    expect(decimalsForStep(2.5)).toBe(1);
  });

  it('adds just enough decimals for sub-second steps', () => {
    expect(decimalsForStep(0.5)).toBe(1);
    expect(decimalsForStep(0.1)).toBe(1);
    expect(decimalsForStep(0.25)).toBe(2);
    expect(decimalsForStep(0.05)).toBe(2);
    expect(decimalsForStep(0.002)).toBe(3);
  });

  it('caps at milliseconds and tolerates a zero or invalid step', () => {
    expect(decimalsForStep(0.00001)).toBe(3);
    expect(decimalsForStep(0)).toBe(0);
    expect(decimalsForStep(NaN)).toBe(0);
  });
});

describe('formatDuration', () => {
  it('uses seconds below a minute', () => expect(formatDuration(42.5)).toBe('42.5 s'));
  it('uses minutes and seconds above', () => {
    expect(formatDuration(300)).toBe('5 min');
    expect(formatDuration(90)).toBe('1 min 30 s');
  });
});

describe('formatValue', () => {
  it('scales the digits with the magnitude', () => {
    expect(formatValue(0.12345)).toBe('0.123');
    expect(formatValue(-12.345)).toBe('-12.3');
    expect(formatValue(2048)).toBe('2048');
  });
  it('shows a dash for non-finite values', () => expect(formatValue(NaN)).toBe('–'));
});
