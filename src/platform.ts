import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';

import { StormAudioAccessory } from './platformAccessory';
import { PLUGIN_NAME } from './settings';
import { RECONNECT_LONG_POLL_INTERVAL_MS } from './settings';
import { StormAudioClient } from './stormAudioClient';
import { ErrorCategory } from './types';
import type { StormAudioConfig } from './types';

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
  inputs?: unknown;
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

  return {
    host: config.host,
    port: resolvedPort,
    name: name ?? 'StormAudio',
    volumeCeiling: resolvedCeiling,
    volumeFloor: resolvedFloor,
    volumeControl: resolvedVolumeControl as 'fan' | 'lightbulb' | 'none',
    wakeTimeout: resolvedWakeTimeout,
    inputs: (config.inputs as Record<string, string> | undefined) ?? {},
  };
}

export class StormAudioPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly accessories: Map<string, PlatformAccessory> = new Map();

  private client: StormAudioClient | null = null;
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
      }
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }
}
