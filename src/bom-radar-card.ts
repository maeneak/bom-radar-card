import { LitElement, html, css, type CSSResultGroup, type TemplateResult, type PropertyValues } from 'lit';
import { property, customElement } from 'lit/decorators.js';
import type { HomeAssistant, LovelaceCardEditor, LovelaceCard } from 'custom-card-helpers';

import './editor';

import { BomRadarCardConfig } from './types';
import { CARD_VERSION } from './const';

import * as L from 'leaflet';

console.info(
  `%c  BOM-RADAR-CARD  \n%c  Version ${CARD_VERSION}   `,
  'color: orange; font-weight: bold; background: black',
  'color: white; font-weight: bold; background: dimgray',
);

/* ── BOM WMTS KVP constants ── */
const WMTS_KVP_BASE = 'https://api.bom.gov.au/apikey/v1/mapping/timeseries/wmts';
const WMTS_LAYER = 'atm_surf_air_precip_reflectivity_dbz';
const WMTS_TILE_MATRIX_SET = 'GoogleMapsCompatible_BoM';
const EARTH_HALF_CIRCUMFERENCE = 20037508.342789244;

/**
 * BOM's custom TileMatrixSet definition (from WMTSCapabilities.xml).
 * Each zoom level has a custom origin and grid size that does NOT align
 * with the standard GoogleMapsCompatible tile grid.
 */
const BOM_TILE_MATRICES: Record<number, { originX: number; originY: number; cols: number; rows: number }> = {
  0: { originX: 11584952, originY: 34168990.685578, cols: 1, rows: 1 },
  1: { originX: 11584952, originY: 14131482.342789, cols: 1, rows: 1 },
  2: { originX: 11584952, originY: 4112728.171395, cols: 1, rows: 1 },
  3: { originX: 11584952, originY: 4112728.171395, cols: 2, rows: 2 },
  4: { originX: 11584952, originY: 1608039.628546, cols: 3, rows: 3 },
  5: { originX: 11584952, originY: 355695.357122, cols: 6, rows: 5 },
  6: { originX: 11584952, originY: -270476.778591, cols: 11, rows: 9 },
  7: { originX: 11584952, originY: -583562.846447, cols: 22, rows: 17 },
  8: { originX: 11584952, originY: -740105.880375, cols: 43, rows: 33 },
};

function getTileSpan(z: number): number {
  return (2 * EARTH_HALF_CIRCUMFERENCE) / Math.pow(2, z);
}

function bomKvpUrl(z: number, row: number, col: number, time: string): string {
  return (
    `${WMTS_KVP_BASE}?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0` +
    `&LAYER=${WMTS_LAYER}&STYLE=default&FORMAT=image/png` +
    `&TILEMATRIXSET=${WMTS_TILE_MATRIX_SET}` +
    `&TILEMATRIX=${z}&TILEROW=${row}&TILECOL=${col}` +
    `&TIME=${encodeURIComponent(time)}`
  );
}

/** Custom Leaflet control – Recenter button */
class RecenterControl extends L.Control {
  private _getCenter: () => L.LatLngExpression;
  private _getZoom: () => number;
  private _mapRef?: L.Map;

  constructor(getCenter: () => L.LatLngExpression, getZoom: () => number, options?: L.ControlOptions) {
    super(options);
    this._getCenter = getCenter;
    this._getZoom = getZoom;
  }

  override onAdd(map: L.Map): HTMLElement {
    this._mapRef = map;
    const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
    const button = L.DomUtil.create('a', 'recenter-btn', container) as HTMLAnchorElement;
    button.href = '#';
    button.title = 'Recenter map';
    button.role = 'button';
    button.setAttribute('aria-label', 'Recenter map');

    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.on(button, 'click', (e) => {
      L.DomEvent.preventDefault(e);
      this._mapRef?.setView(this._getCenter(), this._getZoom());
    });

    return container;
  }

  override onRemove(): void {
    this._mapRef = undefined;
  }
}

