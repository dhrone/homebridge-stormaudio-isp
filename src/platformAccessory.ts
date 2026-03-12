import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { StormAudioPlatform } from './platform';
import type { StormAudioClient } from './stormAudioClient';
import { ProcessorState } from './types';
import type { InputInfo } from './types';

const EXTERNAL_CONTEXT = { source: 'stormaudio' };

export function percentageToDB(percentage: number, floor: number, ceiling: number): number {
  const clamped = Math.max(0, Math.min(100, percentage));
  return Math.round(floor + (clamped / 100) * (ceiling - floor));
}

export function dBToPercentage(dB: number, floor: number, ceiling: number): number {
  const clamped = Math.max(floor, Math.min(ceiling, dB));
  return Math.round(((clamped - floor) / (ceiling - floor)) * 100);
}

export class StormAudioAccessory {
  private readonly tvService: Service;
  private speakerService!: Service;
  private volumeProxyService?: Service;
  private volumeProxyChar?: string;
  private readonly state = { power: false, mute: false, volume: -100, input: 0 };
  private readonly inputSources: Map<number, Service> = new Map();

  constructor(
    private readonly platform: StormAudioPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly client: StormAudioClient,
  ) {
    const { Characteristic } = this.platform;
    const config = this.platform.validatedConfig!;
    const name = config.name;

    // Task 2: Register Television service
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

    // Story 3.1: ActiveIdentifier onGet — returns local state
    this.tvService.getCharacteristic(Characteristic.ActiveIdentifier)
      .onGet(() => this.state.input);

    // Story 3.2: ActiveIdentifier onSet — send setInput command (fire-and-forget)
    this.tvService
      .getCharacteristic(Characteristic.ActiveIdentifier)
      .onSet((value: CharacteristicValue) => {
        void this.requiresActive().then((active) => {
          if (!active) return;
          const inputId = value as number;
          this.platform.log.debug(`[HomeKit] Input switch to ID ${inputId}`);
          this.client.setInput(inputId);
        });
      });

    // Task 3/5: Handle power on/off commands
    this.tvService.getCharacteristic(Characteristic.Active).onSet((value: CharacteristicValue) => {
      const isOn = value === Characteristic.Active.ACTIVE;
      if (isOn) {
        // Optimistic update: show ON immediately
        this.tvService
          .getCharacteristic(Characteristic.Active)
          .updateValue(Characteristic.Active.ACTIVE, EXTERNAL_CONTEXT);
        // Fire-and-forget: wake processor in background so HAP-NodeJS isn't blocked
        void this.requiresActive().then((active) => {
          if (!active) {
            this.platform.log.warn('[State] Power-on timed out — processor did not reach active state');
          }
        });
      } else {
        this.client.setPower(false);
      }
    });

    // Task 4: Register onGet handler for power state
    this.tvService.getCharacteristic(Characteristic.Active).onGet(() => {
      return this.state.power ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE;
    });

    // Task 5: Handle power state updates from StormAudio
    this.client.on('power', (on: boolean) => {
      this.state.power = on;
      this.tvService
        .getCharacteristic(Characteristic.Active)
        .updateValue(on ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE, EXTERNAL_CONTEXT);
      this.platform.log.debug('[HomeKit] Power state updated: ' + (on ? 'ON' : 'OFF'));
    });

    // Task 6: Handle processor state events
    this.client.on('processorState', (state: ProcessorState) => {
      if (state === ProcessorState.Active) {
        this.platform.log.debug('[HomeKit] Processor is active — ready for commands');
      } else if (state === ProcessorState.Sleep) {
        this.platform.log.debug('[HomeKit] Processor in sleep mode');
      }
    });

    // Task 4: Register TelevisionSpeaker service
    const speakerService =
      this.accessory.getService(this.platform.Service.TelevisionSpeaker) ||
      this.accessory.addService(this.platform.Service.TelevisionSpeaker, `${name} Speaker`, 'speaker');
    speakerService.setCharacteristic(Characteristic.Active, Characteristic.Active.ACTIVE);
    speakerService.setCharacteristic(Characteristic.VolumeControlType, Characteristic.VolumeControlType.ABSOLUTE);
    this.tvService.addLinkedService(speakerService);
    this.speakerService = speakerService;

    // Task 5: VolumeSelector handler (fire-and-forget to avoid blocking HAP-NodeJS during wake)
    speakerService.getCharacteristic(Characteristic.VolumeSelector).onSet((value: CharacteristicValue) => {
      void this.requiresActive().then((active) => {
        if (!active) return;
        if (value === Characteristic.VolumeSelector.INCREMENT) {
          this.platform.log.debug('[HomeKit] Volume up');
          this.client.volumeUp();
        } else {
          this.platform.log.debug('[HomeKit] Volume down');
          this.client.volumeDown();
        }
      });
    });

    // Task 6: Mute handlers (fire-and-forget to avoid blocking HAP-NodeJS during wake)
    speakerService.getCharacteristic(Characteristic.Mute).onSet((value: CharacteristicValue) => {
      void this.requiresActive().then((active) => {
        if (!active) return;
        const muted = value as boolean;
        this.platform.log.debug(`[HomeKit] Mute ${muted ? 'on' : 'off'}`);
        this.client.setMute(muted);
      });
    });
    speakerService.getCharacteristic(Characteristic.Mute).onGet(() => this.state.mute);

    // Task 4 (Story 2.2): TelevisionSpeaker Volume onGet
    speakerService.getCharacteristic(Characteristic.Volume).onGet(() => {
      return dBToPercentage(this.state.volume, config.volumeFloor, config.volumeCeiling);
    });

    // Volume proxy service: Fan (RotationSpeed) or Lightbulb (Brightness)
    if (config.volumeControl === 'fan' || config.volumeControl === 'lightbulb') {
      const isFan = config.volumeControl === 'fan';
      const ServiceType = isFan ? this.platform.Service.Fan : this.platform.Service.Lightbulb;
      const subtype = isFan ? 'volume-fan' : 'volume-lightbulb';
      const volumeChar = isFan ? Characteristic.RotationSpeed : Characteristic.Brightness;
      const label = isFan ? 'fan' : 'lightbulb';

      const proxyService =
        this.accessory.getService(ServiceType) ||
        this.accessory.addService(ServiceType, `${config.name} Volume`, subtype);
      proxyService.setCharacteristic(Characteristic.ConfiguredName, `${config.name} Volume`);
      this.volumeProxyService = proxyService;
      this.volumeProxyChar = volumeChar as unknown as string;
      this.platform.log.info(`[HomeKit] Volume control: ${label} proxy enabled`);

      // Volume level handlers (fire-and-forget to avoid blocking HAP-NodeJS during wake)
      proxyService.getCharacteristic(volumeChar).onSet((value: CharacteristicValue) => {
        void this.requiresActive().then((active) => {
          if (!active) return;
          const percentage = value as number;
          const dB = percentageToDB(percentage, config.volumeFloor, config.volumeCeiling);
          this.platform.log.debug(`[HomeKit] Set volume to ${percentage}% (${dB}dB)`);
          this.client.setVolume(dB);
        });
      });
      proxyService.getCharacteristic(volumeChar).onGet(() => {
        return dBToPercentage(this.state.volume, config.volumeFloor, config.volumeCeiling);
      });

      // On/Off handlers linked to mute (fire-and-forget to avoid blocking HAP-NodeJS during wake)
      proxyService.getCharacteristic(Characteristic.On).onSet((value: CharacteristicValue) => {
        void this.requiresActive().then((active) => {
          if (!active) return;
          const on = value as boolean;
          this.platform.log.debug(`[HomeKit] Volume proxy ${on ? 'on (unmute)' : 'off (mute)'}`);
          this.client.setMute(!on);
        });
      });
      proxyService.getCharacteristic(Characteristic.On).onGet(() => !this.state.mute);
    } else {
      this.platform.log.info('[HomeKit] Volume control: proxy disabled');
    }

    // Capture proxy references for use in closures (TS can't narrow `this.x` inside callbacks)
    const proxyService = this.volumeProxyService;
    const proxyVolumeChar = this.volumeProxyChar;

    // Mute event — bidirectional sync
    this.client.on('mute', (muted: boolean) => {
      this.state.mute = muted;
      this.speakerService.getCharacteristic(Characteristic.Mute).updateValue(muted, EXTERNAL_CONTEXT);
      if (proxyService) {
        proxyService.getCharacteristic(Characteristic.On).updateValue(!muted, EXTERNAL_CONTEXT);
      }
      this.platform.log.debug(`[HomeKit] Mute state updated: ${muted ? 'muted' : 'unmuted'}`);
    });

    // Volume event — bidirectional sync
    this.client.on('volume', (dB: number) => {
      this.state.volume = dB;
      const percentage = dBToPercentage(dB, config.volumeFloor, config.volumeCeiling);
      this.speakerService.getCharacteristic(Characteristic.Volume).updateValue(percentage, EXTERNAL_CONTEXT);
      if (proxyService && proxyVolumeChar) {
        proxyService.getCharacteristic(proxyVolumeChar)!.updateValue(percentage, EXTERNAL_CONTEXT);
      }
      this.platform.log.debug(`[HomeKit] Volume level: ${dB}dB (${percentage}%)`);
    });

    // Stories 3.1/3.2: Input list → InputSource registration with alias support
    this.client.on('inputList', (inputs: InputInfo[]) => {
      for (const input of inputs) {
        const alias = config.inputs[String(input.id)];
        const displayName = alias ?? input.name;
        if (alias) {
          this.platform.log.debug(
            `[HomeKit] Input ID ${input.id} alias: "${alias}" (overrides "${input.name}")`,
          );
        }
        const inputSource =
          this.accessory.getService(`input-${input.id}`) ||
          this.accessory.addService(
            this.platform.Service.InputSource,
            displayName,
            `input-${input.id}`,
          );
        inputSource.setCharacteristic(Characteristic.Identifier, input.id);
        inputSource.setCharacteristic(Characteristic.ConfiguredName, displayName);
        inputSource.setCharacteristic(
          Characteristic.IsConfigured,
          Characteristic.IsConfigured.CONFIGURED,
        );
        inputSource.setCharacteristic(
          Characteristic.InputSourceType,
          Characteristic.InputSourceType.HDMI,
        );
        inputSource.setCharacteristic(
          Characteristic.CurrentVisibilityState,
          Characteristic.CurrentVisibilityState.SHOWN,
        );
        this.tvService.addLinkedService(inputSource);
        this.inputSources.set(input.id, inputSource);
        this.platform.log.debug(`[HomeKit] Registered InputSource: ${displayName} (ID ${input.id})`);
      }
      this.platform.log.info(`[HomeKit] Input sources registered: ${inputs.length}`);
    });

    // Story 3.1: Input change broadcast → ActiveIdentifier sync
    this.client.on('input', (inputId: number) => {
      this.state.input = inputId;
      this.tvService
        .getCharacteristic(Characteristic.ActiveIdentifier)
        .updateValue(inputId, EXTERNAL_CONTEXT);
      this.platform.log.debug(`[HomeKit] Active input updated: ID ${inputId}`);
    });
  }

  private async requiresActive(): Promise<boolean> {
    if (this.client.getProcessorState() === ProcessorState.Active) return true;
    const reached = await this.client.ensureActive();
    if (!reached) {
      this.platform.log.debug('[State] Command dropped — processor did not reach active state');
    }
    return reached;
  }
}
