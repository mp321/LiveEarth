import { describe, expect, it } from 'vitest';
import {
  parseExtremes,
  parseCurve,
  parseObservedNow,
  curveFromExtremes,
  interpolateNow,
  computeTrend,
  nearestStation,
} from '../src/services/tideData';

const H = 60 * 60 * 1000; // one hour in ms (the timeline unit)

describe('parseExtremes', () => {
  it('maps hi/lo predictions to typed extremes with clock labels', () => {
    const ex = parseExtremes({
      predictions: [
        { t: '2026-06-19 02:48', v: '5.78', type: 'H' },
        { t: '2026-06-19 16:55', v: '-0.827', type: 'L' },
      ],
    });
    expect(ex).toHaveLength(2);
    expect(ex[0]).toMatchObject({ type: 'H', y: 5.78, label: '2:48 AM' });
    expect(ex[1]).toMatchObject({ type: 'L', label: '4:55 PM' });
    expect(ex[1].y).toBeCloseTo(-0.827, 3);
    expect(ex[0].x).toBeLessThan(ex[1].x); // chronological on the timeline
  });

  it('returns [] for a subordinate {error} body or junk', () => {
    expect(parseExtremes({ error: { message: 'no data' } })).toEqual([]);
    expect(parseExtremes(null)).toEqual([]);
  });
});

describe('parseCurve', () => {
  it('maps the 30-min harmonic curve to {x,y} points', () => {
    const c = parseCurve({
      predictions: [
        { t: '2026-06-19 00:00', v: '4.244' },
        { t: '2026-06-19 00:30', v: '4.652' },
      ],
    });
    expect(c).toHaveLength(2);
    expect(c[0].y).toBeCloseTo(4.244, 3);
    expect(c[1].x).toBeGreaterThan(c[0].x);
  });

  it('returns [] when the curve is unavailable (subordinate station)', () => {
    expect(parseCurve({ error: { message: 'No Predictions data' } })).toEqual([]);
  });
});

describe('parseObservedNow', () => {
  it('takes the LATEST numeric water level and marks it observed', () => {
    const now = parseObservedNow({
      data: [
        { t: '2026-06-19 00:00', v: '4.68' },
        { t: '2026-06-19 00:06', v: '4.75' },
      ],
    });
    expect(now).toMatchObject({ observed: true });
    expect(now.y).toBeCloseTo(4.75, 2);
  });

  it('skips a trailing blank value instead of forging a 0 ft reading', () => {
    const now = parseObservedNow({
      data: [
        { t: '2026-06-19 00:00', v: '4.68' },
        { t: '2026-06-19 00:06', v: '' },
      ],
    });
    expect(now.y).toBeCloseTo(4.68, 2);
  });

  it('returns null on a sensorless {error} body', () => {
    expect(parseObservedNow({ error: { message: 'no MLLW' } })).toBeNull();
  });
});

describe('curveFromExtremes (half-cosine synthesis)', () => {
  const ext = [
    { type: 'L', x: 0, y: 0 },
    { type: 'H', x: 100, y: 4 },
  ];

  it('passes EXACTLY through the first and last dots', () => {
    const c = curveFromExtremes(ext, 25);
    expect(c[0]).toEqual({ x: 0, y: 0 });
    expect(c[c.length - 1]).toEqual({ x: 100, y: 4 });
  });

  it('puts the half-cosine midpoint at the mean of the two dots', () => {
    const mid = curveFromExtremes(ext, 25).find((p) => p.x === 50);
    expect(mid.y).toBeCloseTo(2, 6); // (0 + 4) / 2
  });

  it('passes through an interior dot across multiple segments', () => {
    const c = curveFromExtremes(
      [
        { type: 'L', x: 0, y: 0 },
        { type: 'H', x: 100, y: 4 },
        { type: 'L', x: 200, y: 1 },
      ],
      50
    );
    expect(c.find((p) => p.x === 100)).toEqual({ x: 100, y: 4 });
    expect(c[c.length - 1]).toEqual({ x: 200, y: 1 });
  });

  it('returns [] with fewer than two extremes', () => {
    expect(curveFromExtremes([{ type: 'H', x: 0, y: 1 }])).toEqual([]);
    expect(curveFromExtremes([])).toEqual([]);
  });
});

describe('interpolateNow (predicted now + clamp)', () => {
  const curve = [
    { x: 0, y: 0 },
    { x: 100, y: 10 },
  ];

  it('linearly interpolates inside the curve', () => {
    expect(interpolateNow(curve, 50)).toEqual({ x: 50, y: 5, observed: false });
  });

  it('clamps to the curve ends outside the domain', () => {
    expect(interpolateNow(curve, -10)).toEqual({ x: 0, y: 0, observed: false });
    expect(interpolateNow(curve, 200)).toEqual({ x: 100, y: 10, observed: false });
  });

  it('returns null for an empty curve', () => {
    expect(interpolateNow([], 50)).toBeNull();
  });
});

describe('computeTrend (next-extreme trend + countdown)', () => {
  const ext = [
    { type: 'H', x: 2 * H, y: 5 },
    { type: 'L', x: 8 * H, y: 1 },
  ];

  it('reads rising when the next extreme is a High', () => {
    expect(computeTrend(ext, 0)).toEqual({
      trend: 'rising',
      nextTurn: { type: 'high', height: 5, etaMinutes: 120 },
    });
  });

  it('reads falling when the next extreme is a Low', () => {
    expect(computeTrend(ext, 3 * H)).toEqual({
      trend: 'falling',
      nextTurn: { type: 'low', height: 1, etaMinutes: 300 },
    });
  });

  it('is null once now is past the last extreme', () => {
    expect(computeTrend(ext, 9 * H)).toEqual({ trend: null, nextTurn: null });
  });
});

describe('nearestStation (turf miles + caller threshold)', () => {
  const stations = [
    { id: 'SF', name: 'San Francisco', lat: 37.806, lng: -122.466, type: 'R' },
    { id: 'EUR', name: 'Eureka', lat: 40.806, lng: -124.16, type: 'S' },
  ];

  it('picks the closest station and reports the distance in miles', () => {
    const near = nearestStation(37.75, -122.84, stations); // off the Golden Gate
    expect(near.station.id).toBe('SF');
    expect(near.distanceMi).toBeGreaterThan(0);
    expect(near.distanceMi).toBeLessThan(25); // within the offshore cutoff
  });

  it('reports a large distance a caller would treat as offshore (> 25 mi)', () => {
    const near = nearestStation(0, 0, stations); // mid-Atlantic — nothing near
    expect(near.distanceMi).toBeGreaterThan(25);
  });

  it('returns null with no stations', () => {
    expect(nearestStation(37.75, -122.84, [])).toBeNull();
  });
});