/**
 * Custom Leaflet GridLayer that renders BOM WMTS radar tiles.
 * BOM uses a non-standard tile grid (GoogleMapsCompatible_BoM) whose origin
 * does NOT align with standard web tiles. This layer computes the correct
 * BOM tile coordinates for each Leaflet tile position and positions them
 * with sub-tile pixel precision using absolutely-positioned <img> elements.
 * The BOM RESTful tile URL returns 404, so we use KVP (query-parameter)
 * encoding which works correctly.
 */
class BomRadarGridLayer extends L.GridLayer {
  private _timestamp: string;

  constructor(timestamp: string, options?: L.GridLayerOptions) {
    super(options);
    this._timestamp = timestamp;
  }

  override createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const tile = document.createElement('div');
    tile.style.width = '256px';
    tile.style.height = '256px';
    tile.style.overflow = 'hidden';
    tile.style.position = 'relative';

    const z = coords.z;
    const tm = BOM_TILE_MATRICES[z];
    if (!tm) {
      setTimeout(() => done(undefined, tile), 0);
      return tile;
    }

    const tileSpan = getTileSpan(z);

    // EPSG:3857 bounds of this Leaflet tile
    const leafMinX = -EARTH_HALF_CIRCUMFERENCE + coords.x * tileSpan;
    const leafMaxX = leafMinX + tileSpan;
    const leafMaxY = EARTH_HALF_CIRCUMFERENCE - coords.y * tileSpan;
    const leafMinY = leafMaxY - tileSpan;

    // Find overlapping BOM tiles (BOM grid uses a different origin)
    const firstCol = Math.floor((leafMinX - tm.originX) / tileSpan);
    const lastCol = Math.floor((leafMaxX - tm.originX - 0.01) / tileSpan);
    const firstRow = Math.floor((tm.originY - leafMaxY) / tileSpan);
    const lastRow = Math.floor((tm.originY - leafMinY - 0.01) / tileSpan);

    let pendingImages = 0;
    let hadValidTiles = false;

    for (let row = Math.max(0, firstRow); row <= Math.min(tm.rows - 1, lastRow); row++) {
      for (let col = Math.max(0, firstCol); col <= Math.min(tm.cols - 1, lastCol); col++) {
        hadValidTiles = true;
        pendingImages++;

        // EPSG:3857 origin of this BOM tile
        const bomMinX = tm.originX + col * tileSpan;
        const bomMaxY = tm.originY - row * tileSpan;

        // Pixel offset: where this BOM tile sits within the Leaflet tile
        const offsetX = Math.round(((bomMinX - leafMinX) / tileSpan) * 256);
        const offsetY = Math.round(((leafMaxY - bomMaxY) / tileSpan) * 256);

        const img = document.createElement('img');
        img.src = bomKvpUrl(z, row, col, this._timestamp);
        img.style.position = 'absolute';
        img.style.left = `${offsetX}px`;
        img.style.top = `${offsetY}px`;
        img.style.width = '256px';
        img.style.height = '256px';
        img.crossOrigin = 'anonymous';

        img.onload = () => {
          pendingImages--;
          if (pendingImages === 0) done(undefined, tile);
        };
        img.onerror = () => {
          pendingImages--;
          if (pendingImages === 0) done(undefined, tile);
        };

        tile.appendChild(img);
      }
    }

    if (!hadValidTiles) {
      setTimeout(() => done(undefined, tile), 0);
    }

    return tile;
  }
}

type LovelaceCustomCard = {
  type: string;
  name: string;
  preview?: boolean;
  description?: string;
};

declare global {
  interface Window {
    customCards?: LovelaceCustomCard[];
  }
}

window.customCards = window.customCards ?? [];
window.customCards.push({
  type: 'bom-radar-card',
  name: 'BoM Radar Card',
  description: 'A rain radar card using the Bureau of Meteorology WMTS radar imagery',
});

