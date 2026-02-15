import { LitElement, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { HomeAssistant, LovelaceCard } from 'custom-card-helpers';

import { CARD_TYPE, CARD_VERSION } from './const';
import {
  CONFIG_FORM_SCHEMA,
  getConfigFormHelper,
  getConfigFormLabel,
  getLegacyLocationKeys,
  GRID_OPTIONS,
  normalizeConfig,
  pickStubEntity,
} from './config';
import {
  didCoordinatesChange,
  isSupportedEntityDomain,
  resolveEntityCoordinates,
  resolveEntityIcon,
  resolveEntityName,
  resolvePreferredCoordinates,
} from './entity-location';
import { MapController } from './map-controller';
import { buildRadarTileUrl, fetchRadarSnapshot, formatRadarTimestamp, getNextSnapshotDelayMs, getRetryDelayMs } from './radar-source';
import { cardStyles } from './styles';
import type { BomGridOptions, BomRasterRadarCardConfig, Coordinates } from './types';

console.info(
  `%c  BOM-RASTER-RADAR-CARD  \n%c  Version ${CARD_VERSION}   `,
  'color: orange; font-weight: bold; background: black',
  'color: white; font-weight: bold; background: dimgray',
);

const RADAR_COLOR_BAR_URL = new URL('./assets/radar-colour-bar.png', import.meta.url).toString();

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
  static override styles = cardStyles;

  public static getGridOptions(): BomGridOptions {
    return GRID_OPTIONS;
  }

  public static getConfigForm(): Record<string, unknown> {
    return {
      schema: CONFIG_FORM_SCHEMA,
      computeLabel: getConfigFormLabel,
      computeHelper: getConfigFormHelper,
    };
  }

  public static getStubConfig(hass?: HomeAssistant, entities?: string[]): BomRasterRadarCardConfig {
    return normalizeConfig(
      {
        type: CARD_TYPE,
        entity: pickStubEntity(hass, entities),
      },
      { requireEntity: true },
    );
  }

  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public editMode?: boolean;
  @property({ type: Boolean, reflect: true }) public isPanel = false;
  @property({ attribute: false }) private _config?: BomRasterRadarCardConfig;

  @state() private timestampLabel = 'Loading radar...';
  @state() private progressPercent = 0;

  private mapController?: MapController;
  private leafletCssInjected = false;
  private resizeObserver?: ResizeObserver;
  private isInitializingMap = false;
  private snapshotTimer?: ReturnType<typeof setTimeout>;
  private frameTimer?: ReturnType<typeof setTimeout>;
  private retryCount = 0;
  private radarHost = 'https://tilecache.rainviewer.com';
  private frameIndex = 0;
  private centerCoordinates: Coordinates = { latitude: -27.85, longitude: 133.75 };
  private lastMarkerCoordinates?: Coordinates;
  private layerIds: string[] = [];
  private radarFrames: Array<{ id: string; timestampIso: string; path: string }> = [];
  private legacyWarningLogged = false;
  private unsupportedDomainWarningLogged = false;

  public setConfig(config: BomRasterRadarCardConfig): void {
    const legacyKeys = getLegacyLocationKeys(config as unknown as Record<string, unknown>);
    if (legacyKeys.length > 0 && !this.legacyWarningLogged) {
      console.warn(
        `[bom-raster-radar-card] v5 removed the following config keys: ${legacyKeys.join(
          ', ',
        )}. Use "entity" instead for location.`,
      );
      this.legacyWarningLogged = true;
    }

    this._config = normalizeConfig(config, { requireEntity: true });
  }

  public getCardSize(): number {
    return 6;
  }

  public override firstUpdated(): void {
    this.injectLeafletCss();
    this.observeMapContainerSize();
    void this.initializeMapIfReady();
  }

  public override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
    this.teardownMap();
  }

  protected override updated(changedProps: PropertyValues<this>): void {
    if (!this.hass || !this._config) {
      return;
    }

    if (!isSupportedEntityDomain(this._config.entity) && !this.unsupportedDomainWarningLogged) {
      console.warn(
        `[bom-raster-radar-card] "entity" should be a device_tracker or person. Received: ${this._config.entity}.`,
      );
      this.unsupportedDomainWarningLogged = true;
    }

    const configKey = '_config' as keyof BomRasterRadarCard;
    if (changedProps.has(configKey) && this.mapController) {
      void this.rebuildMap();
      return;
    }

    if (!this.mapController) {
      void this.initializeMapIfReady();
      return;
    }

    if (changedProps.has('hass')) {
      this.updateMarkerFromEntity();
    }
  }

  protected override render(): TemplateResult {
    const header = this.resolveHeader();
    const body = html`
      <div class="card-root">
        <img class="color-bar" src=${RADAR_COLOR_BAR_URL} alt="Radar intensity scale" />
        <div class="map-wrap">
          <div id="map" class="map"></div>
        </div>
        <div class="progress-track">
          <div class="progress-bar" style=${`width: ${this.progressPercent}%;`}></div>
        </div>
        <div class="footer">
          <span class="footer-meta">${this.timestampLabel} · RainViewer</span>
        </div>
      </div>
    `;

    if (header !== undefined) {
      return html`
        <ha-card .header=${header}>
          ${body}
        </ha-card>
      `;
    }

    return html`
      <ha-card>
        ${body}
      </ha-card>
    `;
  }

  private resolveHeader(): string | undefined {
    if (!this._config) {
      return 'BoM Radar';
    }
    if (this._config.hide_header) {
      return undefined;
    }
    if (this._config.card_title) {
      return this._config.card_title;
    }
    if (!this.hass) {
      return 'BoM Radar';
    }
    return resolveEntityName(this.hass, this._config.entity);
  }

  private observeMapContainerSize(): void {
    const mapWrap = this.shadowRoot?.querySelector('.map-wrap');
    if (!(mapWrap instanceof HTMLElement) || !('ResizeObserver' in window)) {
      return;
    }

    this.resizeObserver = new ResizeObserver(() => {
      this.mapController?.invalidateSize();
    });
    this.resizeObserver.observe(mapWrap);
  }

  private injectLeafletCss(): void {
    if (this.leafletCssInjected || !this.shadowRoot) {
      return;
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    this.shadowRoot.appendChild(link);
    this.leafletCssInjected = true;
  }

  private async initializeMapIfReady(): Promise<void> {
    if (!this._config || !this.hass || this.mapController || this.isInitializingMap) {
      return;
    }

    const mapElement = this.shadowRoot?.getElementById('map');
    if (!(mapElement instanceof HTMLElement)) {
      return;
    }

    this.isInitializingMap = true;

    try {
      const center = resolvePreferredCoordinates(this.hass, this._config.entity);
      this.centerCoordinates = {
        latitude: center.latitude,
        longitude: center.longitude,
      };

      this.mapController = new MapController({
        container: mapElement,
        center: [center.latitude, center.longitude],
        zoom: this._config.zoom_level ?? 8,
        mapStyle: this._config.map_style ?? 'Light',
        showScale: this._config.show_scale !== false,
        showZoom: this._config.show_zoom !== false,
        showRecenter: this._config.show_recenter !== false,
        imperialScale: this.hass.config.unit_system.length === 'mi',
        onRecenter: () => {
          if (!this.mapController || !this._config) {
            return;
          }
          this.mapController.setView(
            [this.centerCoordinates.latitude, this.centerCoordinates.longitude],
            this._config.zoom_level ?? this.mapController.getZoom(),
          );
        },
      });

      this.updateMarkerFromEntity();
      await this.refreshRadarSnapshot(true);
    } catch (error) {
      console.error('[bom-raster-radar-card] Failed to initialize map.', error);
    } finally {
      this.isInitializingMap = false;
    }
  }

  private async rebuildMap(): Promise<void> {
    this.teardownMap();
    await this.initializeMapIfReady();
  }

  private teardownMap(): void {
    if (this.snapshotTimer) {
      clearTimeout(this.snapshotTimer);
      this.snapshotTimer = undefined;
    }
    if (this.frameTimer) {
      clearTimeout(this.frameTimer);
      this.frameTimer = undefined;
    }

    this.mapController?.destroy();
    this.mapController = undefined;
    this.layerIds = [];
    this.radarFrames = [];
    this.frameIndex = 0;
    this.progressPercent = 0;
    this.timestampLabel = 'Loading radar...';
    this.lastMarkerCoordinates = undefined;
    this.retryCount = 0;
  }

  private async refreshRadarSnapshot(resetFrames: boolean): Promise<void> {
    if (!this._config || !this.mapController) {
      return;
    }

    try {
      const snapshot = await fetchRadarSnapshot();
      this.retryCount = 0;
      this.radarHost = snapshot.host;

      if (resetFrames || this.radarFrames.length === 0) {
        this.replaceFrames(snapshot.frames.slice(-(this._config.frame_count ?? 7)));
      } else {
        this.mergeNewFrames(snapshot.frames, this._config.frame_count ?? 7);
      }

      this.applyVisibleFrame();
      this.scheduleNextSnapshot(snapshot.latestTimeMs);
      this.scheduleNextFrame(this._config.restart_delay ?? 1000);
    } catch (error) {
      console.error('[bom-raster-radar-card] Failed to fetch radar frames.', error);
      this.scheduleRetry();
    }
  }

  private replaceFrames(frames: Array<{ id: string; timestampIso: string; path: string }>): void {
    if (!this.mapController) {
      return;
    }

    this.mapController.clearRadarLayers(this.layerIds);
    this.layerIds = [];
    this.radarFrames = [];

    for (const frame of frames) {
      this.addFrame(frame);
    }

    this.frameIndex = this.radarFrames.length > 0 ? this.radarFrames.length - 1 : 0;
  }

  private mergeNewFrames(
    allFrames: Array<{ id: string; timestampIso: string; path: string }>,
    frameCount: number,
  ): void {
    const latestKnownId = this.radarFrames.length > 0 ? this.radarFrames[this.radarFrames.length - 1].id : undefined;
    const latestKnownIndex =
      latestKnownId !== undefined ? allFrames.findIndex((frame) => frame.id === latestKnownId) : -1;
    const framesToAdd =
      latestKnownIndex >= 0 ? allFrames.slice(latestKnownIndex + 1) : allFrames.slice(Math.max(allFrames.length - frameCount, 0));

    if (framesToAdd.length === 0) {
      return;
    }

    for (const frame of framesToAdd) {
      this.addFrame(frame);
    }

    while (this.radarFrames.length > frameCount) {
      const removed = this.radarFrames.shift();
      const removedLayerId = this.layerIds.shift();
      if (removedLayerId && this.mapController) {
        this.mapController.removeRadarLayer(removedLayerId);
      }
      if (removed && this.frameIndex > 0) {
        this.frameIndex -= 1;
      }
    }

    this.frameIndex = this.radarFrames.length > 0 ? this.radarFrames.length - 1 : 0;
  }

  private addFrame(frame: { id: string; timestampIso: string; path: string }): void {
    if (!this.mapController) {
      return;
    }

    this.radarFrames.push(frame);
    this.layerIds.push(frame.id);
    this.mapController.setRadarLayer(frame.id, buildRadarTileUrl(this.radarHost, frame.path));
  }

  private applyVisibleFrame(): void {
    if (!this.mapController) {
      return;
    }

    const overlayOpacity = this.getOverlayOpacity();

    this.layerIds.forEach((layerId, layerIndex) => {
      this.mapController?.setRadarLayerOpacity(layerId, layerIndex === this.frameIndex ? overlayOpacity : 0);
    });

    if (this.radarFrames.length === 0) {
      this.timestampLabel = 'No radar data';
      this.progressPercent = 0;
      return;
    }

    const visibleFrame = this.radarFrames[this.frameIndex];
    this.timestampLabel = formatRadarTimestamp(visibleFrame.timestampIso);
    this.progressPercent = ((this.frameIndex + 1) / this.radarFrames.length) * 100;
  }

  private getOverlayOpacity(): number {
    const transparency = this._config?.overlay_transparency ?? 0;
    const opacity = 1 - transparency / 100;
    return Math.min(1, Math.max(0, opacity));
  }

  private scheduleNextFrame(delayMs: number): void {
    if (this.frameTimer) {
      clearTimeout(this.frameTimer);
      this.frameTimer = undefined;
    }

    if (!this._config || this.radarFrames.length <= 1) {
      return;
    }

    this.frameTimer = setTimeout(() => {
      this.advanceFrame();
    }, delayMs);
  }

  private advanceFrame(): void {
    if (!this._config || this.radarFrames.length === 0) {
      return;
    }

    this.frameIndex = (this.frameIndex + 1) % this.radarFrames.length;
    this.applyVisibleFrame();

    const isLastFrame = this.frameIndex === this.radarFrames.length - 1;
    const nextDelay = isLastFrame ? this._config.restart_delay ?? 1000 : this._config.frame_delay ?? 250;
    this.scheduleNextFrame(nextDelay);
  }

  private scheduleNextSnapshot(latestTimeMs: number): void {
    if (this.snapshotTimer) {
      clearTimeout(this.snapshotTimer);
      this.snapshotTimer = undefined;
    }

    const delay = getNextSnapshotDelayMs(latestTimeMs);
    this.snapshotTimer = setTimeout(() => {
      void this.refreshRadarSnapshot(false);
    }, delay);
  }

  private scheduleRetry(): void {
    if (this.snapshotTimer) {
      clearTimeout(this.snapshotTimer);
      this.snapshotTimer = undefined;
    }

    const delay = getRetryDelayMs(this.retryCount);
    this.retryCount += 1;
    this.snapshotTimer = setTimeout(() => {
      void this.refreshRadarSnapshot(this.radarFrames.length === 0);
    }, delay);
  }

  private updateMarkerFromEntity(): void {
    if (!this._config || !this.hass || !this.mapController) {
      return;
    }

    const resolved = resolvePreferredCoordinates(this.hass, this._config.entity);
    const markerCoordinates = {
      latitude: resolved.latitude,
      longitude: resolved.longitude,
    };
    const icon = resolveEntityIcon(this.hass, this._config.entity);

    const entityCoordinates = resolveEntityCoordinates(this.hass, this._config.entity);
    const coordinatesChanged = didCoordinatesChange(this.lastMarkerCoordinates, markerCoordinates);
    const markerVisible = this._config.show_marker !== false;

    if (markerVisible && (coordinatesChanged || entityCoordinates === undefined || this.lastMarkerCoordinates === undefined)) {
      this.mapController.setMarker([markerCoordinates.latitude, markerCoordinates.longitude], icon, true);
      this.lastMarkerCoordinates = markerCoordinates;
      return;
    }

    this.mapController.setMarker([markerCoordinates.latitude, markerCoordinates.longitude], icon, markerVisible);
  }
}
