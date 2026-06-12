import { describe, expect, it } from 'vitest';
import { entitiesToGeoJSON } from '../src/services/globalStreams';

const entity = (over = {}) => ({
  id: 'x1',
  lat: 39.5,
  lng: -106.1,
  label: 'Thing',
  layer: 'demo',
  meta: {},
  ...over,
});

describe('entitiesToGeoJSON', () => {
  it('returns an empty FeatureCollection for null or empty input', () => {
    expect(entitiesToGeoJSON(null)).toEqual({ type: 'FeatureCollection', features: [] });
    expect(entitiesToGeoJSON(undefined).features).toEqual([]);
    expect(entitiesToGeoJSON([]).features).toEqual([]);
  });

  it('filters out entities without finite coordinates', () => {
    const fc = entitiesToGeoJSON([
      entity({ id: 'ok' }),
      entity({ id: 'nan-lat', lat: NaN }),
      entity({ id: 'missing-lng', lng: undefined }),
      entity({ id: 'string-lat', lat: '39.5' }),
      entity({ id: 'null-lng', lng: null }),
    ]);
    expect(fc.features.map((f) => f.properties.id)).toEqual(['ok']);
  });

  it('emits Point geometry as [lng, lat]', () => {
    const fc = entitiesToGeoJSON([entity({ lat: 37.63, lng: -119.03 })]);
    expect(fc.features[0].geometry).toEqual({
      type: 'Point',
      coordinates: [-119.03, 37.63],
    });
  });

  it('promotes styling fields from meta / entity to top-level properties', () => {
    const fc = entitiesToGeoJSON([
      entity({
        kind: 'military',
        altitude_km: 420,
        alertLevel: 2,
        meta: { heading_deg: 271.5, magnitude: 4.6 },
      }),
    ]);
    const p = fc.features[0].properties;
    expect(p.kind).toBe('military');
    expect(p.heading).toBe(271.5);
    expect(p.magnitude).toBe(4.6);
    expect(p.altitude_km).toBe(420);
    expect(p.alertLevel).toBe(2);
  });

  it('prefers meta.pm25 over meta.value for the generic value property', () => {
    const both = entitiesToGeoJSON([entity({ meta: { pm25: 12.3, value: 99 } })]);
    expect(both.features[0].properties.value).toBe(12.3);
    const valueOnly = entitiesToGeoJSON([entity({ meta: { value: 7 } })]);
    expect(valueOnly.features[0].properties.value).toBe(7);
  });

  it('defaults promoted fields when meta is empty or invalid', () => {
    const p = entitiesToGeoJSON([entity({ meta: { heading_deg: 'north' } })])
      .features[0].properties;
    expect(p.kind).toBe('');
    expect(p.heading).toBe(0);
    expect(p.magnitude).toBe(0);
    expect(p.value).toBe(0);
    expect(p.altitude_km).toBe(0);
    expect(p.alertLevel).toBe(0);
  });

  it('round-trips the full entity through the _entity property', () => {
    const e = entity({ meta: { wave_height_ft: 4.9, _links: [{ label: 'a', url: 'b' }] } });
    const fc = entitiesToGeoJSON([e]);
    expect(JSON.parse(fc.features[0].properties._entity)).toEqual(e);
  });
});
