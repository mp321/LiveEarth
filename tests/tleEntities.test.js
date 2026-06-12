import { describe, expect, it } from 'vitest';
import { looksLikeTle, tleToEntities } from '../src/services/globalStreams';

// Canonical ISS element set (the satellite.js README example). Epoch is 2019
// day 156.509 ≈ 2019-06-05 12:13 UTC; propagation is evaluated at that moment
// so the test is deterministic and numerically stable.
const ISS_TLE =
  'ISS (ZARYA)\n' +
  '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992\n' +
  '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442\n';

const EPOCH = new Date(Date.UTC(2019, 5, 5, 12, 13, 0));

const MALFORMED_TRIPLE =
  'BROKEN OBJECT\n' +
  '1 THIS IS NOT A VALID TLE LINE\n' +
  '2 ALSO NOT VALID\n';

describe('tleToEntities', () => {
  it('propagates a valid TLE triple to a plausible geodetic position', () => {
    const out = tleToEntities(ISS_TLE, EPOCH);
    expect(out).toHaveLength(1);
    const sat = out[0];
    expect(sat.id).toBe('25544');
    expect(sat.label).toBe('ISS (ZARYA)');
    expect(sat.layer).toBe('satellites');
    // Latitude bounded by the 51.64° inclination; ISS orbits at ~400 km
    // moving ~7.7 km/s.
    expect(Math.abs(sat.lat)).toBeLessThanOrEqual(51.7);
    expect(sat.lng).toBeGreaterThanOrEqual(-180);
    expect(sat.lng).toBeLessThanOrEqual(180);
    expect(sat.altitude_km).toBeGreaterThan(300);
    expect(sat.altitude_km).toBeLessThan(500);
    expect(sat.meta.norad_id).toBe('25544');
    expect(sat.meta.velocity_kms).toBeGreaterThan(7);
    expect(sat.meta.velocity_kms).toBeLessThan(8);
  });

  it('skips malformed triples without losing the rest of the catalog', () => {
    const out = tleToEntities(MALFORMED_TRIPLE + ISS_TLE, EPOCH);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('25544');
  });

  it('returns [] for empty input', () => {
    expect(tleToEntities('', EPOCH)).toEqual([]);
    expect(tleToEntities(null, EPOCH)).toEqual([]);
  });

  it('caps the catalog at 500 satellites', () => {
    const big = ISS_TLE.repeat(502);
    expect(tleToEntities(big, EPOCH)).toHaveLength(500);
  });
});

describe('looksLikeTle', () => {
  it('accepts a body shaped like a TLE catalog', () => {
    expect(looksLikeTle(ISS_TLE)).toBe(true);
  });

  it('rejects HTML, error prose, and empty bodies', () => {
    expect(looksLikeTle('<!doctype html><html><body>app</body></html>')).toBe(false);
    expect(looksLikeTle('Rate limit exceeded\nplease retry later\nthanks')).toBe(false);
    expect(looksLikeTle('')).toBe(false);
    expect(looksLikeTle(null)).toBe(false);
  });
});
