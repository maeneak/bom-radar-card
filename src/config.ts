import type { HomeAssistant } from 'custom-card-helpers';

import { CARD_TYPE } from './const';
import type { BomGridOptions, BomRasterRadarCardConfig } from './types';

const DEFAULT_FRAME_COUNT = 7;
const DEFAULT_FRAME_DELAY = 250;
const DEFAULT_RESTART_DELAY = 1000;
const DEFAULT_ZOOM_LEVEL = 8;

export const DEFAULT_CENTER = {
  latitude: -27.85,
  longitude: 133.75,
};

export const GRID_OPTIONS: BomGridOptions = {
  columns: 2,
  rows: 3,
  min_columns: 2,
  max_columns: 3,
  min_rows: 2,
  max_rows: 4,
};

export const LEGACY_LOCATION_KEYS = [
  'center_latitude',
  'center_longitude',
  'marker_latitude',
  'marker_longitude',
] as const;

export const CONFIG_FORM_SCHEMA = [
  {
    name: 'entity',
    required: true,
    selector: {
      entity: {
        filter: [{ domain: 'device_tracker' }, { domain: 'person' }],
      },
    },
  },
  { name: 'card_title', selector: { text: {} } },
  { name: 'hide_header', selector: { boolean: {} } },
  {
    name: 'map_style',
    selector: {
      select: {
        mode: 'dropdown',
        options: [
          { label: 'Light', value: 'Light' },
          { label: 'Dark', value: 'Dark' },
        ],
      },
    },
  },
  { name: 'zoom_level', selector: { number: { mode: 'slider', min: 3, max: 10, step: 1 } } },
  { name: 'show_marker', selector: { boolean: {} } },
  { name: 'show_zoom', selector: { boolean: {} } },
  { name: 'show_recenter', selector: { boolean: {} } },
  { name: 'show_scale', selector: { boolean: {} } },
  { name: 'frame_count', selector: { number: { mode: 'box', min: 1, max: 24, step: 1 } } },
  { name: 'frame_delay', selector: { number: { mode: 'box', min: 100, max: 5000, step: 50 } } },
  { name: 'restart_delay', selector: { number: { mode: 'box', min: 100, max: 10000, step: 50 } } },
  {
    name: 'overlay_transparency',
    selector: { number: { mode: 'slider', min: 0, max: 90, step: 5, unit_of_measurement: '%' } },
  },
];

const CONFIG_FORM_LABELS: Record<string, string> = {
  entity: 'Tracker entity',
  card_title: 'Title',
  hide_header: 'Hide header/title',
  map_style: 'Map style',
  zoom_level: 'Zoom level',
  show_marker: 'Show marker',
  show_zoom: 'Show zoom control',
  show_recenter: 'Show recenter control',
  show_scale: 'Show scale',
  frame_count: 'Frame count',
  frame_delay: 'Frame delay (ms)',
  restart_delay: 'Restart delay (ms)',
  overlay_transparency: 'Overlay transparency',
};

const CONFIG_FORM_HELPERS: Record<string, string> = {
  entity: 'Used for initial center, live marker location, and marker icon.',
  map_style: 'Light uses OpenStreetMap Standard. Dark uses CARTO Dark Matter (OSM-based).',
  frame_count: 'Number of radar frames shown in the animation loop.',
  overlay_transparency: '0% is fully opaque radar, 90% is highly transparent.',
};

export const getConfigFormLabel = (schema: { name?: string }): string => {
  if (!schema.name) {
    return '';
  }
  return CONFIG_FORM_LABELS[schema.name] ?? schema.name;
};

export const getConfigFormHelper = (schema: { name?: string }): string | undefined => {
  if (!schema.name) {
    return undefined;
  }
  return CONFIG_FORM_HELPERS[schema.name];
};

const toFiniteNumber = (value: unknown): number | undefined => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const sanitizeMapStyle = (value: unknown): 'Light' | 'Dark' => (value === 'Dark' ? 'Dark' : 'Light');

const sanitizeEntity = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export interface NormalizeConfigOptions {
  requireEntity?: boolean;
}

export const normalizeConfig = (
  config: Partial<BomRasterRadarCardConfig>,
  options: NormalizeConfigOptions = {},
): BomRasterRadarCardConfig => {
  const entity = sanitizeEntity(config.entity);
  if (options.requireEntity && entity.length === 0) {
    throw new Error('Required configuration missing: "entity" must be set to a device_tracker or person entity.');
  }

  const zoom = toFiniteNumber(config.zoom_level);
  const frameCount = toFiniteNumber(config.frame_count);
  const frameDelay = toFiniteNumber(config.frame_delay);
  const restartDelay = toFiniteNumber(config.restart_delay);
  const overlayTransparency = toFiniteNumber(config.overlay_transparency);

  return {
    type: CARD_TYPE,
    entity,
    card_title: typeof config.card_title === 'string' && config.card_title.trim().length > 0 ? config.card_title : undefined,
    hide_header: config.hide_header === true,
    map_style: sanitizeMapStyle(config.map_style),
    zoom_level: zoom !== undefined ? clamp(Math.round(zoom), 3, 10) : DEFAULT_ZOOM_LEVEL,
    show_marker: config.show_marker !== false,
    show_zoom: config.show_zoom !== false,
    show_scale: config.show_scale !== false,
    show_recenter: config.show_recenter !== false,
    frame_count: frameCount !== undefined ? clamp(Math.round(frameCount), 1, 24) : DEFAULT_FRAME_COUNT,
    frame_delay: frameDelay !== undefined ? clamp(Math.round(frameDelay), 100, 5000) : DEFAULT_FRAME_DELAY,
    restart_delay: restartDelay !== undefined ? clamp(Math.round(restartDelay), 100, 10000) : DEFAULT_RESTART_DELAY,
    overlay_transparency: overlayTransparency !== undefined ? clamp(overlayTransparency, 0, 90) : 0,
  };
};

export const pickStubEntity = (hass?: HomeAssistant, entities?: string[]): string => {
  const allEntities = entities ?? Object.keys(hass?.states ?? {});
  const trackerEntity =
    allEntities.find((entityId) => entityId.startsWith('device_tracker.')) ??
    allEntities.find((entityId) => entityId.startsWith('person.'));
  return trackerEntity ?? 'device_tracker.example';
};

export const getLegacyLocationKeys = (config: Record<string, unknown>): string[] =>
  LEGACY_LOCATION_KEYS.filter((key) => key in config);
