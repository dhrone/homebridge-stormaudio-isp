import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { StormAudioPlatform } from './platform';
import type { StormAudioClient } from './stormAudioClient';
import { ProcessorState } from './types';

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
  private readonly state = { power: false, mute: false, volume: -100 };

  constructor(
    private readonly platform: StormAudioPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly client: StormAudioClient,
  ) {
    const { Characteristic } = this.platform;
    const name = this.platform.validatedConfig!.name;

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

    // Task 5: VolumeSelector handler
    speakerService.getCharacteristic(Characteristic.VolumeSelector).onSet(async (value: CharacteristicValue) => {
      if (!(await this.requiresActive())) return;
      if (value === Characteristic.VolumeSelector.INCREMENT) {
        this.platform.log.debug('[HomeKit] Volume up');
        this.client.volumeUp();
      } else {
        this.platform.log.debug('[HomeKit] Volume down');
        this.client.volumeDown();
      }
    });

    // Task 6: Mute handlers
    speakerService.getCharacteristic(Characteristic.Mute).onSet(async (value: CharacteristicValue) => {
      if (!(await this.requiresActive())) return;
      const muted = value as boolean;
      this.platform.log.debug(`[HomeKit] Mute ${muted ? 'on' : 'off'}`);
      this.client.setMute(muted);
    });
    speakerService.getCharacteristic(Characteristic.Mute).onGet(() => this.state.mute);

    // Task 7: Mute event — bidirectional sync
    this.client.on('mute', (muted: boolean) => {
      this.state.mute = muted;
      this.speakerService.getCharacteristic(Characteristic.Mute).updateValue(muted, EXTERNAL_CONTEXT);
      this.platform.log.debug(`[HomeKit] Mute state updated: ${muted ? 'muted' : 'unmuted'}`);
    });

    // Task 8: Volume event — state tracking only
    this.client.on('volume', (dB: number) => {
      this.state.volume = dB;
      this.platform.log.debug(`[HomeKit] Volume level: ${dB}dB`);
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
