import type { LovelaceCardConfig } from 'custom-card-helpers';

export type RainviewerMapStyle = 'Light' | 'Dark';

export interface RainviewerRadarCardConfig extends LovelaceCardConfig {
  type: 'custom:rainviewer-radar-card';
  entity: string;
  card_title?: string;
  hide_header?: boolean;
  map_style?: RainviewerMapStyle;
  zoom_level?: number;

  show_marker?: boolean;

  show_zoom?: boolean;
  show_scale?: boolean;
  show_recenter?: boolean;

  frame_count?: number;
  frame_delay?: number;
  restart_delay?: number;
  overlay_transparency?: number;

  show_warning?: boolean;
  show_error?: boolean;
  test_gui?: boolean;
  show_header_toggle?: boolean;
}

export interface RainviewerGridOptions {
  columns: number;
  rows: number;
  min_columns: number;
  max_columns: number;
  min_rows: number;
  max_rows: number;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}
