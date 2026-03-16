<p align="center">
<img src="https://github.com/homebridge/branding/raw/latest/logos/homebridge-wordmark-logo-vertical.png" width="150">
</p>

# homebridge-stormaudio-isp

A [Homebridge](https://homebridge.io) plugin for controlling StormAudio ISP immersive sound processors via Apple HomeKit. Control power, volume, mute, and input selection using the Home app and Siri.

## Features

- **Power control** -- turn your processor on and off from the Home app or Siri, with automatic wake-from-sleep handling
- **Volume control** -- set volume to a specific level via a configurable fan or lightbulb proxy service, with safety floor and ceiling limits
- **Mute/unmute** -- toggle mute via the volume proxy's on/off switch
- **Volume buttons** -- use the iOS Control Center remote widget for relative volume up/down
- **Input switching** -- switch between inputs in the Home app, with optional Siri-friendly aliases
- **Bidirectional sync** -- changes made on the processor (remote, front panel, StormAudio app) are reflected in HomeKit in real time
- **Connection resilience** -- automatic reconnection with exponential backoff, keepalive monitoring, and indefinite long-poll recovery
- **Child Bridge compatible** -- recommended configuration for isolation and stability

## Requirements

- **Homebridge** 1.8.0 or later (including 2.0 beta)
- **Node.js** 20.0.0 or later
- **StormAudio ISP processor** (ISP, ISP Elite, ISP Core, or other models with the TCP/IP control API)
- **Network** -- the processor must be reachable from the Homebridge host via TCP on port 23 (default). A static IP address or DHCP reservation for the processor is strongly recommended.

## Installation

### Via Homebridge UI (recommended)

1. Open the Homebridge UI in your browser.
2. Go to the **Plugins** tab.
3. Search for `homebridge-stormaudio-isp`.
4. Click **Install**.

### Via command line

```sh
npm install -g homebridge-stormaudio-isp
```

### Child Bridge (recommended)

Running this plugin as a Child Bridge is recommended. A Child Bridge runs the plugin in its own isolated process, so a plugin crash or restart does not affect the rest of Homebridge or your other accessories.

To enable Child Bridge in the Homebridge UI:

1. Go to the **Plugins** tab.
2. Click the wrench icon on **StormAudio ISP**.
3. Select **Bridge Settings**.
4. Enable **Run as Child Bridge**.

## Configuration

### Via Homebridge UI (recommended)

After installing the plugin, click **Settings** on the StormAudio ISP plugin card in the Homebridge UI. The settings form will guide you through all available options.

### Via config.json

Add the platform to the `platforms` array in your Homebridge `config.json`:

```json
{
  "platforms": [
    {
      "platform": "StormAudioISP",
      "name": "Theater",
      "host": "192.168.1.100"
    }
  ]
}
```

### Configuration Reference

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `platform` | Yes | -- | Must be `"StormAudioISP"` |
| `name` | No | `"StormAudio"` | Display name for the accessory in HomeKit |
| `host` | **Yes** | -- | IP address or hostname of your StormAudio ISP processor |
| `port` | No | `23` | TCP port for the StormAudio control API (1--65535) |
| `volumeCeiling` | No | `-20` | Maximum volume in dB. Maps to 100% in HomeKit. Range: -100 to 0. |
| `volumeFloor` | No | `-100` | Minimum volume in dB. Maps to 0% in HomeKit. Range: -100 to 0. Must be less than `volumeCeiling`. |
| `volumeControl` | No | `"fan"` | Volume proxy service type: `"fan"`, `"lightbulb"`, or `"none"` |
| `inputs` | No | `{}` | Input name aliases (see below) |

#### Volume Ceiling and Floor (safety feature)

The `volumeCeiling` and `volumeFloor` settings define the usable volume range. HomeKit's 0--100% scale is mapped to this range:

- **0%** in HomeKit = `volumeFloor` (default: -100 dB)
- **100%** in HomeKit = `volumeCeiling` (default: -20 dB)

This means that even if someone sets volume to 100% via Siri or the Home app, the processor will never exceed your configured ceiling. If your comfortable listening range is -60 dB to -20 dB, set `volumeFloor` to `-60` and `volumeCeiling` to `-20`. Each percentage point then represents a finer adjustment within that range.

#### Volume Control Options

The StormAudio processor appears as a Television accessory in HomeKit. Apple's Television service does not support Siri voice commands for setting volume to a specific level -- only the iOS Control Center remote widget's physical volume buttons work natively. To enable Siri voice control ("Set Theater to 50%") and a visual volume slider, a proxy service is used.

| Option | Service Type | Siri Volume | "Turn off all lights" safe? | Recommended |
|--------|-------------|-------------|----------------------------|-------------|
| `"fan"` | Fan (speed slider) | Yes | Yes | **Yes** |
| `"lightbulb"` | Lightbulb (brightness slider) | Yes | **No** -- will mute your processor | No |
| `"none"` | Disabled | No | N/A | Only if using remote widget exclusively |

**Fan is the default and recommended option.** The lightbulb option works identically but has a hazard: saying "turn off all the lights" or running a scene that turns off all lights will also mute your processor, because HomeKit treats the lightbulb proxy as a light.

#### Input Aliases

By default, the plugin imports input names directly from your StormAudio processor (e.g., "HDMI 1", "HDMI 2", "AES/EBU 1"). You can override any input name with a Siri-friendly alias using the `inputs` field.

The keys are the input ID numbers (as strings), and the values are your preferred display names:

```json
{
  "platforms": [
    {
      "platform": "StormAudioISP",
      "name": "Theater",
      "host": "192.168.1.100",
      "volumeCeiling": -20,
      "volumeFloor": -60,
      "volumeControl": "fan",
      "inputs": {
        "3": "Apple TV",
        "5": "PS5",
        "7": "Turntable"
      }
    }
  ]
}
```

To find input IDs, start the plugin and check the Homebridge log. The plugin logs each input with its ID and name when it first connects to the processor.

## How It Works

### Architecture

The plugin connects to your StormAudio ISP processor over a persistent TCP connection (port 23 by default). The processor broadcasts its full state on connection and sends real-time updates whenever anything changes. The plugin exposes the processor as a HomeKit Television accessory with linked services for speaker control and volume.

No polling is used. All state updates are event-driven, providing sub-second bidirectional sync between HomeKit and the processor.

### Power Control

- **Power on** from HomeKit sends a wake command to the processor. If the processor is in sleep mode, it goes through an initialization phase before reaching the active state. The plugin waits up to 90 seconds for the processor to become active before timing out.
- **Power off** from HomeKit sends the processor to sleep mode.
- Power changes made on the processor (front panel, IR remote, StormAudio app) are reflected in HomeKit immediately.

### Volume Control

Volume is controlled through three interfaces:

1. **Volume proxy (fan or lightbulb)** -- provides a slider in the Home app and supports Siri commands like "Set Theater to 50%". The on/off state of the proxy controls mute.
2. **Control Center remote widget** -- the iOS volume buttons send relative volume up/down commands.
3. **TelevisionSpeaker service** -- provides volume characteristics to HomeKit but is not directly controllable by Siri (an Apple limitation).

All three interfaces stay in sync. A volume change from any source (HomeKit, processor remote, front panel) updates all interfaces simultaneously.

### Input Switching

Inputs are automatically imported from the processor on first connection and displayed in the Home app's input picker for the Television accessory. If you have configured input aliases, those names are used instead of the processor's default names.

### Connection Resilience

The plugin maintains a persistent connection with the following recovery behavior:

1. **Keepalive monitoring** -- a keepalive is sent every 30 seconds. If no response is received within 10 seconds, the connection is considered stale and torn down.
2. **Exponential backoff reconnection** -- on connection loss, the plugin retries with increasing delays: 1s, 2s, 4s, 8s, 16s, 16s (6 attempts). Each attempt has a 10-second connect timeout.
3. **Long-poll recovery** -- if all 6 reconnection attempts fail, the plugin enters long-poll mode, retrying every 20 seconds indefinitely until the processor comes back online.
4. **Full state re-sync** -- on successful reconnection, the processor sends its complete state, so the plugin is always up to date.

During disconnection, the accessory shows as **Inactive** in HomeKit. Any commands sent while disconnected are rejected with a "Not Responding" error.

## Siri Voice Commands

These commands work with the volume proxy service (fan or lightbulb mode):

| Command | Action |
|---------|--------|
| "Set **Theater** to 50%" | Sets volume to 50% of your configured range |
| "Turn off **Theater**" | Powers off the processor |
| "Turn on **Theater**" | Powers on the processor |

Replace **Theater** with whatever you set as your `name` in the configuration.

### Commands That Do Not Work (Apple Limitations)

| Command | Why |
|---------|-----|
| "Set **Theater** volume to 50%" | Siri does not support TV volume commands |
| "Mute **Theater**" | No HomeKit mute voice command exists |
| "Switch **Theater** to Apple TV" | Siri does not support TV input switching via voice |

**Workaround for input switching:** Create a HomeKit Scene that sets the desired input, then activate it with Siri: "Hey Siri, Movie Night."

## iOS Control Center Remote

When you add the StormAudio accessory to HomeKit, it appears in the iOS Control Center remote widget:

- **Volume buttons** (physical side buttons) -- send volume up/down to the processor
- **Mute button** (speaker icon) -- toggles mute

The remote widget provides relative volume control only (up/down). For absolute volume (set to a specific level), use Siri or the volume proxy slider in the Home app.

## Naming Tips

- **Avoid app name conflicts** -- if your accessory name matches an iOS app name (e.g., "StormAudio"), Siri may route commands to the app instead of HomeKit. Use a unique name like "Theater", "Processor", or "ISP".
- **Avoid reserved words** -- words like "volume", "brightness", or "temperature" in the name can confuse Siri's intent parsing.
- **Keep it short** -- one or two words works best for Siri recognition.
- **Use rooms** -- assign the accessory to a room in HomeKit. Siri uses room context for disambiguation, so you do not need to include the room name in the accessory name.

## Troubleshooting

### "Not Responding" in HomeKit

The accessory shows as inactive or not responding when the plugin cannot communicate with the processor. Common causes:

- The processor is powered off or in deep sleep
- The network connection between Homebridge and the processor is down
- The processor's IP address has changed (use a static IP or DHCP reservation)

Check the Homebridge log for `[TCP]` messages. The plugin logs all connection attempts, failures, and reconnections. The plugin will continue retrying indefinitely.

### Plugin Not Finding the Processor

- Verify the IP address in your configuration matches the processor's actual IP
- Confirm the processor is on the same network as your Homebridge host
- Check that TCP port 23 (or your configured port) is not blocked by a firewall
- Try pinging the processor's IP from the Homebridge host
- The processor must be powered on (at least in standby/sleep mode, not unplugged)

### Volume Not Responding to Siri

- Make sure `volumeControl` is set to `"fan"` or `"lightbulb"` (not `"none"`)
- Use the accessory name in your command: "Set **Theater** to 50%", not "Set the volume to 50%"
- Avoid names that conflict with other accessories or iOS apps
- See the [Naming Tips](#naming-tips) section

### Inputs Not Showing

Inputs are imported from the processor on the first connection. If inputs are not appearing:

1. Check the Homebridge log for `[HomeKit] Input sources registered` messages
2. Restart Homebridge after the first successful connection -- HomeKit may need a fresh pairing to display newly added InputSource services
3. In the Home app, long-press the accessory, tap **Settings**, and check if inputs appear under the input list

### Understanding Log Messages

The plugin uses structured log prefixes:

| Prefix | Category | What to look for |
|--------|----------|-----------------|
| `[Config]` | Configuration | Validation errors on startup -- check if your config is correct |
| `[TCP]` | Connection | Connect/disconnect events, reconnection attempts, keepalive status |
| `[Command]` | Protocol | Commands sent and received (debug level) |
| `[State]` | Processor state | Power state transitions, wake timeouts, input list imports |
| `[HomeKit]` | Accessory | Service registration, characteristic updates |

To see debug-level messages, start Homebridge with the `-D` flag or enable debug mode in the Homebridge UI settings.

## Known Limitations

- **Siri relative volume commands** -- Siri has difficulty routing relative volume commands ("turn it up", "turn it down") to the correct accessory. Use absolute commands ("set Theater to 50%") for reliable Siri volume control.
- **Single processor** -- the plugin supports one StormAudio processor per platform instance. If you have multiple processors, add a separate `StormAudioISP` platform entry for each one.
- **No auto-discovery** -- you must manually configure the processor's IP address. Auto-discovery via mDNS/Bonjour may be added in a future release.
- **Volume step granularity** -- the processor uses 1 dB steps. With a wide volume range (e.g., 80 dB span), some adjacent percentage values may map to the same dB level and produce no audible change.
- **Mute icon in Control Center** -- the mute button icon in the iOS Control Center remote widget may not always visually reflect the current mute state, due to a known iOS limitation with Television accessories.

## Development

```sh
npm install
npm run build
npm run test
npm run lint
```

## License

[Apache-2.0](LICENSE)
