import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';
import { StorageService } from 'homebridge/lib/storageService';
import path from 'path';

import { StormAudioAccessory } from './platformAccessory';
import { PLUGIN_NAME } from './settings';
import { RECONNECT_LONG_POLL_INTERVAL_MS } from './settings';
import { StormAudioClient } from './stormAudioClient';
import { StormAudioZone2Accessory } from './zone2Accessory';
import { ErrorCategory } from './types';
import type { StormAudioConfig, Zone2Config, ZoneState } from './types';

interface ConfigLogger {
  error(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

interface RawConfig {
  host?: unknown;
  port?: unknown;
  name?: unknown;
  volumeCeiling?: unknown;
  volumeFloor?: unknown;
  volumeControl?: unknown;
  wakeTimeout?: unknown;
  commandInterval?: unknown;
  inputs?: unknown;
  zone2?: unknown;
  [key: string]: unknown;
}

export function validateConfig(config: RawConfig, log: ConfigLogger): StormAudioConfig | null {
  if (!config.host || typeof config.host !== 'string') {
    log.error('[Config] Error: "host" is required. Configure the StormAudio IP address.');
    return null;
  }

  const port = config.port !== undefined ? (config.port as number) : undefined;
  const resolvedPort = port ?? 23;
  if (resolvedPort < 1 || resolvedPort > 65535) {
    log.error(`[Config] Error: "port" must be 1-65535. Got: ${resolvedPort}`);
    return null;
  }
  if (port === undefined) {
    log.debug('[Config] Using default port: 23');
  }

  const name = (config.name as string | undefined) || undefined;
  if (!name) {
    log.debug('[Config] Using default name: StormAudio');
  }

  const volumeCeiling = config.volumeCeiling !== undefined ? (config.volumeCeiling as number) : undefined;
  const resolvedCeiling = volumeCeiling ?? -20;
  if (resolvedCeiling < -100 || resolvedCeiling > 0) {
    log.error('[Config] Error: "volumeCeiling" must be -100 to 0');
    return null;
  }
  if (volumeCeiling === undefined) {
    log.debug('[Config] Using default volumeCeiling: -20');
  }

  const volumeFloor = config.volumeFloor !== undefined ? (config.volumeFloor as number) : undefined;
  const resolvedFloor = volumeFloor ?? -100;
  if (resolvedFloor < -100 || resolvedFloor > 0) {
    log.error('[Config] Error: "volumeFloor" must be -100 to 0');
    return null;
  }
  if (resolvedFloor >= resolvedCeiling) {
    log.error('[Config] Error: "volumeFloor" must be less than "volumeCeiling"');
    return null;
  }
  if (volumeFloor === undefined) {
    log.debug('[Config] Using default volumeFloor: -100');
  }

  const volumeControl = config.volumeControl as string | undefined;
  const resolvedVolumeControl = volumeControl ?? 'fan';
  if (resolvedVolumeControl !== 'fan' && resolvedVolumeControl !== 'lightbulb' && resolvedVolumeControl !== 'none') {
    log.error(`[Config] Error: "volumeControl" must be "fan", "lightbulb", or "none". Got: ${resolvedVolumeControl}`);
    return null;
  }
  if (!volumeControl) {
    log.debug('[Config] Using default volumeControl: fan');
  }

  const wakeTimeout = config.wakeTimeout !== undefined ? (config.wakeTimeout as number) : undefined;
  const resolvedWakeTimeout = wakeTimeout ?? 90;
  if (resolvedWakeTimeout < 30 || resolvedWakeTimeout > 300) {
    log.error(`[Config] Error: "wakeTimeout" must be 30-300 seconds. Got: ${resolvedWakeTimeout}`);
    return null;
  }
  if (wakeTimeout === undefined) {
    log.debug('[Config] Using default wakeTimeout: 90');
  }

  const commandInterval = config.commandInterval !== undefined ? (config.commandInterval as number) : undefined;
  const resolvedCommandInterval = commandInterval ?? 100;
  if (resolvedCommandInterval < 0 || resolvedCommandInterval > 1000) {
    log.error(`[Config] Error: "commandInterval" must be 0-1000 ms. Got: ${resolvedCommandInterval}`);
    return null;
  }
  if (commandInterval === undefined) {
    log.debug('[Config] Using default commandInterval: 100');
  }

  // Zone 2 config validation
  let resolvedZone2: Zone2Config | undefined;
  if (config.zone2 !== undefined) {
    if (typeof config.zone2 !== 'object' || config.zone2 === null || Array.isArray(config.zone2)) {
      log.error('[Config] Error: "zone2" must be an object if provided.');
      return null;
    }
    const raw2 = config.zone2 as Record<string, unknown>;

    let resolvedZoneId: number;
    if (raw2.zoneId === undefined) {
      resolvedZoneId = 1;
      log.debug('[Config] zone2.zoneId not specified — defaulting to Zone 1 (Downmix). If no audio is heard, create a dedicated zone in the StormAudio web interface and set zone2.zoneId.');
    } else {
      resolvedZoneId = raw2.zoneId as number;
    }

    const zone2Name = typeof raw2.name === 'string' ? raw2.name : 'Zone 2';
    if (raw2.name === undefined) {
      log.debug('[Config] Using default zone2.name: Zone 2');
    }

    const zone2VolumeFloor = raw2.volumeFloor !== undefined ? (raw2.volumeFloor as number) : -80;
    if (raw2.volumeFloor === undefined) {
      log.debug('[Config] Using default zone2.volumeFloor: -80');
    }
    if (zone2VolumeFloor < -100 || zone2VolumeFloor > 0) {
      log.error('[Config] Error: "zone2.volumeFloor" must be -100 to 0');
      return null;
    }

    const zone2VolumeCeiling = raw2.volumeCeiling !== undefined ? (raw2.volumeCeiling as number) : 0;
    if (raw2.volumeCeiling === undefined) {
      log.debug('[Config] Using default zone2.volumeCeiling: 0');
    }
    if (zone2VolumeCeiling < -100 || zone2VolumeCeiling > 0) {
      log.error('[Config] Error: "zone2.volumeCeiling" must be -100 to 0');
      return null;
    }
    if (zone2VolumeFloor >= zone2VolumeCeiling) {
      log.error('[Config] Error: "zone2.volumeFloor" must be less than "zone2.volumeCeiling"');
      return null;
    }

    const zone2VolumeControl = raw2.volumeControl as string | undefined;
    const resolvedZone2VolumeControl = zone2VolumeControl ?? 'none';
    if (resolvedZone2VolumeControl !== 'fan' && resolvedZone2VolumeControl !== 'lightbulb' && resolvedZone2VolumeControl !== 'none') {
      log.error(`[Config] Error: "zone2.volumeControl" must be "fan", "lightbulb", or "none". Got: ${resolvedZone2VolumeControl}`);
      return null;
    }
    if (!zone2VolumeControl) {
      log.debug('[Config] Using default zone2.volumeControl: none');
    }

    resolvedZone2 = {
      zoneId: resolvedZoneId,
      name: zone2Name,
      volumeFloor: zone2VolumeFloor,
      volumeCeiling: zone2VolumeCeiling,
      volumeControl: resolvedZone2VolumeControl as 'fan' | 'lightbulb' | 'none',
    };
  }

  return {
    host: config.host,
    port: resolvedPort,
    name: name ?? 'StormAudio',
    volumeCeiling: resolvedCeiling,
    volumeFloor: resolvedFloor,
    volumeControl: resolvedVolumeControl as 'fan' | 'lightbulb' | 'none',
    wakeTimeout: resolvedWakeTimeout,
    commandInterval: resolvedCommandInterval,
    inputs: (config.inputs as Record<string, string> | undefined) ?? {},
    zone2: resolvedZone2,
  };
}

export class StormAudioPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly accessories: Map<string, PlatformAccessory> = new Map();

  private client: StormAudioClient | null = null;
  private storageService: StorageService | null = null;
  public readonly validatedConfig: StormAudioConfig | null = null;

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.validatedConfig = validateConfig(config as Record<string, unknown>, this.log);
    if (!this.validatedConfig) {
      this.log.error('[Config] Plugin disabled due to configuration errors.');
      return;
    }

    this.storageService = new StorageService(
      path.join(this.api.user.storagePath(), 'homebridge-stormaudio-isp'),
    );
    this.storageService.initSync();

    this.log.debug('Finished initializing platform:', this.validatedConfig.name);

    // Task 8: Register shutdown handler
    this.api.on('shutdown', () => {
      this.client?.disconnect();
      this.log.info('[TCP] Connection closed gracefully');
    });

    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      if (this.validatedConfig) {
        this.client = new StormAudioClient(this.validatedConfig, this.log);
        this.client.on('error', (stormError) => {
          // Error already logged by StormAudioClient.
          // Reconnection is handled automatically by StormAudioClient.
          // Fatal errors (max retries exhausted) require user intervention.
          if (stormError.category === ErrorCategory.Fatal) {
            this.log.error(`[Platform] Reconnection has failed. Will reattempt connection every ${RECONNECT_LONG_POLL_INTERVAL_MS / 1000}s.`);
          }
        });
        this.client.connect();

        // Task 6: Create external accessory — defer publish until input list arrives
        const uuid = this.api.hap.uuid.generate('stormaudio-isp');
        const accessory = new this.api.platformAccessory(this.validatedConfig.name, uuid);
        accessory.category = this.api.hap.Categories.TELEVISION;
        new StormAudioAccessory(this, accessory, this.client);

        this.client.once('inputList', () => {
          this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
          this.log.info('[HomeKit] Published StormAudio accessory: ' + this.validatedConfig!.name);
        });

        // Zone 2: persistent zoneList listener — logs all zones on every connection (ZFR3)
        // and creates the Zone 2 external accessory once when zone list first arrives.
        let zone2Published = false;
        this.client.on('zoneList', (zones: ZoneState[]) => {
          // AC 1: Log all zones at INFO on every connection
          for (const z of zones) {
            const type = z.id === 1 ? 'built-in' : 'user zone';
            this.log.info(`[State] Zone ${z.id}: "${z.name}" (${type})`);
          }

          // Persist zone list to plugin storage on every connection (AC 1, Story 5.3)
          const zonesArray = zones.map(z => ({ id: z.id, name: z.name }));
          if (this.storageService) {
            void this.storageService.setItem('zones', zonesArray).then(() => {
              this.log.debug(`[Config] Persisted ${zonesArray.length} zones to plugin storage`);
            }).catch((err: unknown) => {
              const message = err instanceof Error ? err.message : String(err);
              this.log.debug(`[Config] Failed to persist zone list to storage: ${message}`);
            });
          }

          // Zone 2 creation — only once
          if (zone2Published || !this.validatedConfig?.zone2) return;

          const zone2Config = this.validatedConfig!.zone2!;
          const targetZone = zones.find(z => z.id === zone2Config.zoneId);
          if (!targetZone) {
            // AC 4: zoneId not found
            this.log.error(`[Config] zone2.zoneId ${zone2Config.zoneId} not found in zone list — Zone 2 accessory will not be created`);
            return;
          }

          // Create Zone 2 external accessory
          const zone2Uuid = this.api.hap.uuid.generate(`stormaudio-isp-zone2-${zone2Config.zoneId}`);
          const zone2Accessory = new this.api.platformAccessory(zone2Config.name, zone2Uuid);
          zone2Accessory.category = this.api.hap.Categories.TELEVISION;
          const zone2 = new StormAudioZone2Accessory(this, zone2Accessory, this.client!, zone2Config);
          this.api.publishExternalAccessories(PLUGIN_NAME, [zone2Accessory]);
          zone2.replayCachedInputs();
          zone2Published = true;
          this.log.info('[HomeKit] Published Zone 2 accessory: ' + zone2Config.name);
        });
      }
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }
}
