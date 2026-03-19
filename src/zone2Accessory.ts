import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { StormAudioPlatform } from './platform';
import { dBToPercentage, percentageToDB } from './platformAccessory';
import type { StormAudioClient } from './stormAudioClient';
import { ProcessorState } from './types';
import type { InputInfo, Zone2Config } from './types';

const EXTERNAL_CONTEXT = { source: 'stormaudio' };

export class StormAudioZone2Accessory {
  private readonly tvService: Service;
  private speakerService!: Service;
  private volumeProxyService?: Service;
  private volumeProxyChar?: string;
  private readonly state = { mute: false, volume: -80, useZone2Source: false, inputZone2: 0 };
  private zone2InputIds = new Set<number>();
  private connected = true;

  constructor(
    private readonly platform: StormAudioPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly client: StormAudioClient,
    private readonly zone2Config: Zone2Config,
  ) {
    const { Characteristic } = this.platform;
    const { zoneId, name, volumeFloor, volumeCeiling, volumeControl } = zone2Config;
    const config = this.platform.validatedConfig!;

    // Initialize inputZone2 from client-tracked state (may have arrived before accessory created)
    this.state.inputZone2 = this.client.getInputZone2();

    // Connection state tracking
    this.client.on('disconnected', () => {
      this.connected = false;
      this.tvService
        .getCharacteristic(Characteristic.Active)
        .updateValue(Characteristic.Active.INACTIVE, EXTERNAL_CONTEXT);
      this.revertToLastKnownState();
    });
    this.client.on('connected', () => { this.connected = true; });

    // Television service
    this.tvService =
      this.accessory.getService(this.platform.Service.Television) ||
      this.accessory.addService(this.platform.Service.Television, name);

    this.tvService.setCharacteristic(Characteristic.Name, name);
    this.tvService.setCharacteristic(Characteristic.ConfiguredName, name);
    this.tvService.setCharacteristic(
      Characteristic.SleepDiscoveryMode,
      Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE,
    );
    this.tvService.setCharacteristic(Characteristic.ActiveIdentifier, 0);

    // "Follow Main" InputSource (AC 14)
    const inputSource =
      this.accessory.getService('zone2-input-0') ||
      this.accessory.addService(this.platform.Service.InputSource, 'Follow Main', 'zone2-input-0');
    inputSource.setCharacteristic(Characteristic.Identifier, 0);
    inputSource.setCharacteristic(Characteristic.ConfiguredName, 'Follow Main');
    inputSource.setCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED);
    inputSource.setCharacteristic(Characteristic.InputSourceType, Characteristic.InputSourceType.OTHER);
    inputSource.setCharacteristic(Characteristic.CurrentVisibilityState, Characteristic.CurrentVisibilityState.SHOWN);
    this.tvService.addLinkedService(inputSource);

    // Power on/off handlers (AC 6, 7, 16)
    this.tvService.getCharacteristic(Characteristic.Active).onSet((value: CharacteristicValue) => {
      this.ensureConnected();
      const isActive = value === Characteristic.Active.ACTIVE;
      // Zone 2 power = zone mute (Active=true → unmuted, Active=false → muted)
      this.client.setZoneMute(zoneId, !isActive);
    });
    this.tvService.getCharacteristic(Characteristic.Active).onGet(() => {
      this.ensureConnected();
      return this.state.mute ? Characteristic.Active.INACTIVE : Characteristic.Active.ACTIVE;
    });

    // ActiveIdentifier onSet — source selection (Story 5.2 AC 6, 7)
    this.tvService.getCharacteristic(Characteristic.ActiveIdentifier).onSet((value: CharacteristicValue) => {
      this.ensureConnected();
      const inputId = value as number;
      if (inputId === 0) {
        // Follow Main
        this.client.setZoneUseZone2(zoneId, false);
      } else {
        // Independent source — useZone2 MUST be sent BEFORE inputZone2
        this.client.setZoneUseZone2(zoneId, true);
        this.client.setInputZone2(inputId);
      }
    });

    // ActiveIdentifier onGet — returns tracked state
    this.tvService.getCharacteristic(Characteristic.ActiveIdentifier).onGet(() => {
      if (!this.state.useZone2Source) return 0;
      return this.zone2InputIds.has(this.state.inputZone2) ? this.state.inputZone2 : 0;
    });

    // TelevisionSpeaker service
    const speakerService =
      this.accessory.getService(this.platform.Service.TelevisionSpeaker) ||
      this.accessory.addService(this.platform.Service.TelevisionSpeaker, `${name} Speaker`, 'zone2-speaker');
    speakerService.setCharacteristic(Characteristic.Active, Characteristic.Active.ACTIVE);
    speakerService.setCharacteristic(Characteristic.VolumeControlType, Characteristic.VolumeControlType.ABSOLUTE);
    this.tvService.addLinkedService(speakerService);
    this.speakerService = speakerService;

