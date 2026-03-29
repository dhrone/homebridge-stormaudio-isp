# Changelog

## [Unreleased]

## [1.0.0] - 2026-03-20

Initial release.

### Power

- Turn the processor on and off from the Home app or Siri, with automatic wake-from-sleep handling and configurable boot timeout

### Volume

- Set volume to a specific level via a fan or lightbulb proxy service, with safety floor and ceiling limits to protect your speakers
- Mute/unmute via the volume proxy's on/off switch
- ~~Relative volume via iOS Control Center remote~~ — removed due to HomeKit reliability limitations; use absolute volume (slider or "set Theater to 50%") instead

### Input Selection

- Switch between inputs in the Home app, with input names imported directly from the processor and optional aliases for Siri-friendly naming

### Zone 2

- Control a second audio zone (e.g., patio speakers) as a separate Television accessory in HomeKit
- Independent power (mute/unmute), volume, and mute control per zone
- Zone 2 source selection: Follow Main mode or independent source switching (when zone has its own audio inputs)
- Dynamic zone dropdown in the Homebridge Config UI -- select Zone 2 from available zones without reading log files

### Presets

- Expose theater presets as a dedicated Television accessory in HomeKit
- Presets auto-imported from the processor at connection time
- Alias support: override processor preset names for Siri-friendly display names
- Bidirectional sync: preset changes from any source (front panel, web UI, HomeKit) reflected in real time

### Triggers

- Expose hardware relay outputs (triggers 1–4) as HomeKit accessories
- Configurable per trigger: Switch (bidirectional on/off control) or Contact Sensor (read-only, usable as automation trigger)
- Each trigger is a separate accessory -- assign to any HomeKit room
- Bidirectional state sync: trigger changes from auto-switching, manual override, or HomeKit all stay in sync

### Connection

- Automatic reconnection with exponential backoff, keepalive monitoring, and indefinite long-poll recovery
- Full state re-sync on reconnection (power, volume, mute, input, Zone 2, presets, triggers)

### Configuration

- Command interval throttle (`commandInterval`, default 100 ms) prevents dropped commands on rapid input
- Zone 2 Config UI dropdown -- select zone from live processor zone list without manual ID entry
- All configuration fields available via the Homebridge Config UI settings form

### Logging & Diagnostics

- Structured log prefixes ([Config], [TCP], [Command], [State], [HomeKit]) for easy troubleshooting
