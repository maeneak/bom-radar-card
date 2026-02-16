# RainViewer Radar Card

A Home Assistant Lovelace custom card that shows animated rain radar frames (RainViewer) on a Leaflet map.

[![hacs_badge](https://img.shields.io/badge/HACS-Default-orange.svg?style=for-the-badge)](https://github.com/hacs/integration)
[![GitHub Release][releases-shield]][releases]
[![License][license-shield]](LICENSE)

## Version 5 highlights

- Modern card API: `getGridOptions` and `getConfigForm`.
- Sections grid defaults: 2 columns x 3 rows.
- Native HA visual style and header behavior.
- Entity-driven location: `entity` is now required (`device_tracker` or `person`).
- Marker icon derived from entity icon semantics (icon-only marker).
- Unit-test coverage for config/entity/radar helper logic.

## Breaking changes from v4

1. `entity` is required.
2. Removed config keys:
   - `center_latitude`
   - `center_longitude`
   - `marker_latitude`
   - `marker_longitude`
3. Card type is now `custom:rainviewer-radar-card`.
4. Minimum Home Assistant version is now `2025.2.0`.

## Configuration

| Name | Type | Required | Description | Default |
| --- | --- | --- | --- | --- |
| `type` | string | Yes | Card type | `custom:rainviewer-radar-card` |
| `entity` | string | Yes | Tracker entity (`device_tracker.*` or `person.*`) | none |
| `card_title` | string | No | Optional card header title | entity friendly name |
| `hide_header` | boolean | No | Hide header/title area entirely | `false` |
| `map_style` | string | No | ArcGIS satellite basemap (`World_Imagery`) | `Light` |
| `zoom_level` | number | No | Initial zoom (3-10) | `8` |
| `show_marker` | boolean | No | Show tracked marker | `true` |
| `show_zoom` | boolean | No | Show zoom control | `true` |
| `show_recenter` | boolean | No | Show recenter control | `true` |
| `show_scale` | boolean | No | Show scale control | `true` |
| `frame_count` | number | No | Number of radar frames in loop | `7` |
| `frame_delay` | number | No | Delay between frames (ms) | `250` |
| `restart_delay` | number | No | Pause on last frame (ms) | `1000` |
| `overlay_transparency` | number | No | Radar transparency 0-90 (%) | `0` |

## Example

```yaml
type: custom:rainviewer-radar-card
entity: device_tracker.pixel_phone
card_title: Rain Radar
hide_header: false
map_style: Light
zoom_level: 8
frame_count: 7
frame_delay: 250
restart_delay: 1000
overlay_transparency: 10
show_marker: true
show_zoom: true
show_recenter: true
show_scale: true
```

## Migration example

### v4

```yaml
center_latitude: -33.86
center_longitude: 151.2
marker_latitude: -33.86
marker_longitude: 151.2
```

### v5

```yaml
type: custom:rainviewer-radar-card
entity: device_tracker.phone
```

The map initializes center from the entity if valid, and falls back to Home Assistant home coordinates if not.

## Installation

### HACS

Install from HACS, then confirm resource:

```yaml
resources:
  - url: /hacsfiles/rainviewer-radar-card/rainviewer-radar-card.js
    type: module
```

### Manual

Place release files in:

`config/www/community/rainviewer-radar-card/`

Then add:

```yaml
resources:
  - url: /local/community/rainviewer-radar-card/rainviewer-radar-card.js
    type: module
```

## Development

```bash
npm install
npm run lint
npm run test:run
npm run build
```

[license-shield]: https://img.shields.io/github/license/makin-things/rainviewer-radar-card.svg?style=for-the-badge
[releases-shield]: https://img.shields.io/github/release/makin-things/rainviewer-radar-card.svg?style=for-the-badge
[releases]: https://github.com/makin-things/rainviewer-radar-card/releases
