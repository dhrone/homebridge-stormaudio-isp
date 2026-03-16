# Usage Guide

This guide explains what you can do with your StormAudio processor through Apple HomeKit once the plugin is installed and configured. It covers voice commands, the Home app, scenes, automations, and practical tips learned from real-world use.

For installation and configuration, see the [README](README.md).

---

## Quick Start

The only required configuration is your processor's IP address:

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

After starting Homebridge, the plugin connects to your processor, imports its input list, and publishes a Television accessory to HomeKit. Because the plugin runs on its own Child Bridge, you will need to add it to your Home app separately:

1. In the Homebridge UI, go to the **Status** tab. You will see the StormAudio Child Bridge listed with its own pairing QR code and setup code.
2. Open the **Home** app on your iPhone, tap **+**, then **Add Accessory**.
3. Scan the QR code from the Homebridge UI, or tap **More Options** and enter the setup code manually.
4. Once the bridge is added, HomeKit will ask you to configure the accessory (room assignment, name, etc.).

**What you will see in the Home app:**

- A **Television tile** named whatever you set as `name` (default: "StormAudio"). This controls power and input selection.
- A **Fan tile** (default) or **Lightbulb tile** for volume control. This is your primary way to set volume by percentage and to mute/unmute.
- An **input picker** inside the Television tile's detail view, listing all inputs imported from your processor.

**First-time tip:** Inputs are imported automatically from your processor every time Homebridge starts, and they update in real time whenever you rename inputs in the StormAudio installer UI. If input names appear generic, the best fix is to rename them directly in your StormAudio's configuration — the plugin will pick up the changes automatically.

---

## Controlling Your Theater

### Power

**Turn on:**
> "Hey Siri, turn on the Theater"

**Turn off:**
> "Hey Siri, turn off the Theater"

You can also tap the Television tile in the Home app.

**What happens when your processor is sleeping:** If the processor is in standby/sleep mode when you send a power-on command, the plugin automatically wakes it. The Home app tile shows "on" immediately, but the processor takes roughly 30 to 75 seconds to fully boot (depending on your model and whether it needs to load room calibration). During this time the processor is warming up -- just like a projector. Siri will not report an error; it simply takes a moment.

**What "Not Responding" means:** If the plugin loses its network connection to the processor (network outage, processor unplugged, etc.), the Home app tile will show the accessory as off or unresponsive. Once the connection is restored -- which the plugin handles automatically -- the tile returns to normal. You do not need to restart Homebridge. The plugin retries the connection on its own and will recover even if the processor was unreachable for an extended period.

---

### Volume

Volume is controlled through a **fan** (default) or **lightbulb** proxy service. This proxy appears as a separate tile in the Home app and gives you a slider for setting volume to a specific percentage.

**Set volume to a specific level:**
> "Hey Siri, set Theater to 50%"

This sets the volume to 50% of your configured range. Replace "Theater" with whatever you named your accessory.

**Why fan is recommended over lightbulb:** If you use the lightbulb option and someone says "Hey Siri, turn off all the lights" or activates a Goodnight scene that turns off lights, it will mute your processor. The fan option avoids this problem entirely.

**Why relative volume commands may not work reliably:**
Siri commands like "turn up the Theater" or "turn down the volume" are unreliable. This is a limitation of Apple's HomeKit platform, not the plugin. HomeKit has difficulty routing relative volume commands to the correct service. The workaround is to use absolute commands:

> "Hey Siri, set Theater to 60%"

This always works. Pick a few volume levels you use regularly (30% for background, 50% for normal, 70% for movies) and they become second nature.

**Volume ceiling safety feature:** The plugin includes a safety ceiling that prevents volume from ever exceeding a maximum level you configure. Even if someone asks Siri to "set Theater to 100%", the volume will only go as high as your ceiling setting (default: -20 dB). This protects your ears and your speakers.

**How percentage maps to decibels:** The plugin maps 0% to 100% across the range between your configured `volumeFloor` (default: -100 dB) and `volumeCeiling` (default: -20 dB). With defaults:

| You say | Volume set to |
|---------|---------------|
| "Set Theater to 0%" | -100 dB (silence) |
| "Set Theater to 25%" | -80 dB |
| "Set Theater to 50%" | -60 dB |
| "Set Theater to 75%" | -40 dB |
| "Set Theater to 100%" | -20 dB (your ceiling -- never higher) |

If you narrow the range (for example, `volumeFloor: -80` and `volumeCeiling: -20`), each percentage step covers a smaller decibel change, giving you finer control. With this example range, 50% would map to -50 dB.

**Volume buttons on the iOS Control Center remote:** The volume up/down buttons on the iOS Control Center remote widget do work. Each press changes the volume by 1 dB. These buttons are available even if you set `volumeControl` to `"none"`.

---

### Mute

**Mute by turning off the volume proxy:**
> "Hey Siri, turn off the Theater"

When the fan (or lightbulb) proxy is turned off, the processor mutes. When it is turned on, the processor unmutes and returns to the previous volume level.

