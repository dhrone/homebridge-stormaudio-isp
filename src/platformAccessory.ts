import type { PlatformAccessory } from 'homebridge';

import type { StormAudioPlatform } from './platform';

export class StormAudioAccessory {
  constructor(
    private readonly platform: StormAudioPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    // TODO: implement HomeKit services in Story 1.3
  }
}