@customElement('bom-radar-card')
export class BomRadarCard extends LitElement implements LovelaceCard {
  static override styles: CSSResultGroup = css`
    #card {
      overflow: hidden;
    }
    .text-container {
      font: 14px/1.5 'Helvetica Neue', Arial, Helvetica, sans-serif;
      color: var(--bottom-container-color);
      padding-left: 10px;
      margin: 0;
      position: static;
      width: auto;
    }
    #root {
      width: 100%;
      position: relative;
    }
    #map-wrap {
      width: 100%;
      height: auto;
      aspect-ratio: 1 / 1;
      position: relative;
      display: block;
      box-sizing: border-box;
      overflow: hidden;
    }
    #map {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
    }
    #card-title {
      margin: 8px 0px 4px 8px;
      font-size: 1.5em;
    }
    #color-bar {
      height: 8px;
    }
    #div-progress-bar {
      height: 8px;
      background-color: var(--progress-bar-background);
    }
    #progress-bar {
      height: 8px;
      width: 0;
      background-color: var(--progress-bar-color);
    }
    #bottom-container {
      min-height: 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      background-color: var(--bottom-container-background);
      padding: 2px 8px;
      box-sizing: border-box;
    }
    .recenter-btn {
      display: block;
      width: 30px;
      height: 30px;
      background-image: url('/local/community/bom-radar-card/recenter.png');
      background-repeat: no-repeat;
      background-position: center;
      background-size: 18px 18px;
    }
    .marker-icon {
      display: block;
      border: none;
      padding: 0;
    }
  `;

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    return document.createElement('bom-radar-card-editor') as LovelaceCardEditor;
  }

  public static getStubConfig(): Record<string, unknown> {
    return {};
  }

  @property({ type: Boolean, reflect: true })
  public isPanel = false;
  private map?: L.Map;
  private start_time = 0;
  private frame_count = 12;
  private frame_delay = 250;
  private restart_delay = 1000;
  private mapLayers: string[] = [];
  private radarTileLayers: Map<string, L.GridLayer> = new Map();
  private radarTime: string[] = [];
  private frame = 0;
  private frameTimer: ReturnType<typeof setInterval> | undefined;
  private barsize = 0;
  private center_lon = 133.75;
  private center_lat = -27.85;
  private marker?: L.Marker;
  private resizeObserver?: ResizeObserver;
  private overlayTransparency = 0;
  private leafletCssInjected = false;

  // Add any properities that should cause your element to re-render here
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) private _config!: BomRadarCardConfig;
  @property({ attribute: false }) public editMode?: boolean;
  @property({ attribute: false }) public mapLoaded = false;
  @property() currentTime = '';

  public setConfig(config: BomRadarCardConfig): void {
    this._config = config;
  }

  // Sets the card size so HA knows how to put in columns
  getCardSize(): number {
    return 10;
  }

  private capabilitiesRetryCount = 0;
  private static readonly MAX_RETRY_COUNT = 5;
  private availableTimestamps: string[] = [];

  /**
   * Compute radar timestamps from current time.
   * BOM publishes radar tiles every 5 minutes. We round down to the nearest
   * 5-minute mark and generate frame_count timestamps going backwards.
   * The WMTS capabilities XML is CORS-blocked from external domains,
   * so we compute timestamps client-side instead of fetching them.
   */
  async getRadarCapabilities(): Promise<number> {
    try {
      // Round current time down to nearest 5-minute interval
      // Subtract 5 minutes to ensure the latest tile has been published
      const now = Date.now() - 5 * 60 * 1000;
      const latestMs = Math.floor(now / (5 * 60 * 1000)) * (5 * 60 * 1000);
      const latest = this.formatWmtsTimestamp(new Date(latestMs));

      // Generate enough timestamps to cover max possible frame_count (default 12, plus buffer)
      const count = Math.max(this.frame_count, 12) + 4;
      const timestamps: string[] = [];
      for (let i = 0; i < count; i++) {
        const t = latestMs - i * 5 * 60 * 1000;
        timestamps.unshift(this.formatWmtsTimestamp(new Date(t)));
      }
      this.availableTimestamps = timestamps;

      const newTime = latest;
      if (this.currentTime === newTime) {
        this.scheduleCapabilitiesRetry();
        return Date.parse(latest);
      }

      this.capabilitiesRetryCount = 0;
      this.currentTime = newTime;

      const t = Date.parse(latest);
      this.setNextUpdateTimeout(t);
      return t;
    } catch (err) {
      console.error('Error computing radar timestamps:', err);
      this.scheduleCapabilitiesRetry();
      return Promise.reject(err);
    }
  }

  /**
   * Format a Date as WMTS timestamp: YYYY-MM-DDTHH:MMZ (no seconds).
   * BOM's tile server requires this exact format — timestamps with seconds
   * (e.g. T10:20:00Z) return 404.
   */
  private formatWmtsTimestamp(date: Date): string {
    const y = date.getUTCFullYear();
    const mo = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    const h = String(date.getUTCHours()).padStart(2, '0');
    const mi = String(date.getUTCMinutes()).padStart(2, '0');
    return `${y}-${mo}-${d}T${h}:${mi}:00Z`;
  }

  private scheduleCapabilitiesRetry(): void {
    const delay = Math.min(5000 * Math.pow(2, this.capabilitiesRetryCount), 60000);
    this.capabilitiesRetryCount = Math.min(this.capabilitiesRetryCount + 1, BomRadarCard.MAX_RETRY_COUNT);
    setTimeout(() => {
      this.getRadarCapabilities();
    }, delay);
  }

  private normalizeOverlayTransparency(value: number | undefined): number {
    if (value === undefined) {
      return 0;
    }

    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return 0;
    }

    const clamped = Math.min(Math.max(numeric, 0), 90);
    return clamped;
  }

  private getOverlayOpacity(): number {
    const opacity = 1 - this.overlayTransparency / 100;
    return Math.max(0, Math.min(1, opacity));
  }

  private applyOverlayOpacityToLayers(): void {
    this.mapLayers.forEach((layerId, index) => {
      const layer = this.radarTileLayers.get(layerId);
      if (!layer) return;
      const targetOpacity = index === this.frame ? this.getOverlayOpacity() : 0;
      layer.setOpacity(targetOpacity);
    });
  }

  /** Inject Leaflet's CSS into the shadow root so it renders correctly. */
  private injectLeafletCss(): void {
    if (this.leafletCssInjected) return;
    const root = this.shadowRoot;
    if (!root) return;

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    root.appendChild(link);
    this.leafletCssInjected = true;
  }

  constructor() {
    super();
  }

  public override async firstUpdated(): Promise<void> {
    this.injectLeafletCss();
    await this.initMap();

    const wrap = this.shadowRoot?.getElementById('map-wrap');
    if (wrap && 'ResizeObserver' in window) {
      const ro = new ResizeObserver(() => {
        this.map?.invalidateSize();
        this.barsize = wrap.clientWidth / this.frame_count;
        const progressBar = this.shadowRoot?.getElementById('progress-bar');
        if (progressBar instanceof HTMLElement) {
          progressBar.style.width = `${(this.frame + 1) * this.barsize}px`;
        }
      });
      ro.observe(wrap);
      this.resizeObserver = ro;
    }
  }

  private getHomeAssistantLocation(): { latitude?: number; longitude?: number } {
    const rawLat = this.hass?.config?.latitude;
    const rawLon = this.hass?.config?.longitude;

    const latitude = Number(rawLat);
    const longitude = Number(rawLon);

    return {
      latitude: Number.isFinite(latitude) ? latitude : undefined,
      longitude: Number.isFinite(longitude) ? longitude : undefined,
    };
  }

  private resolveCoordinate(
    configured: number | undefined,
    fallback: number | undefined,
    defaultValue: number,
  ): number {
    if (configured !== undefined && !Number.isNaN(configured)) {
      return configured;
    }

    if (fallback !== undefined && !Number.isNaN(fallback)) {
      return fallback;
    }

    return defaultValue;
  }

  private createRecenterControl(): L.Control {
    const getCenter = (): L.LatLngExpression => [this.center_lat, this.center_lon];
    const getZoom = (): number => this._config.zoom_level ?? this.map?.getZoom() ?? 4;

    return new RecenterControl(getCenter, getZoom, { position: 'bottomright' });
  }

  private async initMap(): Promise<void> {
    const t = await this.getRadarCapabilities();
    this.frame_count = this._config.frame_count !== undefined ? this._config.frame_count : this.frame_count;
    this.frame_delay = this._config.frame_delay !== undefined ? this._config.frame_delay : this.frame_delay;
    this.restart_delay = this._config.restart_delay !== undefined ? this._config.restart_delay : this.restart_delay;
    this.overlayTransparency = this.normalizeOverlayTransparency(this._config.overlay_transparency);
    this.start_time = t - (this.frame_count - 1) * 5 * 60 * 1000;

    const container = this.shadowRoot?.getElementById('map');
    const isDark = this._config.map_style === 'Dark';

    if (container) {
      const haLocation = this.getHomeAssistantLocation();
      this.center_lon = this.resolveCoordinate(this._config.center_longitude, haLocation.longitude, this.center_lon);
      this.center_lat = this.resolveCoordinate(this._config.center_latitude, haLocation.latitude, this.center_lat);

      this.map = L.map(container, {
        center: [this.center_lat, this.center_lon],
        zoom: this._config.zoom_level ?? 4,
        minZoom: 3,
        maxZoom: 10,
        maxBounds: L.latLngBounds([-47, 109], [-7, 158.1]),
        maxBoundsViscosity: 1.0,
        attributionControl: false,
        zoomControl: false,
      });

      // Basemap
      const baseTileUrl = isDark
        ? 'https://cartodb-basemaps-{s}.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png'
        : 'https://cartodb-basemaps-{s}.global.ssl.fastly.net/light_all/{z}/{x}/{y}.png';
      L.tileLayer(baseTileUrl, {
        subdomains: 'abcd',
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      }).addTo(this.map);

      // Marker
      const markerIconUrl = isDark
        ? '/local/community/bom-radar-card/home-circle-light.svg'
        : '/local/community/bom-radar-card/home-circle-dark.svg';
      const markerIcon = L.icon({
        iconUrl: markerIconUrl,
        iconSize: [15, 15],
        iconAnchor: [7, 7],
        className: 'marker-icon',
      });
      this.marker = L.marker([0, 0], { icon: markerIcon });

      const markerLat = this.resolveCoordinate(
        this._config.marker_latitude,
        this._config.show_marker ? haLocation.latitude : undefined,
        NaN,
      );
      const markerLon = this.resolveCoordinate(
        this._config.marker_longitude,
        this._config.show_marker ? haLocation.longitude : undefined,
        NaN,
      );

      if (this._config.show_marker && !Number.isNaN(markerLat) && !Number.isNaN(markerLon) && this.map) {
        this.marker.setLatLng([markerLat, markerLon]);
        this.marker.addTo(this.map);
      }

      // Controls
      if (this._config.show_scale) {
        const imperial = this.hass?.config?.unit_system?.length === 'mi';
        L.control
          .scale({
            metric: !imperial,
            imperial,
            position: 'bottomleft',
          })
          .addTo(this.map);
      }
      if (this._config.show_recenter) {
        this.map.addControl(this.createRecenterControl());
      }
      if (this._config.show_zoom) {
        L.control.zoom({ position: 'topright' }).addTo(this.map);
      }

      this.loadMapContent();
    }
  }

  protected getRadarTimeString(date: string): string {
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const x = new Date(date);
    return (
      weekday[x.getDay()] +
      ' ' +
      month[x.getMonth()] +
      ' ' +
      x.getDate().toString().padStart(2, '0') +
      ' ' +
      x.getHours().toString().padStart(2, '0') +
      ':' +
      x.getMinutes().toString().padStart(2, '0')
    );
  }

  protected loadMapContent() {
    this.mapLoaded = true;
    this.loadRadarLayers();
    this.frame = this.mapLayers.length - 1;
    // Show the latest frame
    const currentLayer = this.radarTileLayers.get(this.mapLayers[this.frame]);
    if (currentLayer) {
      currentLayer.setOpacity(this.getOverlayOpacity());
    }
    this.applyOverlayOpacityToLayers();
    this.frameTimer = setInterval(() => this.changeRadarFrame(), this.restart_delay);
    const el = this.shadowRoot?.getElementById('map');
    if (el) {
      this.barsize = el.offsetWidth / this.frame_count;
      const pg = this.shadowRoot?.getElementById('progress-bar');
      if (pg) {
        pg.style.width = el.offsetWidth + 'px';
      }
    }
  }

  protected setNextUpdateTimeout(time: number) {
    const nextTime = time + 10 * 60 * 1000 + 15 * 1000;
    setTimeout(() => {
      this.getRadarCapabilities();
    }, nextTime - Date.now());
  }

  protected addRadarLayer(id: string) {
    if (this.map && id !== '' && this.mapLoaded) {
      const layer = new BomRadarGridLayer(id, {
        opacity: 0,
        tileSize: 256,
        maxNativeZoom: 8,
        maxZoom: 10,
      });
      layer.addTo(this.map);
      this.radarTileLayers.set(id, layer);
    }
  }

  protected removeRadarLayer(id: string) {
    const layer = this.radarTileLayers.get(id);
    if (layer && this.map) {
      this.map.removeLayer(layer);
      this.radarTileLayers.delete(id);
    }
  }

  protected loadRadarLayers() {
    const timestamps =
      this.availableTimestamps.length > 0
        ? this.availableTimestamps.slice(-this.frame_count)
        : this.generateTimestamps();

    for (const ts of timestamps) {
      const id = ts;
      this.mapLayers.push(id);
      this.radarTime.push(this.getRadarTimeString(ts));
      this.addRadarLayer(id);
    }
  }

  private generateTimestamps(): string[] {
    const timestamps: string[] = [];
    for (let i = 0; i < this.frame_count; i++) {
      const time = this.start_time + i * 5 * 60 * 1000;
      timestamps.push(this.formatWmtsTimestamp(new Date(time)));
    }
    return timestamps;
  }

  private changeRadarFrame(): void {
    if (this.map) {
      const extra = this.mapLayers.length > this.frame_count;
      let next = (this.frame + 1) % this.mapLayers.length;
      const currentLayer = this.mapLayers[this.frame];
      const nextLayer = this.mapLayers[next];

      const currentTileLayer = this.radarTileLayers.get(currentLayer);
      if (currentTileLayer) {
        currentTileLayer.setOpacity(0);
      }

      const nextTileLayer = this.radarTileLayers.get(nextLayer);
      if (nextTileLayer) {
        nextTileLayer.setOpacity(this.getOverlayOpacity());
      }

      if (extra) {
        const oldLayer = this.mapLayers.shift();
        this.radarTime.shift();
        if (oldLayer !== undefined) {
          this.removeRadarLayer(oldLayer);
        }
        next--;
      }
      this.frame = next;

      const el = this.shadowRoot?.getElementById('progress-bar');
      if (el) {
        el.style.width = (this.frame + 1) * this.barsize + 'px';
      }

      if (next === this.frame_count - 1) {
        clearInterval(this.frameTimer);
        this.frameTimer = setInterval(() => this.changeRadarFrame(), this.restart_delay);
      } else {
        clearInterval(this.frameTimer);
        this.frameTimer = setInterval(() => this.changeRadarFrame(), this.frame_delay);
      }

      const ts = this.shadowRoot?.getElementById('timestamp');
      if (ts) {
        ts.innerHTML = this.radarTime[this.frame];
      }
    }
  }

  protected override shouldUpdate(changedProps: PropertyValues<this>): boolean {
    if (this.mapLoaded === false) {
      return true;
    }

    const configKey = '_config' as keyof BomRadarCard;

    if (changedProps.has(configKey)) {
      const previousConfig = changedProps.get(configKey) as BomRadarCardConfig | undefined;

      if (previousConfig) {
        if (this._config.zoom_level !== previousConfig.zoom_level) {
          this.map?.setView([this.center_lat, this.center_lon], this._config.zoom_level);
        }

        if (this._config.center_longitude !== previousConfig.center_longitude) {
          const haLocation = this.getHomeAssistantLocation();
          this.center_lon = this.resolveCoordinate(this._config.center_longitude, haLocation.longitude, 133.75);
          this.map?.setView([this.center_lat, this.center_lon], this._config.zoom_level);
        }

        if (this._config.center_latitude !== previousConfig.center_latitude) {
          const haLocation = this.getHomeAssistantLocation();
          this.center_lat = this.resolveCoordinate(this._config.center_latitude, haLocation.latitude, -27.85);
          this.map?.setView([this.center_lat, this.center_lon], this._config.zoom_level);
        }

        if (this._config.frame_delay !== previousConfig.frame_delay) {
          this.frame_delay =
            this._config.frame_delay === undefined || isNaN(this._config.frame_delay) ? 250 : this._config.frame_delay;
        }

        if (this._config.restart_delay !== previousConfig.restart_delay) {
          this.restart_delay =
            this._config.restart_delay === undefined || isNaN(this._config.restart_delay)
              ? 1000
              : this._config.restart_delay;
        }

        if (this._config.overlay_transparency !== previousConfig.overlay_transparency) {
          this.overlayTransparency = this.normalizeOverlayTransparency(this._config.overlay_transparency);
          this.applyOverlayOpacityToLayers();
        }

        if (
          this._config.show_marker !== previousConfig.show_marker ||
          this._config.marker_latitude !== previousConfig.marker_latitude ||
          this._config.marker_longitude !== previousConfig.marker_longitude
        ) {
          if (this.marker) {
            if (this._config.show_marker) {
              const haLocation = this.getHomeAssistantLocation();
              const markerLat = this.resolveCoordinate(this._config.marker_latitude, haLocation.latitude, NaN);
              const markerLon = this.resolveCoordinate(this._config.marker_longitude, haLocation.longitude, NaN);

              if (!Number.isNaN(markerLat) && !Number.isNaN(markerLon) && this.map) {
                this.marker.setLatLng([markerLat, markerLon]);
                this.marker.addTo(this.map);
              } else {
                this.marker.remove();
              }
            } else {
              this.marker.remove();
            }
          }
        }
      }

      return true;
    }

    if (changedProps.has('currentTime') && this.currentTime !== '') {
      if (this.map) {
        const id = this.currentTime;
        this.mapLayers.push(id);
        this.radarTime.push(this.getRadarTimeString(this.currentTime));
        this.addRadarLayer(id);
        this.applyOverlayOpacityToLayers();
        return true;
      }
    }

    return false;
  }

  protected updateStyle(elem: this) {
    if (this._config.map_style === 'Dark') {
      elem?.style.setProperty('--progress-bar-background', '#1C1C1C');
      elem?.style.setProperty('--progress-bar-color', 'steelblue');
      elem?.style.setProperty('--bottom-container-background', '#1C1C1C');
      elem?.style.setProperty('--bottom-container-color', '#DDDDDD');
    } else {
      elem?.style.setProperty('--progress-bar-background', 'white');
      elem?.style.setProperty('--progress-bar-color', '#ccf2ff');
      elem?.style.setProperty('--bottom-container-background', 'white');
      elem?.style.setProperty('--bottom-container-color', 'black');
    }
  }

  public override connectedCallback(): void {
    super.connectedCallback();
    this.updateStyle(this);
    // Leaflet doesn't need the projection matrix hack that Mapbox did,
    // but we do need to invalidate the size after tab switches.
    if (this.map) {
      requestAnimationFrame(() => this.map?.invalidateSize());
    }
  }

  public override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
    if (this.frameTimer) {
      clearInterval(this.frameTimer);
    }
  }

  protected override render(): TemplateResult | void {
    if (this._config.show_warning) {
      return this.showWarning('Show Warning');
    }

    const cardTitle =
      this._config.card_title !== undefined ? html`<div id="card-title">${this._config.card_title}</div>` : html``;

    return html`
      <ha-card id="card">
        ${cardTitle}
        <div id="root">
          <div id="color-bar">
            <img
              id="img-color-bar"
              src="/local/community/bom-radar-card/radar-colour-bar.png"
              height="8"
              style="vertical-align: top"
            />
          </div>
          <div id="map-wrap">
            <div id="map"></div>
          </div>
          <div id="div-progress-bar">
            <div id="progress-bar"></div>
          </div>
          <div id="bottom-container" class="light-links">
            <div id="timestampid" class="text-container">
              <p id="timestamp"></p>
            </div>
            <div id="attribution-container" class="text-container-small" style="height: 32px; float: right;">
              <span class="Map__Attribution-LjffR DKiFh"></span>
            </div>
          </div>
        </div>
      </ha-card>
    `;
  }

  private showWarning(warning: string): TemplateResult {
    return html` <hui-warning>${warning}</hui-warning> `;
  }
}
