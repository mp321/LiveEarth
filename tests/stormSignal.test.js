import { describe, expect, it } from 'vitest';
import { stormSignalFrom } from '../src/services/snowData';

// 16 consecutive ISO days starting 2026-06-12 (so index 4 = Jun 16, the first
// day of the low-confidence model-outlook range).
const DAYS = Array.from({ length: 16 }, (_, i) => `2026-06-${String(12 + i).padStart(2, '0')}`);

const series = (spec = {}) => {
  const daily = new Array(16).fill(0);
  for (const [idx, cm] of Object.entries(spec)) daily[Number(idx)] = cm;
  return daily;
};

describe('stormSignalFrom (3-day rolling window over days 5–16)', () => {
  it('returns null when no window reaches the 30 cm threshold', () => {
    expect(stormSignalFrom(DAYS, series())).toBeNull();
    expect(stormSignalFrom(DAYS, series({ 5: 10, 6: 10, 7: 9.9 }))).toBeNull();
  });

  it('ignores heavy snow inside the trusted 7-day forecast range (days 1–4)', () => {
    // 120 cm across days 1-3 — but windows only start at index 4 (day 5).
    expect(stormSignalFrom(DAYS, series({ 0: 40, 1: 40, 2: 40 }))).toBeNull();
  });

  it('flags a window totaling exactly 30 cm (inclusive threshold)', () => {
    const signal = stormSignalFrom(DAYS, series({ 5: 12, 6: 10, 7: 8 }));
    expect(signal).toEqual({ totalCm: 30, window: 'Jun 17–Jun 19' });
  });

  it('reports the heaviest window when several qualify', () => {
    const signal = stormSignalFrom(
      DAYS,
      series({ 4: 12, 5: 12, 6: 12, 10: 20, 11: 20, 12: 20 })
    );
    expect(signal.totalCm).toBe(60);
    expect(signal.window).toBe('Jun 22–Jun 24');
  });

  it('only considers windows that fit fully inside the series', () => {
    // 29 cm on the final day: the last valid window (indices 13-15) sums to 29
    // and no window may start past index 13.
    expect(stormSignalFrom(DAYS, series({ 15: 29 }))).toBeNull();
    // ...but 30+ inside that final window is flagged.
    const signal = stormSignalFrom(DAYS, series({ 13: 10, 14: 10, 15: 10 }));
    expect(signal).toEqual({ totalCm: 30, window: 'Jun 25–Jun 27' });
  });
});
