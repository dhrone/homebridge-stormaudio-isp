import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { StormAudioPlatform } from './platform';
import type { StormAudioClient } from './stormAudioClient';
import type { TriggerConfig } from './types';

const EXTERNAL_CONTEXT = { source: 'stormaudio' };

export class StormAudioTriggerAccessory {
  private readonly service: Service;
  private state = false;  // trigger on/off
  private connected = true;

  constructor(
    private readonly platform: StormAudioPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly client: StormAudioClient,
    private readonly triggerId: number,
    private readonly triggerConfig: TriggerConfig,
  ) {
    const { Characteristic } = this.platform;

    // Initialize state from client-tracked state if available
    const initialState = this.client.getTriggerStates().get(triggerId);
    if (initialState !== undefined) {
      this.state = initialState;
    }

    // Connection state tracking
    this.client.on('disconnected', () => {
      this.connected = false;
    });
    this.client.on('connected', () => {
      this.connected = true;
    });

    // Bidirectional sync — triggerState listener
    this.client.on('triggerState', (id: number, on: boolean) => {
      if (id !== this.triggerId) return;
      this.state = on;
      if (this.triggerConfig.type === 'switch') {
        this.service.getCharacteristic(Characteristic.On)
          .updateValue(on, EXTERNAL_CONTEXT);
      } else {
        this.service.getCharacteristic(Characteristic.ContactSensorState)
          .updateValue(
            on
              ? Characteristic.ContactSensorState.CONTACT_DETECTED
              : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED,
            EXTERNAL_CONTEXT,
          );
      }
    });

    if (triggerConfig.type === 'switch') {
      this.service =
        this.accessory.getService(this.platform.Service.Switch) ||
        this.accessory.addService(this.platform.Service.Switch, triggerConfig.name);

      this.service.setCharacteristic(Characteristic.Name, triggerConfig.name);
      this.service.setCharacteristic(Characteristic.ConfiguredName, triggerConfig.name);

      this.service.getCharacteristic(Characteristic.On).onSet((value: CharacteristicValue) => {
        this.ensureConnected();
        this.client.setTrigger(triggerId, value as boolean);
      });
      this.service.getCharacteristic(Characteristic.On).onGet(() => {
        this.ensureConnected();
        return this.state;
      });
    } else {
      // contact sensor
      this.service =
        this.accessory.getService(this.platform.Service.ContactSensor) ||
        this.accessory.addService(this.platform.Service.ContactSensor, triggerConfig.name);

      this.service.setCharacteristic(Characteristic.Name, triggerConfig.name);
      this.service.setCharacteristic(Characteristic.ConfiguredName, triggerConfig.name);

      // Contact sensor is read-only — no onSet
      this.service.getCharacteristic(Characteristic.ContactSensorState).onGet(() => {
        return this.state
          ? Characteristic.ContactSensorState.CONTACT_DETECTED
          : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
      });
    }
  }

  private ensureConnected(): void {
    if (!this.connected) {
      const { HapStatusError, HAPStatus } = this.platform.api.hap;
      throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }
}
