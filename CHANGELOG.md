# Changelog

## [Unreleased]

## [1.0.0] - 2026-03-16

Initial release.

### Features

- **Power control** -- turn the processor on and off from the Home app or Siri, with automatic wake-from-sleep handling and configurable boot timeout
- **Volume control** -- set volume to a specific level via a fan or lightbulb proxy service, with safety floor and ceiling limits to protect your speakers
- **Mute/unmute** -- toggle mute via the volume proxy's on/off switch
- **Volume buttons** -- use the iOS Control Center remote widget for relative volume up/down
- **Input switching** -- switch between inputs in the Home app, with input names imported directly from the processor and optional aliases for Siri-friendly naming
- **Bidirectional sync** -- changes made on the processor (remote, front panel, StormAudio app) are reflected in HomeKit in real time
- **Connection resilience** -- automatic reconnection with exponential backoff, keepalive monitoring, and indefinite long-poll recovery
- **Structured logging** -- categorized log prefixes ([Config], [TCP], [Command], [State], [HomeKit]) for easy troubleshooting
- **Plugin Settings GUI** -- full configuration via the Homebridge UI settings form
- **Child Bridge compatible** -- recommended configuration for isolation and stability
