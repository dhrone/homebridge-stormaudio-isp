import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { StormAudioPlatform } from './platform';
import type { StormAudioClient } from './stormAudioClient';
import { ProcessorState } from './types';
import type { PresetInfo, PresetsConfig } from './types';

const EXTERNAL_CONTEXT = { source: 'stormaudio' };

export class StormAudioPresetAccessory {
  private readonly tvService: Service;
  private readonly presetInputs: Map<number, Service> = new Map();
  private connected = true;

  constructor(
    private readonly platform: StormAudioPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly client: StormAudioClient,
    private readonly presetsConfig: PresetsConfig,
  ) {
    const { Characteristic } = this.platform;

    // Connection state tracking
    this.client.on('disconnected', () => {
      this.connected = false;
      this.platform.log.debug('[HomeKit] Preset accessory disconnected — setting INACTIVE');
      this.tvService
        .getCharacteristic(Characteristic.Active)
        .updateValue(Characteristic.Active.INACTIVE, EXTERNAL_CONTEXT);
    });
    this.client.on('connected', () => {
      this.connected = true;
      this.platform.log.debug('[HomeKit] Preset accessory connected');
    });

    // Television service setup
    this.tvService =
      this.accessory.getService(this.platform.Service.Television) ||
      this.accessory.addService(this.platform.Service.Television, presetsConfig.name);

    this.tvService.setCharacteristic(Characteristic.Name, presetsConfig.name);
    this.tvService.setCharacteristic(Characteristic.ConfiguredName, presetsConfig.name);
    this.tvService.setCharacteristic(
      Characteristic.SleepDiscoveryMode,
      Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE,
    );
    this.tvService.setCharacteristic(
      Characteristic.ActiveIdentifier,
      this.client.getAudioConfig().preset,
    );

    // Active characteristic — informational only, reflects processor power state
    this.tvService.getCharacteristic(Characteristic.Active).onGet(() => {
      if (!this.connected) return Characteristic.Active.INACTIVE;
      return this.client.getProcessorState() === ProcessorState.Active
        ? Characteristic.Active.ACTIVE
        : Characteristic.Active.INACTIVE;
    });
    this.tvService.getCharacteristic(Characteristic.Active).onSet((_value: CharacteristicValue) => {
      this.platform.log.debug('[HomeKit] Preset accessory Active toggle ignored — use main accessory for power control');
      // No-op: preset accessory does not control processor power
    });

    // ActiveIdentifier onGet — returns current preset ID
    this.tvService.getCharacteristic(Characteristic.ActiveIdentifier).onGet(() => {
      this.ensureConnected();
      return this.client.getAudioConfig().preset;
    });

    // ActiveIdentifier onSet — preset selection
    this.tvService.getCharacteristic(Characteristic.ActiveIdentifier).onSet((value: CharacteristicValue) => {
      this.ensureConnected();
      void this.requiresActive().then((active) => {
        if (!active) return;
        const presetId = value as number;
        this.platform.log.debug(`[HomeKit] Preset selection: ID ${presetId}`);
        this.client.setPreset(presetId);
      });
    });

    // Preset broadcast sync — external preset change
    this.client.on('preset', (presetId: number) => {
      this.platform.log.debug(`[HomeKit] Preset changed externally: ID ${presetId}`);
      this.tvService
        .getCharacteristic(Characteristic.ActiveIdentifier)
        .updateValue(presetId, EXTERNAL_CONTEXT);
    });

    // Processor sleep/wake handling
    this.client.on('processorState', (state: ProcessorState) => {
      this.platform.log.debug(`[HomeKit] Preset processorState: ${ProcessorState[state]}`);
      if (state === ProcessorState.Sleep) {
        this.tvService
          .getCharacteristic(Characteristic.Active)
          .updateValue(Characteristic.Active.INACTIVE, EXTERNAL_CONTEXT);
      } else if (state === ProcessorState.Active) {
        this.tvService
          .getCharacteristic(Characteristic.Active)
          .updateValue(Characteristic.Active.ACTIVE, EXTERNAL_CONTEXT);
      }
      // Initializing — no push (transitional)
    });

    // Persistent presetList listener — handles reconnect updates
    this.client.on('presetList', (presets: PresetInfo[]) => {
      this.registerPresetInputs(presets);
    });
  }

  /** Replay cached preset list after publish. Called by the platform. */
  replayCachedPresets(): void {
    const cached = this.client.getAudioConfig().presetList;
    if (cached.length > 0) {
      this.platform.log.debug(`[HomeKit] Preset replaying cached preset list: ${cached.length} presets`);
      this.registerPresetInputs(cached);
    }
  }

  private registerPresetInputs(presets: PresetInfo[]): void {
    const { Characteristic } = this.platform;

    // Reverse for LIFO display order in HomeKit (same pattern as Zone 2)
    const reversedPresets = [...presets].reverse();
    const newPresetIds = new Set<number>();

    for (const preset of reversedPresets) {
      newPresetIds.add(preset.id);
      const subtype = `preset-input-${preset.id}`;
      const displayName = this.presetsConfig.aliases[String(preset.id)] ?? preset.name;

      const svc =
        this.accessory.getService(subtype) ||
        this.accessory.addService(this.platform.Service.InputSource, displayName, subtype);

      svc.setCharacteristic(Characteristic.Identifier, preset.id);
      svc.setCharacteristic(Characteristic.Name, displayName);
      svc.setCharacteristic(Characteristic.ConfiguredName, displayName);
      svc.setCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED);
      svc.setCharacteristic(Characteristic.InputSourceType, Characteristic.InputSourceType.OTHER);
      svc.setCharacteristic(Characteristic.CurrentVisibilityState, Characteristic.CurrentVisibilityState.SHOWN);
      this.tvService.addLinkedService(svc);
      this.presetInputs.set(preset.id, svc);
    }

    // Hide removed presets on reconnect
    for (const [oldId, svc] of this.presetInputs) {
      if (!newPresetIds.has(oldId)) {
        svc.setCharacteristic(
          Characteristic.CurrentVisibilityState,
          Characteristic.CurrentVisibilityState.HIDDEN,
        );
      }
    }
  }

  private ensureConnected(): void {
    if (!this.connected) {
      const { HapStatusError, HAPStatus } = this.platform.api.hap;
      throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  private async requiresActive(): Promise<boolean> {
    if (!this.connected) return false;
    if (this.client.getProcessorState() === ProcessorState.Active) return true;
    const reached = await this.client.ensureActive(this.platform.validatedConfig!.wakeTimeout * 1000);
    if (!reached) {
      this.platform.log.debug('[State] Preset command dropped — processor did not reach active state');
    }
    return reached;
  }
}
