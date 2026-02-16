import { describe, expect, it } from 'vitest';

import { getLegacyLocationKeys, GRID_OPTIONS, normalizeConfig } from '../config';

describe('normalizeConfig', () => {
  it('applies defaults and card type', () => {
    const config = normalizeConfig({ entity: 'device_tracker.phone' }, { requireEntity: true });

    expect(config.type).toBe('custom:rainviewer-radar-card');
    expect(config.map_style).toBe('Light');
    expect(config.zoom_level).toBe(8);
    expect(config.hide_header).toBe(false);
    expect(config.show_marker).toBe(true);
    expect(config.frame_count).toBe(7);
  });

  it('supports hiding the header', () => {
    const config = normalizeConfig({ entity: 'device_tracker.phone', hide_header: true }, { requireEntity: true });
    expect(config.hide_header).toBe(true);
  });

  it('clamps invalid numeric values', () => {
    const config = normalizeConfig(
      {
        entity: 'person.scott',
        zoom_level: 99,
        frame_count: 0,
        frame_delay: 1,
        restart_delay: 999999,
        overlay_transparency: 123,
      },
      { requireEntity: true },
    );

    expect(config.zoom_level).toBe(10);
    expect(config.frame_count).toBe(1);
    expect(config.frame_delay).toBe(100);
    expect(config.restart_delay).toBe(10000);
    expect(config.overlay_transparency).toBe(90);
  });

  it('throws when entity is required and missing', () => {
    expect(() => normalizeConfig({}, { requireEntity: true })).toThrow(/entity/i);
  });
});

describe('legacy keys + grid options', () => {
  it('detects removed location keys', () => {
    const keys = getLegacyLocationKeys({
      center_latitude: -33.9,
      marker_longitude: 151.2,
      entity: 'device_tracker.phone',
    });
    expect(keys).toEqual(['center_latitude', 'marker_longitude']);
  });

  it('exposes fixed sections grid contract', () => {
    expect(GRID_OPTIONS).toEqual({
      columns: 2,
      rows: 3,
      min_columns: 2,
      max_columns: 3,
      min_rows: 2,
      max_rows: 4,
    });
  });
});
