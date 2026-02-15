import { describe, expect, it } from 'vitest';

import {
  coordinatesFromState,
  didCoordinatesChange,
  resolveEntityCoordinates,
  resolveEntityIcon,
  resolvePreferredCoordinates,
} from '../entity-location';

const mockHass = {
  config: {
    latitude: -37.814,
    longitude: 144.96332,
    unit_system: { length: 'km' },
  },
  states: {
    'device_tracker.phone': {
      state: 'home',
      attributes: {
        latitude: -33.86,
        longitude: 151.2,
      },
    },
    'person.scott': {
      state: 'not_home',
      attributes: {
        latitude: -34,
        longitude: 151.1,
        icon: 'mdi:account-circle',
      },
    },
    'device_tracker.invalid': {
      state: 'unknown',
      attributes: {
        latitude: 999,
        longitude: -999,
      },
    },
  },
} as const;

describe('entity location resolution', () => {
  it('extracts valid lat/lon from entity state', () => {
    const coordinates = resolveEntityCoordinates(mockHass as never, 'device_tracker.phone');
    expect(coordinates).toEqual({ latitude: -33.86, longitude: 151.2 });
  });

  it('falls back to HA home coordinates when entity location is invalid', () => {
    const coordinates = resolvePreferredCoordinates(mockHass as never, 'device_tracker.invalid');
    expect(coordinates).toEqual({ latitude: -37.814, longitude: 144.96332, source: 'home' });
  });

  it('returns explicit entity icon when available', () => {
    const icon = resolveEntityIcon(mockHass as never, 'person.scott');
    expect(icon).toBe('mdi:account-circle');
  });
});

describe('marker update helpers', () => {
  it('detects coordinate changes for marker updates', () => {
    expect(didCoordinatesChange(undefined, { latitude: 1, longitude: 2 })).toBe(true);
    expect(didCoordinatesChange({ latitude: 1, longitude: 2 }, { latitude: 1, longitude: 2 })).toBe(false);
    expect(didCoordinatesChange({ latitude: 1, longitude: 2 }, { latitude: 3, longitude: 2 })).toBe(true);
  });

  it('rejects out-of-range coordinates', () => {
    expect(coordinatesFromState({ attributes: { latitude: 120, longitude: 150 } })).toBeUndefined();
    expect(coordinatesFromState({ attributes: { latitude: -30, longitude: 200 } })).toBeUndefined();
  });
});

