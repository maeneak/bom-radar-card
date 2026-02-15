import { css, type CSSResultGroup } from 'lit';

export const cardStyles: CSSResultGroup = css`
  :host {
    display: block;
  }

  ha-card {
    overflow: hidden;
  }

  .card-root {
    position: relative;
  }

  .map-wrap {
    position: relative;
    width: 100%;
    aspect-ratio: 4 / 3;
    background: var(--disabled-color);
  }

  .map {
    position: absolute;
    inset: 0;
  }

  .progress-track {
    height: 6px;
    background-color: var(--divider-color);
  }

  .progress-bar {
    height: 100%;
    width: 0;
    background: var(--primary-color);
    transition: width 160ms linear;
  }

  .footer {
    min-height: 22px;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    padding: 4px 8px;
    font-size: 11px;
    line-height: 1.2;
    color: var(--secondary-text-color);
    border-top: 1px solid var(--divider-color);
  }

  .footer-meta {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    width: 100%;
  }

  .color-bar {
    display: block;
    width: 100%;
    height: 8px;
    object-fit: cover;
    border-bottom: 1px solid var(--divider-color);
  }

  .tracker-marker {
    width: 30px;
    height: 30px;
    border-radius: 9999px;
    background: var(--card-background-color);
    color: var(--state-icon-color, var(--primary-color));
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
    border: 1px solid var(--divider-color);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .tracker-marker ha-icon {
    --mdc-icon-size: 18px;
    display: inline-flex;
  }

  .recenter-btn {
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    line-height: 1;
    color: var(--primary-text-color);
    background: var(--card-background-color);
    text-decoration: none;
  }

  .leaflet-control-zoom a {
    color: var(--primary-text-color);
    background: var(--card-background-color);
  }
`;
