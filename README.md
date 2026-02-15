# BOM Raster Radar Card

A Home Assistant custom card that displays Bureau of Meteorology (BoM) rain radar data using WMTS raster tiles.

[![hacs_badge](https://img.shields.io/badge/HACS-Default-orange.svg?style=for-the-badge)](https://github.com/hacs/integration)
[![GitHub Release][releases-shield]][releases]
[![License][license-shield]](LICENSE)
![Maintenance](https://img.shields.io/maintenance/yes/2025?style=for-the-badge)

## Contributors

- Hayden Kliese <hayden@kliese.net>
- Simon Ratcliffe <simon@makin-things.com>

## Description

BoM radar products (mobile app and https://weather.bom.gov.au/) are served as WMTS raster tiles.
This card renders those tiles in Home Assistant with:

- Light and dark basemap styles
- Configurable frame animation
- Optional map controls (zoom, recenter, scale)
- Optional home marker and location override

![BOM Raster Radar card](https://raw.githubusercontent.com/makin-things/bom-radar-card/master/bom-radar-card.gif)

## Configuration

The card supports the visual editor, so you usually do not need to hand-edit YAML.

If location fields are left blank, the card falls back to your Home Assistant default latitude/longitude.

| Name                 | Type    | Requirement  | Description                                | Default                                |
| -------------------- | ------- | ------------ | ------------------------------------------ | -------------------------------------- |
| type                 | string  | **Required** | Card type                                  | `custom:bom-raster-radar-card`        |
| card_title           | string  | **Optional** | Title text shown above the card            | no title                               |
| map_style            | string  | **Optional** | Basemap style (`Light` or `Dark`)          | `Light`                                |
| zoom_level           | number  | **Optional** | Initial map zoom (3-10)                    | `8`                                    |
| center_latitude      | number  | **Optional** | Initial map center latitude                | HA default latitude                    |
| center_longitude     | number  | **Optional** | Initial map center longitude               | HA default longitude                   |
| show_marker          | boolean | **Optional** | Show home marker                           | `true`                                 |
| marker_latitude      | number  | **Optional** | Marker latitude                            | same as center/HA default              |
| marker_longitude     | number  | **Optional** | Marker longitude                           | same as center/HA default              |
| frame_count          | number  | **Optional** | Number of radar frames in loop             | `7`                                    |
| frame_delay          | number  | **Optional** | Delay between frames (ms)                  | `250`                                  |
| restart_delay        | number  | **Optional** | Pause on final frame before restart (ms)   | `1000`                                 |
| overlay_transparency | number  | **Optional** | Radar overlay transparency percent (0-90)  | `0`                                    |
| show_zoom            | boolean | **Optional** | Show zoom control (top-right)              | `true`                                 |
| show_recenter        | boolean | **Optional** | Show recenter control (bottom-right)       | `true`                                 |
| show_scale           | boolean | **Optional** | Show scale control (bottom-left)           | `true`                                 |

## Example

```yaml
type: custom:bom-raster-radar-card
card_title: Rain Radar
map_style: Light
zoom_level: 8
frame_count: 7
frame_delay: 250
restart_delay: 1000
overlay_transparency: 0
show_zoom: true
show_marker: true
show_recenter: true
show_scale: true
```

## Installation

### HACS

Install via HACS as usual.
If your resource is not auto-added, add:

```yaml
resources:
  - url: /hacsfiles/bom-radar-card/bom-raster-radar-card.js
    type: module
```

### Manual

Download release files and place them in:

`config/www/community/bom-raster-radar-card/`

Expected files:

```text
bom-raster-radar-card.js
assets/home-circle-dark.svg
assets/home-circle-light.svg
assets/radar-colour-bar.png
assets/recenter.png
```

Then add:

```yaml
resources:
  - url: /local/community/bom-raster-radar-card/bom-raster-radar-card.js
    type: module
```

## Migration Notes

- New primary card type: `custom:bom-raster-radar-card`
- New primary JS file: `bom-raster-radar-card.js`
- Backward compatibility is kept for existing dashboards using `custom:bom-radar-card`

## Known Issues

- Marker drift after editing card settings:
  Occasionally after editing/saving, the marker may look slightly offset in preview/live views.
  Refresh the browser or Home Assistant app to correct it.

## Acknowledgements

A major rewrite of this card was provided by Hayden Kliese <hayden@kliese.net>.

[license-shield]: https://img.shields.io/github/license/makin-things/bom-radar-card.svg?style=for-the-badge
[releases-shield]: https://img.shields.io/github/release/makin-things/bom-radar-card.svg?style=for-the-badge
[releases]: https://github.com/makin-things/bom-radar-card/releases
