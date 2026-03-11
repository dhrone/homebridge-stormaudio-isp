import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';

import { StormAudioClient } from './stormAudioClient';
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
  const resolvedVolumeControl = volumeControl ?? 'lightbulb';
  if (resolvedVolumeControl !== 'lightbulb' && resolvedVolumeControl !== 'none') {
    log.error(`[Config] Error: "volumeControl" must be "lightbulb" or "none". Got: ${resolvedVolumeControl}`);
    return null;
  }
  if (!volumeControl) {
    log.debug('[Config] Using default volumeControl: lightbulb');
  }

  return {
    host: config.host,
    port: resolvedPort,
    name: name ?? 'StormAudio',
    volumeCeiling: resolvedCeiling,
    volumeFloor: resolvedFloor,
    volumeControl: resolvedVolumeControl as 'lightbulb' | 'none',
    inputs: (config.inputs as Record<string, string> | undefined) ?? {},
  };
}

export class StormAudioPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly accessories: Map<string, PlatformAccessory> = new Map();

  private client: StormAudioClient | null = null;
  private validatedConfig: StormAudioConfig | null = null;

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

    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      if (this.validatedConfig) {
        this.client = new StormAudioClient(this.validatedConfig, this.log);
        this.client.connect();
      }
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }
}
