import { LitElement, html, css, type CSSResultGroup, type TemplateResult, type PropertyValues } from 'lit';
import { property, customElement } from 'lit/decorators.js';
import type { HomeAssistant, LovelaceCardEditor, LovelaceCard } from 'custom-card-helpers';

import './editor';

import { BomRasterRadarCardConfig } from './types';
import { CARD_VERSION } from './const';

import * as L from 'leaflet';

console.info(
  `%c  BOM-RASTER-RADAR-CARD  \n%c  Version ${CARD_VERSION}   `,
  'color: orange; font-weight: bold; background: black',
  'color: white; font-weight: bold; background: dimgray',
);

/* ── RainViewer API constants ── */
const RAINVIEWER_API = 'https://api.rainviewer.com/public/weather-maps.json';
const RAINVIEWER_COLOR_SCHEME = 2; // rainbow
const RAINVIEWER_SMOOTH = 1;
const RAINVIEWER_SNOW = 0;

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
  type: 'bom-raster-radar-card',
  name: 'BoM Raster Radar Card',
  description: 'A rain radar card using RainViewer composite radar imagery',
});

@customElement('bom-raster-radar-card')
export class BomRasterRadarCard extends LitElement implements LovelaceCard {
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
      background-image: url('/local/community/bom-raster-radar-card/recenter.png');
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
    return document.createElement('bom-raster-radar-card-editor') as LovelaceCardEditor;
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
  private radarTileLayers: Map<string, L.TileLayer> = new Map();
  private radarTime: string[] = [];
  private pathForTimestamp: Map<string, string> = new Map();
  private rainviewerHost = 'https://tilecache.rainviewer.com';
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
  @property({ attribute: false }) private _config!: BomRasterRadarCardConfig;
  @property({ attribute: false }) public editMode?: boolean;
  @property({ attribute: false }) public mapLoaded = false;
  @property() currentTime = '';

  public setConfig(config: BomRasterRadarCardConfig): void {
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
   * Fetch radar timestamps from RainViewer's public API.
   * Returns past 2 hours of composite radar frames at 10-minute intervals.
   * RainViewer serves tiles with CORS enabled (Access-Control-Allow-Origin: *),
   * so no proxy or workaround is needed.
   */
  async getRadarCapabilities(): Promise<number> {
    try {
      const response = await fetch(RAINVIEWER_API);
      if (!response.ok) throw new Error(`RainViewer API returned ${response.status}`);
      const data = await response.json();

      this.rainviewerHost = data.host || this.rainviewerHost;
      const pastFrames: { time: number; path: string }[] = data.radar?.past ?? [];
      if (pastFrames.length === 0) throw new Error('No radar frames available');

      // Build timestamp → path mapping
      this.pathForTimestamp.clear();
      const timestamps: string[] = [];
      for (const frame of pastFrames) {
        const isoString = new Date(frame.time * 1000).toISOString();
        timestamps.push(isoString);
        this.pathForTimestamp.set(isoString, frame.path);
      }
      this.availableTimestamps = timestamps;

      const latest = pastFrames[pastFrames.length - 1];
      const latestMs = latest.time * 1000;
      const newTime = new Date(latestMs).toISOString();

      if (this.currentTime === newTime) {
        this.scheduleCapabilitiesRetry();
        return latestMs;
      }

      this.capabilitiesRetryCount = 0;
      this.currentTime = newTime;

      this.setNextUpdateTimeout(latestMs);
      return latestMs;
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
    return date.toISOString();
  }

  private scheduleCapabilitiesRetry(): void {
    const delay = Math.min(5000 * Math.pow(2, this.capabilitiesRetryCount), 60000);
    this.capabilitiesRetryCount = Math.min(this.capabilitiesRetryCount + 1, BomRasterRadarCard.MAX_RETRY_COUNT);
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
    this.start_time = t - (this.frame_count - 1) * 10 * 60 * 1000;

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
        ? '/local/community/bom-raster-radar-card/home-circle-light.svg'
        : '/local/community/bom-raster-radar-card/home-circle-dark.svg';
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
      const path = this.pathForTimestamp.get(id);
      if (!path) return;

      const tileUrl = `${this.rainviewerHost}${path}/256/{z}/{x}/{y}/${RAINVIEWER_COLOR_SCHEME}/${RAINVIEWER_SMOOTH}_${RAINVIEWER_SNOW}.png`;
      const layer = L.tileLayer(tileUrl, {
        opacity: 0,
        tileSize: 256,
        maxNativeZoom: 7,
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
      const time = this.start_time + i * 10 * 60 * 1000;
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

    const configKey = '_config' as keyof BomRasterRadarCard;

    if (changedProps.has(configKey)) {
      const previousConfig = changedProps.get(configKey) as BomRasterRadarCardConfig | undefined;

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
              src="/local/community/bom-raster-radar-card/radar-colour-bar.png"
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

if (!customElements.get('bom-radar-card')) {
  customElements.define('bom-radar-card', BomRasterRadarCard);
}