You can also mute by tapping the fan/lightbulb tile in the Home app to toggle it off.

**Note:** Saying "Hey Siri, mute the Theater" does not work reliably. This is the same HomeKit platform limitation that affects relative volume. Use "turn off" and "turn on" instead -- it accomplishes the same thing.

**How mute interacts with volume display:** When the processor is muted, the fan/lightbulb tile shows as off. When unmuted, it shows as on and the slider reflects the current volume percentage. If someone mutes or unmutes using the processor's own remote or front panel, the Home app updates to match within about a second.

---

### Input Switching

**Switch inputs from the Home app:**
1. Long-press the Television tile to open its detail view
2. Tap the input selector
3. Choose the input you want

The processor switches immediately and the Home app confirms the selection.

**Switch inputs with Siri:**
> "Hey Siri, switch to TV on Theater"

Replace "TV" with the name of the input and "Theater" with your accessory name. Siri input switching works but can be sensitive to naming -- see the tips below.

**Naming your inputs:** The best way to get Siri-friendly input names is to **rename them directly in your StormAudio's configuration** (via the StormAudio web interface or remote app). The plugin reads input names from the processor and automatically updates HomeKit when you rename them. This keeps a single source of truth on the processor.

If you cannot change names on the processor, you can override individual inputs using aliases in the plugin configuration:

```json
{
  "inputs": {
    "1": "TV",
    "4": "PS5"
  }
}
```

The keys are the input IDs (visible in the Homebridge log on startup), and the values are the names you want to see in HomeKit. Aliases override the processor's names for those inputs only.

**Tips for input names:**

- **Short and distinctive names work best with Siri.** "TV", "PS5", "Roon" are better than "Living Room Television", "PlayStation 5 Console", "Roon Music Server".
- **Avoid names that overlap with other accessories.** If you have a smart TV accessory also named "TV", Siri may get confused. Use something like "Apple TV" or "Shield" instead.
- **You can also rename inputs directly in the Home app** by long-pressing the Television tile and editing input names. However, these Home app renames are cosmetic only -- they do not persist across re-pairings. Renaming on the processor is the most durable approach.

**Input switching from sleep:** HomeKit does not allow input switching when the Television accessory is shown as off. To switch inputs when the processor is sleeping, first turn it on ("Hey Siri, turn on the Theater"), wait for it to boot, then switch inputs.

---

## Scenes and Automations

HomeKit Scenes and Automations let you combine multiple actions into a single command or trigger. The plugin supports all the building blocks you need. For general instructions on creating scenes and automations, see Apple's guide: [Create scenes and automations with the Home app](https://support.apple.com/en-us/102313).

### Example: "Movie Night" Scene

Create a Scene in the Home app called "Movie Night" that:
- Turns on the Television accessory (powers on the processor)
- Sets the fan/lightbulb proxy to 40% (sets volume to your preferred movie level)
- Sets the input to Apple TV

Then say:
> "Hey Siri, Movie Night"

Everything happens at once. If the processor is sleeping, it wakes automatically.

### Example: "Goodnight" Automation

Create a time-based Automation that runs at 11:00 PM:
- Turns off the Television accessory (powers off the processor)

Or use a presence-based Automation:
- When the last person leaves the house, turn off the Television accessory

### What can be included in scenes and automations

| Action | How to set it |
|--------|---------------|
| Power on/off | Television accessory on/off |
| Volume level | Fan or lightbulb proxy brightness/speed percentage |
| Mute/unmute | Fan or lightbulb proxy on/off |
| Input selection | Television accessory active input |

### What cannot be automated (today)

- **Surround mode switching** -- not yet exposed to HomeKit
- **Preset activation** -- not yet exposed to HomeKit
- **Dynamic range compression (night mode)** -- not yet exposed to HomeKit
- **Trigger outputs** (screen, curtains) -- not yet exposed to HomeKit

These capabilities are recognized as future enhancements. The processor already reports this information to the plugin; it just has not been wired into HomeKit controls yet.

---

## Tips and Tricks

### Naming for Siri

The name you give your accessory in the plugin configuration is the name Siri uses to find it. Choose carefully:

- **"Theater"** works well -- it is short, unique, and unlikely to conflict with other accessories or apps.
- **Avoid "StormAudio"** -- if the StormAudio iOS app is installed on your device, Siri may try to open the app instead of controlling the HomeKit accessory.
- **Avoid generic words** like "volume", "brightness", or "speaker" in the name. These can confuse Siri's intent parsing.
- **The fan/lightbulb proxy uses the same name.** When you say "set Theater to 50%", Siri targets the fan/lightbulb proxy (because the Television service does not support Siri volume commands). This is by design.

### Child Bridge: Recommended for Stability

The plugin registers as an External Platform Accessory, which means it runs on its own Child Bridge. This is already the default behavior. Running on a Child Bridge means:

