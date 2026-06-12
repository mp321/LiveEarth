import { describe, expect, it } from 'vitest';
import { parseNdbcLatestObs } from '../src/services/globalStreams';

// Trimmed-down NDBC latest_obs.txt: line 0 column names, line 1 units, then one
// station per row with 'MM' marking missing values.
const HEADER =
  '#STN     LAT      LON  YYYY MM DD hh mm WDIR WSPD   GST  WVHT   DPD   APD MWD   PRES  PTDY  ATMP  WTMP  DEWP  VIS  TIDE\n' +
  '#text    deg      deg  yr  mo dy hr mn degT m/s   m/s     m   sec   sec degT   hPa   hPa  degC  degC  degC  nmi    ft\n';

const FIXTURE =
  HEADER +
  '41001  34.502  -72.522 2026 06 12 10 50  210  6.0  8.0  1.5  9.0  5.4 161 1015.2 -1.5  22.1  23.8  19.4   MM   MM\n' +
  '46059  38.094 -129.951 2026 06 12 10 50   MM   MM   MM  2.8 16.0   MM  MM 1021.0   MM    MM  14.2    MM   MM   MM\n' +
  'SHIP       MM       MM 2026 06 12 10 00  120  4.1   MM   MM   MM   MM  MM 1012.0   MM  18.0    MM    MM   MM   MM\n';

describe('parseNdbcLatestObs', () => {
  it('returns [] for empty or header-only input', () => {
    expect(parseNdbcLatestObs('')).toEqual([]);
    expect(parseNdbcLatestObs(null)).toEqual([]);
    expect(parseNdbcLatestObs(HEADER)).toEqual([]);
  });

  it('parses stations and drops rows without coordinates', () => {
    const out = parseNdbcLatestObs(FIXTURE);
    // SHIP has MM lat/lon and must be dropped.
    expect(out.map((e) => e.id)).toEqual(['41001', '46059']);
    expect(out[0]).toMatchObject({
      lat: 34.502,
      lng: -72.522,
      label: 'Buoy 41001',
      layer: 'buoys',
    });
  });

  it('converts metric readings to imperial', () => {
    const m = parseNdbcLatestObs(FIXTURE)[0].meta;
    expect(m.wind_speed_mph).toBeCloseTo(6.0 * 2.236936, 2); // m/s -> mph
    expect(m.wave_height_ft).toBeCloseTo(1.5 * 3.28084, 2); // m -> ft
    expect(m.wave_period_s).toBe(9.0);
    expect(m.water_temp_f).toBeCloseTo(74.84, 2); // 23.8 °C
    expect(m.air_temp_f).toBeCloseTo(71.78, 2); // 22.1 °C
    expect(m.pressure_hpa).toBe(1015.2);
  });

  it("maps 'MM' missing values to null without dropping the station", () => {
    const m = parseNdbcLatestObs(FIXTURE)[1].meta;
    expect(m.wind_speed_mph).toBeNull();
    expect(m.air_temp_f).toBeNull();
    expect(m.water_temp_f).toBeCloseTo(57.56, 2); // 14.2 °C still present
    expect(m.wave_height_ft).toBeCloseTo(2.8 * 3.28084, 2);
  });

  it('caps the result set at 800 stations', () => {
    const rows = Array.from(
      { length: 810 },
      (_, i) =>
        `S${String(i).padStart(4, '0')} 30.000 -70.000 2026 06 12 10 50 210 6.0 8.0 1.5 9.0 5.4 161 1015.2 -1.5 22.1 23.8 19.4 MM MM`
    ).join('\n');
    expect(parseNdbcLatestObs(HEADER + rows)).toHaveLength(800);
  });
});
