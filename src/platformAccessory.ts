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
  private connected = true;

  constructor(
    private readonly platform: StormAudioPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly client: StormAudioClient,
  ) {
    const { Characteristic } = this.platform;
    const config = this.platform.validatedConfig!;
    const name = config.name;

    // FR20: Bidirectional sync latency is met by the event-driven architecture:
    // ISP broadcasts → parseMessage → typed event → accessory listener → updateValue.
    // No polling is used. Network round-trips on LAN are inherently <1s.

    // Task 5: Track TCP connection status for HomeKit "Not Responding" support (AC: 3, 4)
    this.client.on('disconnected', () => {
      this.connected = false;
      // Push INACTIVE so the tile shows as unavailable — updateValue(HapStatusError) only
      // produces a transient notification; HAP-NodeJS's internal cache holds the last valid
      // value and HomeKit clears the error as soon as it re-reads.
      this.tvService
        .getCharacteristic(Characteristic.Active)
        .updateValue(Characteristic.Active.INACTIVE, EXTERNAL_CONTEXT);
    });
    this.client.on('connected', () => { this.connected = true; });

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
      .onGet(() => { this.ensureConnected(); return this.state.input; });

    // Story 3.2: ActiveIdentifier onSet — send setInput command (fire-and-forget)
    this.tvService
      .getCharacteristic(Characteristic.ActiveIdentifier)
      .onSet((value: CharacteristicValue) => {
        this.ensureConnected();
        void this.requiresActive().then((active) => {
          if (!active) return;
          const inputId = value as number;
          this.platform.log.debug(`[HomeKit] Input switch to ID ${inputId}`);
          this.client.setInput(inputId);
        });
      });

    // Task 3/5: Handle power on/off commands
    this.tvService.getCharacteristic(Characteristic.Active).onSet((value: CharacteristicValue) => {
      this.ensureConnected();
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
      this.ensureConnected();
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
      this.ensureConnected();
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
      this.ensureConnected();
      void this.requiresActive().then((active) => {
        if (!active) return;
        const muted = value as boolean;
        this.platform.log.debug(`[HomeKit] Mute ${muted ? 'on' : 'off'}`);
        this.client.setMute(muted);
      });
    });
    speakerService.getCharacteristic(Characteristic.Mute).onGet(() => { this.ensureConnected(); return this.state.mute; });

    // Task 4 (Story 2.2): TelevisionSpeaker Volume onGet
    speakerService.getCharacteristic(Characteristic.Volume).onGet(() => {
      this.ensureConnected();
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
        this.ensureConnected();
        void this.requiresActive().then((active) => {
          if (!active) return;
          const percentage = value as number;
          const dB = percentageToDB(percentage, config.volumeFloor, config.volumeCeiling);
          this.platform.log.debug(`[HomeKit] Set volume to ${percentage}% (${dB}dB)`);
          this.client.setVolume(dB);
        });
      });
      proxyService.getCharacteristic(volumeChar).onGet(() => {
        this.ensureConnected();
        return dBToPercentage(this.state.volume, config.volumeFloor, config.volumeCeiling);
      });

      // On/Off handlers linked to mute (fire-and-forget to avoid blocking HAP-NodeJS during wake)
      proxyService.getCharacteristic(Characteristic.On).onSet((value: CharacteristicValue) => {
        this.ensureConnected();
        void this.requiresActive().then((active) => {
          if (!active) return;
          const on = value as boolean;
          this.platform.log.debug(`[HomeKit] Volume proxy ${on ? 'on (unmute)' : 'off (mute)'}`);
          this.client.setMute(!on);
        });
      });
      proxyService.getCharacteristic(Characteristic.On).onGet(() => { this.ensureConnected(); return !this.state.mute; });
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

  private ensureConnected(): void {
    if (!this.connected) {
      // Schedule value reversion — HomeKit does not reliably auto-revert slider/numeric
      // characteristics on onSet error, so we push the last known state after the throw.
      // Also re-pushes INACTIVE so the TV tile stays visually unavailable.
      setImmediate(() => { this.revertToLastKnownState(); });
      const { HapStatusError, HAPStatus } = this.platform.api.hap;
      throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  private revertToLastKnownState(): void {
    if (this.connected) return;
    const { Characteristic } = this.platform;
    const config = this.platform.validatedConfig!;
    // Keep TV tile showing as unavailable (INACTIVE is persistent; HapStatusError is transient)
    this.tvService
      .getCharacteristic(Characteristic.Active)
      .updateValue(Characteristic.Active.INACTIVE, EXTERNAL_CONTEXT);
    // Revert mute and volume to last known state
    this.speakerService
      .getCharacteristic(Characteristic.Mute)
      .updateValue(this.state.mute, EXTERNAL_CONTEXT);
    this.speakerService
      .getCharacteristic(Characteristic.Volume)
      .updateValue(dBToPercentage(this.state.volume, config.volumeFloor, config.volumeCeiling), EXTERNAL_CONTEXT);
    if (this.volumeProxyService && this.volumeProxyChar) {
      this.volumeProxyService
        .getCharacteristic(this.volumeProxyChar)!
        .updateValue(dBToPercentage(this.state.volume, config.volumeFloor, config.volumeCeiling), EXTERNAL_CONTEXT);
      this.volumeProxyService
        .getCharacteristic(Characteristic.On)
        .updateValue(!this.state.mute, EXTERNAL_CONTEXT);
    }
  }

  private async requiresActive(): Promise<boolean> {
    if (!this.connected) return false;
    if (this.client.getProcessorState() === ProcessorState.Active) return true;
    const reached = await this.client.ensureActive(this.platform.validatedConfig!.wakeTimeout * 1000);
    if (!reached) {
      this.platform.log.debug('[State] Command dropped — processor did not reach active state');
    }
    return reached;
  }
}