- If the plugin encounters an issue, it does not affect your other Homebridge accessories.
- The plugin can restart independently without disrupting your entire Homebridge setup.
- You can see the plugin's status separately in the Homebridge UI.

To enable a Child Bridge explicitly via `config.json`, add a `_bridge` section inside your platform entry (alongside `platform`, `name`, and `host`):

```json
{
  "platforms": [
    {
      "platform": "StormAudioISP",
      "name": "Theater",
      "host": "192.168.1.100",
      "_bridge": {
        "username": "CC:22:3D:E3:CE:31",
        "port": 51827
      }
    }
  ]
}
```

The `username` must be a unique MAC-style address (six pairs of hexadecimal characters separated by colons) not used by your main bridge or other Child Bridges. You can generate a random one at [miniwebtool.com/mac-address-generator](https://miniwebtool.com/mac-address-generator/). The `port` must be a unique port number not used by other bridges.

### First Connection

When you first install the plugin and connect to your processor, the input list is imported automatically and should appear in the Home app's input picker right away. Input names are read directly from the processor and update in real time whenever you rename them in the StormAudio installer UI.

If input names appear generic, you can:
1. Rename inputs in your StormAudio's configuration (recommended -- the plugin picks up changes automatically), or
2. Configure input aliases in the plugin settings as an override

### Multiple Rooms

After pairing the accessory, you can assign it to any room in the Home app. If your theater is in a specific room:

1. Open the Home app
2. Long-press the Television tile
3. Tap the gear icon (settings)
4. Change the room assignment

This helps with Siri disambiguation. If you say "Hey Siri, turn on the Theater" and Siri asks which one, specifying the room resolves it.

### Bidirectional Sync

Any change made on the processor itself -- using the physical remote, front panel, web interface, or another control app -- is reflected in the Home app within about a second. You do not need to worry about the Home app getting out of sync. This works for power, volume, mute, and input selection.

If the network connection drops and you make changes on the processor while it is disconnected, the plugin re-syncs all state automatically when the connection is restored. The Home app will show the correct current state after reconnection.

---

## What's Not Supported (Yet)

The following features are recognized as potential future enhancements. The processor already communicates this information to the plugin over the network, but it has not been connected to HomeKit controls yet:

| Feature | Status |
|---------|--------|
| **Surround mode switching** | Processor reports available modes; not yet exposed as HomeKit controls |
| **Preset activation** | Processor reports preset list; not yet exposed as HomeKit switches |
| **Trigger outputs** (screen, curtains, lighting relays) | Processor reports trigger states; not yet exposed as HomeKit switches |
| **Zone 2 control** | Processor reports zone data; not yet exposed as a separate accessory |
| **Dynamic range compression (night mode)** | Processor reports DRC state; not yet exposed as a HomeKit switch |
| **Dialog enhancement** | Processor reports availability and level; not yet exposed |
| **Relative volume via Siri** | HomeKit platform limitation -- use absolute percentages instead |

---

## Troubleshooting Quick Reference

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Accessory shows "Not Responding" or appears off | Network connection lost between Homebridge and the processor | Check that the processor is powered on and reachable on your network. The plugin retries automatically -- it should recover on its own once the network is restored. |
| Inputs not showing in the Home app | Accessory may need to be re-paired | Remove the accessory from the Home app and re-pair it. Check the Homebridge log for `[HomeKit] Input sources registered` to confirm inputs were imported. |
| Siri says "I can't do that" for volume | Using relative command ("turn it up") instead of absolute | Use "Hey Siri, set Theater to 50%" instead. Relative volume via Siri is a HomeKit platform limitation. |
| Volume changes are not audible | Configured volume range is too low or too narrow | Check `volumeFloor` and `volumeCeiling` in your configuration. With defaults (-100 to -20), low percentages may be inaudible on some speaker systems. Raise the floor (e.g., -80) for a more usable range. |
| "Hey Siri, mute the Theater" does not work | Siri cannot route mute commands to the volume proxy | Use "Hey Siri, turn off Theater" to mute, and "Hey Siri, turn on Theater" to unmute. |
| Processor takes 30-75 seconds to respond after power on | Normal boot time for StormAudio processors | This is expected. The processor is loading its configuration and room calibration. The plugin waits up to `wakeTimeout` seconds (default: 90, configurable up to 300). If your processor takes longer, increase `wakeTimeout` in the plugin settings. |
| "Hey Siri" opens the StormAudio app instead of controlling HomeKit | Accessory name conflicts with an installed iOS app | Rename your accessory to something unique like "Theater" or "Processor" to avoid the conflict. |
| Home app shows wrong volume/input after a network outage | State was not re-synced yet | Wait a few seconds after the connection is restored. The plugin automatically re-syncs all state from the processor on reconnection. |
| Plugin appears to stop working after initial startup failure | Processor was not reachable when Homebridge started | The plugin retries automatically every 20 seconds indefinitely. Once the processor becomes reachable, the plugin will connect and begin working. No restart needed. |

For full installation instructions, configuration options, and developer information, see the [README](README.md).
