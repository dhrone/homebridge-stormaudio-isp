<p align="center">
<img src="https://github.com/homebridge/branding/raw/latest/logos/homebridge-wordmark-logo-vertical.png" width="150">
</p>

# Homebridge StormAudio ISP

A [Homebridge](https://homebridge.io) plugin for controlling StormAudio ISP processors via Apple HomeKit.

## Features

- **Power control** — turn your processor on/off from the Home app or Siri
- **Volume control** — set volume to a specific level via a fan or lightbulb proxy service
- **Mute/unmute** — toggle mute via the volume proxy's on/off switch
- **Volume buttons** — use the iOS Control Center remote widget for relative volume up/down
- **Sleep detection** — automatically wakes the processor when you send a command
- **Bidirectional sync** — changes made on the processor (remote, front panel) are reflected in HomeKit in real time

## Installation

### Via Homebridge UI

Search for `homebridge-stormaudio-isp` in the Homebridge plugin search.

### Via CLI

```shell
npm install -g homebridge-stormaudio-isp
```

## Configuration

Add the platform to the `platforms` array in your Homebridge `config.json`:

```json
{
  "platforms": [
    {
      "platform": "StormAudioISP",
      "name": "Theater",
      "host": "192.168.1.100",
      "port": 23,
      "volumeCeiling": -20,
      "volumeFloor": -80,
      "volumeControl": "fan"
    }
  ]
}
```

### Options

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `platform` | Yes | — | Must be `"StormAudioISP"` |
| `name` | No | `"StormAudio"` | Display name in HomeKit. Avoid names that match iOS apps (see [Naming Tips](#naming-tips)). |
| `host` | Yes | — | IP address or hostname of your StormAudio ISP |
| `port` | No | `23` | TCP port for the StormAudio API |
| `volumeCeiling` | No | `-20` | Maximum volume in dB (0 to -100). Maps to 100% in HomeKit. |
| `volumeFloor` | No | `-100` | Minimum volume in dB (0 to -100). Maps to 0% in HomeKit. Must be less than `volumeCeiling`. |
| `volumeControl` | No | `"fan"` | Volume proxy service type: `"fan"` (recommended), `"lightbulb"`, or `"none"` |
| `inputs` | No | `{}` | Input name aliases, e.g. `{ "3": "Apple TV", "5": "PS5" }` |

### Volume Control Options

The StormAudio processor appears as a **Television** accessory in HomeKit. Apple's Television service does not support Siri voice commands for volume — only the iOS Control Center remote widget's physical volume buttons work. To enable Siri voice control and a visual volume slider, a proxy service is used.

| Option | Service | Siri Volume | "Turn off all lights" safe? | Recommended |
|--------|---------|-------------|----------------------------|-------------|
| `"fan"` | Fan (speed slider) | Yes | Yes | **Yes** |
| `"lightbulb"` | Lightbulb (brightness slider) | Yes | **No** — will mute your processor | No |
| `"none"` | None | No | N/A | Only if using remote widget exclusively |

**Fan is the default and recommended option.** The lightbulb option works well but has a known hazard: saying "turn off all the lights" or running a "Goodnight" scene that includes lights will mute your processor.

## Siri Voice Commands

These commands work with the volume proxy service (fan or lightbulb):

| Command | Action |
|---------|--------|
| "Set **Theater** to 50%" | Sets volume to 50% of your configured range |
| "Turn off **Theater**" | Powers off the processor (and mutes via proxy) |
| "Turn on **Theater**" | Powers on the processor |
| "Set **Theater** to 25%" | Sets volume to 25% |

Replace **Theater** with whatever you set as your `name` in the config.

### Commands that do NOT work (Apple limitations)

| Command | Why |
|---------|-----|
| "Set **Theater** volume to 50%" | Siri doesn't support TV volume commands |
| "Mute **Theater**" | No HomeKit mute command exists |
| "Switch **Theater** to PS5" | Siri doesn't support TV input switching |

**Workaround for input switching:** Create HomeKit Scenes that set the input, then say "Hey Siri, set Movie Night" to activate the scene.

## iOS Control Center Remote

When you add the StormAudio accessory to HomeKit, it appears in the iOS Control Center remote widget:

- **Volume buttons** (physical side buttons) — send volume up/down to the processor
- **Mute button** (speaker icon, upper left) — toggles mute. Note: the icon may not visually update due to a known iOS limitation with Television accessories.

The remote widget provides relative volume control only (up/down). For absolute volume (set to a specific level), use Siri or the volume proxy slider in the Home app.

## Naming Tips

- **Avoid app name conflicts** — if your accessory name matches an iOS app name (e.g., "StormAudio"), Siri may route commands to the app instead of HomeKit. Use a unique name like "Theater", "Processor", or "ISP".
- **Avoid reserved words** — words like "volume", "brightness", "temperature" in the name can confuse Siri's intent parsing.
- **Keep it short** — one or two words works best for Siri recognition.
- **Use rooms** — assign the accessory to a room in HomeKit. Siri uses room context for disambiguation, so you don't need to include the room name in the accessory name.

## Development

```shell
npm install
npm run build
npm run test
npm run lint
npm link    # register with local Homebridge
homebridge -D
```

## License

Apache-2.0
