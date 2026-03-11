import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { StormAudioPlatform } from './platform';
import type { StormAudioClient } from './stormAudioClient';
import { ProcessorState } from './types';

const EXTERNAL_CONTEXT = { source: 'stormaudio' };

export class StormAudioAccessory {
  private readonly tvService: Service;
  private readonly state = { power: false };

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