    // VolumeSelector handler (AC 9)
    speakerService.getCharacteristic(Characteristic.VolumeSelector).onSet((value: CharacteristicValue) => {
      this.ensureConnected();
      const isIncrement = value === Characteristic.VolumeSelector.INCREMENT;
      const newDB = isIncrement
        ? Math.min(this.state.volume + 1, volumeCeiling)
        : Math.max(this.state.volume - 1, volumeFloor);
      // If already at boundary, no command sent (clamped)
      if (isIncrement && this.state.volume >= volumeCeiling) return;
      if (!isIncrement && this.state.volume <= volumeFloor) return;
      this.client.setZoneVolume(zoneId, newDB);
    });

    // Mute handlers
    speakerService.getCharacteristic(Characteristic.Mute).onSet((value: CharacteristicValue) => {
      this.ensureConnected();
      this.client.setZoneMute(zoneId, value as boolean);
    });
    speakerService.getCharacteristic(Characteristic.Mute).onGet(() => {
      this.ensureConnected();
      return this.state.mute;
    });

    // Volume onGet
    speakerService.getCharacteristic(Characteristic.Volume).onGet(() => {
      this.ensureConnected();
      return dBToPercentage(this.state.volume, volumeFloor, volumeCeiling);
    });

    // Volume proxy (Fan/Lightbulb) — optional
    if (volumeControl === 'fan' || volumeControl === 'lightbulb') {
      const isFan = volumeControl === 'fan';
      const ServiceType = isFan ? this.platform.Service.Fan : this.platform.Service.Lightbulb;
      const subtype = isFan ? 'zone2-volume-fan' : 'zone2-volume-lightbulb';
      const volumeChar = isFan ? Characteristic.RotationSpeed : Characteristic.Brightness;

      const proxyService =
        this.accessory.getService(ServiceType) ||
        this.accessory.addService(ServiceType, `${name} Volume`, subtype);
      this.volumeProxyService = proxyService;
      this.volumeProxyChar = volumeChar as unknown as string;

      proxyService.getCharacteristic(volumeChar).onSet((value: CharacteristicValue) => {
        this.ensureConnected();
        const percentage = value as number;
        const dB = percentageToDB(percentage, volumeFloor, volumeCeiling);
        this.client.setZoneVolume(zoneId, dB);
      });
      proxyService.getCharacteristic(volumeChar).onGet(() => {
        this.ensureConnected();
        return dBToPercentage(this.state.volume, volumeFloor, volumeCeiling);
      });

      proxyService.getCharacteristic(Characteristic.On).onSet((value: CharacteristicValue) => {
        this.ensureConnected();
        const on = value as boolean;
        // On=true → unmute (muted=false), On=false → mute (muted=true)
        this.client.setZoneMute(zoneId, !on);
      });
      proxyService.getCharacteristic(Characteristic.On).onGet(() => {
        this.ensureConnected();
        return !this.state.mute;
      });
    }

    // Capture proxy references for closures
    const proxyService = this.volumeProxyService;
    const proxyVolumeChar = this.volumeProxyChar;

    // Bidirectional sync — zoneUpdate listener (AC 10, 11; Story 5.2 AC 8, 9)
    this.client.on('zoneUpdate', (eventZoneId: number, field: string, value: unknown) => {
      if (eventZoneId !== zoneId) return;

      if (field === 'mute') {
        this.state.mute = value as boolean;
        this.tvService
          .getCharacteristic(Characteristic.Active)
          .updateValue(
            this.state.mute ? Characteristic.Active.INACTIVE : Characteristic.Active.ACTIVE,
            EXTERNAL_CONTEXT,
          );
        this.speakerService
          .getCharacteristic(Characteristic.Mute)
          .updateValue(this.state.mute, EXTERNAL_CONTEXT);
        if (proxyService) {
          proxyService.getCharacteristic(Characteristic.On).updateValue(!this.state.mute, EXTERNAL_CONTEXT);
        }
      } else if (field === 'volume') {
        this.state.volume = value as number;
        const percentage = dBToPercentage(this.state.volume, volumeFloor, volumeCeiling);
        this.speakerService
          .getCharacteristic(Characteristic.Volume)
          .updateValue(percentage, EXTERNAL_CONTEXT);
        if (proxyService && proxyVolumeChar) {
          proxyService.getCharacteristic(proxyVolumeChar)!.updateValue(percentage, EXTERNAL_CONTEXT);
        }
      } else if (field === 'useZone2Source') {
        // Story 5.2 AC 8, 9: useZone2Source broadcast
        this.state.useZone2Source = value as boolean;
        if (!this.state.useZone2Source) {
          // Follow Main — push ActiveIdentifier=0
          this.tvService
            .getCharacteristic(Characteristic.ActiveIdentifier)
            .updateValue(0, EXTERNAL_CONTEXT);
        } else {
          // Independent mode — push ActiveIdentifier to inputZone2 (with fallback)
          const targetId = this.zone2InputIds.has(this.state.inputZone2) ? this.state.inputZone2 : 0;
          this.tvService
            .getCharacteristic(Characteristic.ActiveIdentifier)
            .updateValue(targetId, EXTERNAL_CONTEXT);
        }
      }
    });

