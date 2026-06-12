import { describe, expect, it } from 'vitest';
import { toAircraft } from '../api/flights.js';

// Full 18-element OpenSky state vector (extended=1) with realistic values.
// Indices: 0 icao24, 1 callsign, 5 lon, 6 lat, 7 baro_altitude (m), 8 on_ground,
// 9 velocity (m/s), 10 true_track, 11 vertical_rate (m/s), 14 squawk, 17 category.
function vector(over = {}) {
  const s = new Array(18).fill(null);
  s[0] = 'a1b2c3';
  s[1] = 'UAL123  ';
  s[5] = -122.375;
  s[6] = 37.6189;
  s[7] = 10058.4;
  s[8] = false;
  s[9] = 257.2;
  s[10] = 271.5;
  s[11] = -5.2;
  s[14] = '7700';
  s[17] = 5;
  return Object.assign(s, over);
}

describe('toAircraft (OpenSky state vector -> readsb-ish aircraft)', () => {
  it('maps identity and position fields', () => {
    const a = toAircraft(vector());
    expect(a.hex).toBe('a1b2c3');
    expect(a.flight).toBe('UAL123'); // callsign is trimmed
    expect(a.lat).toBe(37.6189);
    expect(a.lon).toBe(-122.375);
    expect(a.squawk).toBe('7700');
    expect(a.track).toBe(271.5);
  });

  it('converts metric units to the readsb shape (ft / kt / fpm)', () => {
    const a = toAircraft(vector());
    expect(a.alt_baro).toBe(33000); // 10058.4 m -> ft
    expect(a.gs).toBe(500); // 257.2 m/s -> kt
    expect(a.baro_rate).toBe(-1024); // -5.2 m/s -> ft/min
  });

  it("reports 'ground' for on-ground aircraft regardless of altitude", () => {
    expect(toAircraft(vector({ 8: true })).alt_baro).toBe('ground');
  });

  it('passes nulls through instead of fabricating zeros', () => {
    const a = toAircraft(vector({ 1: null, 7: null, 9: null, 10: null, 11: null, 14: null }));
    expect(a.flight).toBeUndefined();
    expect(a.alt_baro).toBeNull();
    expect(a.gs).toBeNull();
    expect(a.track).toBeNull();
    expect(a.baro_rate).toBeNull();
    expect(a.squawk).toBeUndefined();
  });

  it('maps OpenSky integer emitter categories to ADS-B wake codes', () => {
    const cat = (c) => toAircraft(vector({ 17: c })).category;
    expect(cat(2)).toBe('A1'); // light
    expect(cat(5)).toBe('A4');
    expect(cat(8)).toBe('A7'); // rotorcraft
    expect(cat(9)).toBe('B1');
    expect(cat(15)).toBe('B7');
    expect(cat(16)).toBe('C1');
    expect(cat(17)).toBe('C2');
    expect(cat(0)).toBeUndefined(); // "no information"
    expect(cat(1)).toBeUndefined();
    expect(cat(18)).toBeUndefined(); // out of range
    expect(cat(null)).toBeUndefined();
  });

  it('returns null coordinates for missing fixes (filtered upstream)', () => {
    const a = toAircraft(vector({ 5: null, 6: null }));
    expect(a.lat).toBeNull();
    expect(a.lon).toBeNull();
  });
});
