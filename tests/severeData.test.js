import { describe, expect, it } from 'vitest';
import {
  severeFeaturesToEntities,
  severeAlertItem,
} from '../src/services/severeData';

// A 2°×2° square ring ([-100,40] → [-98,42]); its centroid is the middle,
// ~[-99, 41], regardless of whether turf excludes the wrap coordinate.
const square = () => ({
  type: 'Polygon',
  coordinates: [[[-100, 40], [-98, 40], [-98, 42], [-100, 42], [-100, 40]]],
});

// areaDesc long enough to exercise the ~140-char truncation.
const LONG_AREA =
  'Polk, IA; Story, IA; Dallas, IA; Jasper, IA; Marshall, IA; Boone, IA; ' +
  'Warren, IA; Madison, IA; Marion, IA; Guthrie, IA; Hardin, IA; Hamilton, IA';

const feature = (event, over = {}) => ({
  type: 'Feature',
  geometry: over.geometry !== undefined ? over.geometry : square(),
  properties: {
    id: `urn:oid:${event}`,
    event,
    headline: `${event} issued for central Iowa`,
    areaDesc: LONG_AREA,
    severity: 'Severe',
    expires: '2026-06-12T22:30:00-05:00',
    senderName: 'NWS Des Moines IA',
    ...over.properties,
  },
});

const fc = {
  type: 'FeatureCollection',
  features: [
    feature('Tornado Warning'),
    feature('Tornado Watch', { geometry: null }), // zone-based — must be dropped
    feature('Severe Thunderstorm Warning'),
    feature('Flash Flood Warning'),
  ],
};

const entities = severeFeaturesToEntities(fc);
const byEvent = (e) => entities.find((x) => x.meta.event === e);

describe('severeFeaturesToEntities', () => {
  it('returns [] for empty / malformed input', () => {
    expect(severeFeaturesToEntities(null)).toEqual([]);
    expect(severeFeaturesToEntities({})).toEqual([]);
    expect(severeFeaturesToEntities({ features: 'nope' })).toEqual([]);
  });

  it('skips features with null geometry (zone-based watches)', () => {
    // 4 features in, but the geometry-less Tornado Watch is dropped.
    expect(entities).toHaveLength(3);
    expect(entities.map((e) => e.meta.event)).not.toContain('Tornado Watch');
  });

  it('derives a centroid inside the polygon for lat/lng', () => {
    const e = byEvent('Tornado Warning');
    expect(Number.isFinite(e.lat) && Number.isFinite(e.lng)).toBe(true);
    expect(e.lng).toBeCloseTo(-99, 0);
    expect(e.lat).toBeCloseTo(41, 0);
  });

  it('attaches the raw geometry and core metadata', () => {
    const e = byEvent('Tornado Warning');
    expect(e.layer).toBe('severe');
    expect(e.id).toBe('urn:oid:Tornado Warning');
    expect(e.geometry).toEqual(square());
    expect(e.meta.headline).toBe('Tornado Warning issued for central Iowa');
    expect(e.meta.severity).toBe('Severe');
    expect(e.meta.office).toBe('NWS Des Moines IA');
  });

  it('truncates a long areaDesc to ~140 chars with an ellipsis', () => {
    const e = byEvent('Tornado Warning');
    expect(LONG_AREA.length).toBeGreaterThan(140);
    expect(e.meta.area.length).toBeLessThanOrEqual(140);
    expect(e.meta.area.endsWith('…')).toBe(true);
  });

  it('formats expiry into a local string (not the raw ISO), and — when absent', () => {
    const e = byEvent('Tornado Warning');
    expect(typeof e.meta.expires).toBe('string');
    expect(e.meta.expires).not.toBe('—');
    expect(e.meta.expires).not.toContain('T'); // no longer an ISO timestamp
    const noExpiry = severeFeaturesToEntities({
      type: 'FeatureCollection',
      features: [feature('Tornado Warning', { properties: { expires: undefined } })],
    })[0];
    expect(noExpiry.meta.expires).toBe('—');
  });

  it('carries the three reference links on every entity', () => {
    const labels = byEvent('Flash Flood Warning').meta._links.map((l) => l.label);
    expect(labels).toEqual([
      'Storm Prediction Center',
      'NWS radar',
      'IEM warnings map',
    ]);
  });
});

describe('severeAlertItem (tornado-only drawer feed)', () => {
  it('maps a Tornado Warning to a level-2 drawer item', () => {
    const item = severeAlertItem(byEvent('Tornado Warning'));
    expect(item).toMatchObject({
      layerId: 'severe',
      level: 2,
      zoom: 7,
      id: 'urn:oid:Tornado Warning',
    });
    expect(item.name).toBe(byEvent('Tornado Warning').meta.area);
    expect(item.timeframe.startsWith('until ')).toBe(true);
    expect(item.entity).toBe(byEvent('Tornado Warning'));
  });

  it('maps a Tornado Watch (when it carries geometry) to level 1', () => {
    const watch = severeFeaturesToEntities({
      type: 'FeatureCollection',
      features: [feature('Tornado Watch')], // geometry present this time
    })[0];
    expect(severeAlertItem(watch).level).toBe(1);
  });

  it('drops non-tornado products from the drawer (still on the map)', () => {
    expect(severeAlertItem(byEvent('Severe Thunderstorm Warning'))).toBeNull();
    expect(severeAlertItem(byEvent('Flash Flood Warning'))).toBeNull();
  });
});