    // Story 5.2 AC 10, 11: inputZone2 broadcast tracking
    this.client.on('inputZone2', (inputId: number) => {
      this.state.inputZone2 = inputId;
      if (this.state.useZone2Source) {
        // Independent mode — push ActiveIdentifier to new input
        this.tvService
          .getCharacteristic(Characteristic.ActiveIdentifier)
          .updateValue(inputId, EXTERNAL_CONTEXT);
      }
      // Follow Main mode — update state only, no HomeKit push
    });

    // Story 5.2 AC 3: Zone 2 InputSource registration from input list
    this.client.on('inputList', (inputs: InputInfo[]) => {
      const newZone2Ids = new Set<number>();

      for (const input of inputs) {
        if (input.zone2AudioInId === 0) continue;
        newZone2Ids.add(input.id);

        const subtype = `zone2-input-${input.id}`;
        const alias = config.inputs[String(input.id)];
        const displayName = alias ?? input.name;

        const svc =
          this.accessory.getService(subtype) ||
          this.accessory.addService(this.platform.Service.InputSource, displayName, subtype);
        svc.setCharacteristic(Characteristic.Identifier, input.id);
        svc.setCharacteristic(Characteristic.ConfiguredName, displayName);
        svc.setCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED);
        svc.setCharacteristic(Characteristic.InputSourceType, Characteristic.InputSourceType.OTHER);
        svc.setCharacteristic(Characteristic.CurrentVisibilityState, Characteristic.CurrentVisibilityState.SHOWN);
        this.tvService.addLinkedService(svc);
      }

      // Handle capability changes (AC 12, 13)
      // Inputs that lost Zone 2 capability
      for (const oldId of this.zone2InputIds) {
        if (!newZone2Ids.has(oldId)) {
          const svc = this.accessory.getService(`zone2-input-${oldId}`);
          if (svc) {
            svc.setCharacteristic(Characteristic.CurrentVisibilityState, Characteristic.CurrentVisibilityState.HIDDEN);
          }
          // If this was the active input, revert to Follow Main
          if (this.state.useZone2Source && this.state.inputZone2 === oldId) {
            this.tvService
              .getCharacteristic(Characteristic.ActiveIdentifier)
              .updateValue(0, EXTERNAL_CONTEXT);
            this.client.setZoneUseZone2(zoneId, false);
          }
        }
      }

      this.zone2InputIds = newZone2Ids;
    });

    // Processor sleep/wake handling (AC 12, 13)
    this.client.on('processorState', (state: ProcessorState) => {
      if (state === ProcessorState.Sleep) {
        // AC 12: Push Active=false on sleep — no command sent
        this.tvService
          .getCharacteristic(Characteristic.Active)
          .updateValue(Characteristic.Active.INACTIVE, EXTERNAL_CONTEXT);
      }
      // AC 13: Active/Initializing — zoneUpdate broadcasts restore state; no action needed
    });
  }

  private ensureConnected(): void {
    if (!this.connected) {
      setImmediate(() => { this.revertToLastKnownState(); });
      const { HapStatusError, HAPStatus } = this.platform.api.hap;
      throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  private revertToLastKnownState(): void {
    if (this.connected) return;
    const { Characteristic } = this.platform;
    const { volumeFloor, volumeCeiling } = this.zone2Config;

    this.tvService
      .getCharacteristic(Characteristic.Active)
      .updateValue(Characteristic.Active.INACTIVE, EXTERNAL_CONTEXT);
    this.speakerService
      .getCharacteristic(Characteristic.Mute)
      .updateValue(this.state.mute, EXTERNAL_CONTEXT);
    this.speakerService
      .getCharacteristic(Characteristic.Volume)
      .updateValue(dBToPercentage(this.state.volume, volumeFloor, volumeCeiling), EXTERNAL_CONTEXT);
    if (this.volumeProxyService && this.volumeProxyChar) {
      this.volumeProxyService
        .getCharacteristic(this.volumeProxyChar)!
        .updateValue(dBToPercentage(this.state.volume, volumeFloor, volumeCeiling), EXTERNAL_CONTEXT);
      this.volumeProxyService
        .getCharacteristic(Characteristic.On)
        .updateValue(!this.state.mute, EXTERNAL_CONTEXT);
    }
  }
}
