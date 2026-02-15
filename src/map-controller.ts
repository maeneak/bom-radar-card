import * as L from 'leaflet';

import type { BomMapStyle } from './types';

interface RecenterControlOptions extends L.ControlOptions {
  onRecenter: () => void;
}

class RecenterControl extends L.Control {
  private readonly onRecenter: () => void;

  public constructor(options: RecenterControlOptions) {
    super(options);
    this.onRecenter = options.onRecenter;
  }

  public override onAdd(): HTMLElement {
    const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
    const button = L.DomUtil.create('a', 'recenter-btn', container) as HTMLAnchorElement;
    button.href = '#';
    button.title = 'Recenter map';
    button.role = 'button';
    button.setAttribute('aria-label', 'Recenter map');
    button.innerHTML = '<span aria-hidden="true">◎</span>';
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.on(button, 'click', (event) => {
      L.DomEvent.preventDefault(event);
      this.onRecenter();
    });
    return container;
  }
}

export interface MapControllerOptions {
  container: HTMLElement;
  center: [number, number];
  zoom: number;
  mapStyle: BomMapStyle;
  showScale: boolean;
  showZoom: boolean;
  showRecenter: boolean;
  imperialScale: boolean;
  onRecenter: () => void;
}

interface BaseLayerConfig {
  tileUrl: string;
  maxZoom: number;
  attribution: string;
  subdomains?: string;
}

const escapeHtml = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const getBaseLayerConfig = (style: BomMapStyle): BaseLayerConfig => {
  if (style === 'Dark') {
    return {
      tileUrl: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      maxZoom: 20,
      subdomains: 'abcd',
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    };
  }

  return {
    tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  };
};

export class MapController {
  private readonly map: L.Map;
  private baseLayer?: L.TileLayer;
  private marker?: L.Marker;
  private readonly radarTileLayers = new Map<string, L.TileLayer>();

  public constructor(private readonly options: MapControllerOptions) {
    this.map = L.map(options.container, {
      center: options.center,
      zoom: options.zoom,
      minZoom: 3,
      maxZoom: 10,
      maxBounds: L.latLngBounds([-47, 109], [-7, 158.1]),
      maxBoundsViscosity: 1.0,
      attributionControl: false,
      zoomControl: false,
    });

    this.setMapStyle(options.mapStyle);

    if (options.showScale) {
      L.control
        .scale({
          metric: !options.imperialScale,
          imperial: options.imperialScale,
          position: 'bottomleft',
        })
        .addTo(this.map);
    }

    if (options.showZoom) {
      L.control.zoom({ position: 'topright' }).addTo(this.map);
    }

    if (options.showRecenter) {
      this.map.addControl(new RecenterControl({ position: 'bottomright', onRecenter: options.onRecenter }));
    }
  }

  public setMapStyle(style: BomMapStyle): void {
    const baseLayerConfig = getBaseLayerConfig(style);

    if (this.baseLayer) {
      this.map.removeLayer(this.baseLayer);
    }

    this.baseLayer = L.tileLayer(baseLayerConfig.tileUrl, {
      maxZoom: baseLayerConfig.maxZoom,
      attribution: baseLayerConfig.attribution,
      subdomains: baseLayerConfig.subdomains,
    });
    this.baseLayer.addTo(this.map);
  }

  public setView(center: [number, number], zoom: number): void {
    this.map.setView(center, zoom);
  }

  public getZoom(): number {
    return this.map.getZoom();
  }

  public invalidateSize(): void {
    this.map.invalidateSize();
  }

  public setMarker(position: [number, number], icon: string, visible: boolean): void {
    if (!visible) {
      this.marker?.remove();
      return;
    }

    const markerIcon = L.divIcon({
      className: 'tracker-marker-wrapper',
      html: `<div class="tracker-marker"><ha-icon icon="${escapeHtml(icon)}"></ha-icon></div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });

    if (!this.marker) {
      this.marker = L.marker(position, { icon: markerIcon });
      this.marker.addTo(this.map);
      return;
    }

    this.marker.setLatLng(position);
    this.marker.setIcon(markerIcon);
    this.marker.addTo(this.map);
  }

  public setRadarLayer(layerId: string, tileUrl: string): void {
    if (this.radarTileLayers.has(layerId)) {
      return;
    }

    const layer = L.tileLayer(tileUrl, {
      opacity: 0,
      tileSize: 256,
      maxNativeZoom: 7,
      maxZoom: 10,
    });
    layer.addTo(this.map);
    this.radarTileLayers.set(layerId, layer);
  }

  public removeRadarLayer(layerId: string): void {
    const layer = this.radarTileLayers.get(layerId);
    if (!layer) {
      return;
    }

    this.map.removeLayer(layer);
    this.radarTileLayers.delete(layerId);
  }

  public setRadarLayerOpacity(layerId: string, opacity: number): void {
    this.radarTileLayers.get(layerId)?.setOpacity(opacity);
  }

  public clearRadarLayers(layerIds: string[]): void {
    for (const layerId of layerIds) {
      this.removeRadarLayer(layerId);
    }
  }

  public destroy(): void {
    this.marker?.remove();
    for (const layerId of this.radarTileLayers.keys()) {
      this.removeRadarLayer(layerId);
    }
    this.map.remove();
  }
}
