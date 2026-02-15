import type { HomeAssistant } from 'custom-card-helpers';

import { DEFAULT_CENTER } from './config';
import type { Coordinates } from './types';

export interface ResolvedCoordinates extends Coordinates {
  source: 'entity' | 'home' | 'default';
}

export const isSupportedEntityDomain = (entityId: string): boolean =>
  entityId.startsWith('device_tracker.') || entityId.startsWith('person.');

const toBoundedNumber = (value: unknown, min: number, max: number): number | undefined => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  if (numeric < min || numeric > max) {
    return undefined;
  }
  return numeric;
};

export const coordinatesFromState = (state: { attributes?: Record<string, unknown> } | undefined): Coordinates | undefined => {
  if (!state?.attributes) {
    return undefined;
  }

  const latitude = toBoundedNumber(state.attributes.latitude, -90, 90);
  const longitude = toBoundedNumber(state.attributes.longitude, -180, 180);
  if (latitude === undefined || longitude === undefined) {
    return undefined;
  }

  return { latitude, longitude };
};

export const resolveEntityCoordinates = (hass: HomeAssistant, entityId: string): Coordinates | undefined => {
  const state = hass.states[entityId];
  return coordinatesFromState(state);
};

export const resolveHomeCoordinates = (hass: HomeAssistant): Coordinates | undefined => {
  const latitude = toBoundedNumber(hass.config.latitude, -90, 90);
  const longitude = toBoundedNumber(hass.config.longitude, -180, 180);
  if (latitude === undefined || longitude === undefined) {
    return undefined;
  }
  return { latitude, longitude };
};

export const resolvePreferredCoordinates = (hass: HomeAssistant, entityId: string): ResolvedCoordinates => {
  const entityCoordinates = resolveEntityCoordinates(hass, entityId);
  if (entityCoordinates) {
    return { ...entityCoordinates, source: 'entity' };
  }

  const homeCoordinates = resolveHomeCoordinates(hass);
  if (homeCoordinates) {
    return { ...homeCoordinates, source: 'home' };
  }

  return { ...DEFAULT_CENTER, source: 'default' };
};

const defaultIconForEntity = (entityId: string, stateValue: string): string => {
  if (entityId.startsWith('person.')) {
    return stateValue === 'home' ? 'mdi:home-account' : 'mdi:account-circle';
  }
  if (entityId.startsWith('device_tracker.')) {
    return stateValue === 'home' ? 'mdi:home-map-marker' : 'mdi:crosshairs-gps';
  }
  return 'mdi:map-marker';
};

export const resolveEntityIcon = (hass: HomeAssistant, entityId: string): string => {
  const state = hass.states[entityId];
  const entityIcon = state?.attributes?.icon;
  if (typeof entityIcon === 'string' && entityIcon.trim().length > 0) {
    return entityIcon;
  }
  return defaultIconForEntity(entityId, String(state?.state ?? ''));
};

export const resolveEntityName = (hass: HomeAssistant, entityId: string): string => {
  const friendlyName = hass.states[entityId]?.attributes?.friendly_name;
  if (typeof friendlyName === 'string' && friendlyName.trim().length > 0) {
    return friendlyName;
  }
  return entityId;
};

export const didCoordinatesChange = (previous: Coordinates | undefined, next: Coordinates): boolean => {
  if (!previous) {
    return true;
  }
  return previous.latitude !== next.latitude || previous.longitude !== next.longitude;
};

