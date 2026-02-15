import type { LovelaceCardConfig } from 'custom-card-helpers';

export type BomMapStyle = 'Light' | 'Dark';

export interface BomRasterRadarCardConfig extends LovelaceCardConfig {
  type: 'custom:bom-raster-radar-card';
  entity: string;
  card_title?: string;
  hide_header?: boolean;
  map_style?: BomMapStyle;
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

export interface BomGridOptions {
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
