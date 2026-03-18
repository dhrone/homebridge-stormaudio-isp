import { describe, expect, it, vi } from 'vitest';

import { EventEmitter } from 'events';

import type { StormAudioPlatform } from '../src/platform';
import { StormAudioZone2Accessory } from '../src/zone2Accessory';
import { ProcessorState } from '../src/types';
import type { Zone2Config } from '../src/types';

// --- Mock Homebridge types ---

const ActiveEnum = { ACTIVE: 1, INACTIVE: 0 } as const;

const SleepDiscoveryModeEnum = {
  ALWAYS_DISCOVERABLE: 1,
  NOT_DISCOVERABLE: 0,
} as const;

class MockHapStatusError extends Error {
  constructor(public readonly hapStatus: number) {
    super(`HapStatusError: ${hapStatus}`);
    this.name = 'HapStatusError';
  }
}

const MockHAPStatus = { SERVICE_COMMUNICATION_FAILURE: -70402 } as const;

function createMockCharacteristic() {
  let onSetHandler: ((value: unknown) => void | Promise<void>) | null = null;
  let onGetHandler: (() => unknown) | null = null;
  const updateValueFn = vi.fn();

  return {
    onSet: vi.fn((handler: (value: unknown) => void | Promise<void>) => {
      onSetHandler = handler;
      return createMockCharacteristic();
    }),
    onGet: vi.fn((handler: () => unknown) => {
      onGetHandler = handler;
      return createMockCharacteristic();
    }),
    updateValue: updateValueFn,
    _triggerSet: (value: unknown) => onSetHandler?.(value),
    _triggerGet: () => onGetHandler?.(),
    _getUpdateValueMock: () => updateValueFn,
  };
}

function createMockService() {
  const characteristics = new Map<string, ReturnType<typeof createMockCharacteristic>>();
  const key = (charType: unknown) => String(charType);

  const getCharacteristic = vi.fn((charType: unknown) => {
    const k = key(charType);
    if (!characteristics.has(k)) {
      characteristics.set(k, createMockCharacteristic());
    }
    return characteristics.get(k)!;
  });

  return {
    setCharacteristic: vi.fn().mockReturnThis(),
    getCharacteristic,
    addLinkedService: vi.fn(),
    _getChar: (name: string) => characteristics.get(key(name)),
    _characteristics: characteristics,
  };
}

function createMockClient() {
  const emitter = new EventEmitter();
  return {
    on: emitter.on.bind(emitter),
    listenerCount: emitter.listenerCount.bind(emitter),
    setZoneMute: vi.fn(),
    setZoneVolume: vi.fn(),
    _emit: emitter.emit.bind(emitter),
  };
}

function createMockPlatform(zone2ConfigOverride?: Partial<Zone2Config>) {
  const CharacteristicMock = {
    Name: 'Name',
    ConfiguredName: 'ConfiguredName',
    SleepDiscoveryMode: Object.assign('SleepDiscoveryMode', SleepDiscoveryModeEnum),
    ActiveIdentifier: 'ActiveIdentifier',
    Active: Object.assign('Active', ActiveEnum),
    VolumeSelector: Object.assign('VolumeSelector', { INCREMENT: 0, DECREMENT: 1 }),
    Mute: 'Mute',
    VolumeControlType: Object.assign('VolumeControlType', { ABSOLUTE: 3 }),
    Volume: 'Volume',
    Brightness: 'Brightness',
    RotationSpeed: 'RotationSpeed',
    On: 'On',
    Identifier: 'Identifier',
    IsConfigured: Object.assign('IsConfigured', { CONFIGURED: 1, NOT_CONFIGURED: 0 }),
    InputSourceType: Object.assign('InputSourceType', { OTHER: 2 }),
    CurrentVisibilityState: Object.assign('CurrentVisibilityState', { SHOWN: 0, HIDDEN: 1 }),
  };

  const ServiceMock = {
    Television: 'Television',
    TelevisionSpeaker: 'TelevisionSpeaker',
    Fan: 'Fan',
    Lightbulb: 'Lightbulb',
    InputSource: 'InputSource',
  };

  const defaultZone2: Zone2Config = {
    zoneId: 13,
    name: 'Patio',
    volumeFloor: -80,
    volumeCeiling: 0,
    volumeControl: 'fan',
    ...zone2ConfigOverride,
  };

  return {
    Service: ServiceMock,
    Characteristic: CharacteristicMock,
    validatedConfig: { zone2: defaultZone2 },
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    api: {
      hap: {
        Characteristic: CharacteristicMock,
        Service: ServiceMock,
        HapStatusError: MockHapStatusError,
        HAPStatus: MockHAPStatus,
      },
    },
  } as unknown as StormAudioPlatform;
}

function createMockAccessory() {
  const tvService = createMockService();
  const speakerService = createMockService();
  const fanService = createMockService();
  const lightbulbService = createMockService();
  const inputSourceServices = new Map<string, ReturnType<typeof createMockService>>();

  const getService = vi.fn((type: unknown) => {
    const t = String(type);
    if (t === 'Television') return tvService;
    if (inputSourceServices.has(t)) return inputSourceServices.get(t)!;
    return null;
  });

  const addService = vi.fn((...args: unknown[]) => {
    const serviceType = String(args[0]);
    if (serviceType === 'TelevisionSpeaker') return speakerService;
    if (serviceType === 'Fan') return fanService;
    if (serviceType === 'Lightbulb') return lightbulbService;
    if (serviceType === 'InputSource') {
      const subtype = String(args[2]);
      const svc = createMockService();
      inputSourceServices.set(subtype, svc);
      return svc;
    }
    return tvService;
  });

  return {
    getService,
    addService,
    _tvService: tvService,
    _speakerService: speakerService,
    _fanService: fanService,
    _lightbulbService: lightbulbService,
    _inputSourceServices: inputSourceServices,
    category: undefined as number | undefined,
    displayName: 'Patio',
  };
}

// --- Helper to build a Zone2Accessory with default fan config ---
function buildZone2Accessory(zone2Override?: Partial<Zone2Config>) {
  const platform = createMockPlatform(zone2Override);
  const accessory = createMockAccessory();
  const client = createMockClient();
  const zone2Config: Zone2Config = {
    zoneId: 13,
    name: 'Patio',
    volumeFloor: -80,
    volumeCeiling: 0,
    volumeControl: 'fan',
    ...zone2Override,
  };
  new StormAudioZone2Accessory(platform, accessory as never, client as never, zone2Config);
  return { platform, accessory, client, zone2Config };
}

// ─────────────────────────────────────────────────────────────────────────────
// Television service setup
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioZone2Accessory — Television service setup', () => {
  it('gets or adds Television service', () => {
    const { accessory } = buildZone2Accessory();
    // getService is called first (returns existing service); addService only called if not found
    expect(accessory.getService).toHaveBeenCalledWith('Television');
  });

  it('sets ConfiguredName on TV service', () => {
    const { accessory } = buildZone2Accessory();
    expect(accessory._tvService.setCharacteristic).toHaveBeenCalledWith('ConfiguredName', 'Patio');
  });

  it('sets SleepDiscoveryMode to ALWAYS_DISCOVERABLE', () => {
    const { accessory } = buildZone2Accessory();
    const calls = (accessory._tvService.setCharacteristic as ReturnType<typeof vi.fn>).mock.calls;
    const sdmCall = calls.find((c: unknown[]) => String(c[0]) === 'SleepDiscoveryMode');
    expect(sdmCall).toBeDefined();
    expect(sdmCall![1]).toBe(SleepDiscoveryModeEnum.ALWAYS_DISCOVERABLE);
  });

  it('sets ActiveIdentifier to 0', () => {
    const { accessory } = buildZone2Accessory();
    expect(accessory._tvService.setCharacteristic).toHaveBeenCalledWith('ActiveIdentifier', 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Follow Main InputSource (AC 14)
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioZone2Accessory — Follow Main InputSource (AC 14)', () => {
  it('registers InputSource with subtype zone2-input-0', () => {
    const { accessory } = buildZone2Accessory();
    expect(accessory.addService).toHaveBeenCalledWith('InputSource', 'Follow Main', 'zone2-input-0');
  });

  it('sets Identifier=0 on Follow Main InputSource', () => {
    const { accessory } = buildZone2Accessory();
    const inputSource = accessory._inputSourceServices.get('zone2-input-0')!;
    expect(inputSource.setCharacteristic).toHaveBeenCalledWith('Identifier', 0);
  });

  it('sets ConfiguredName="Follow Main" on InputSource', () => {
    const { accessory } = buildZone2Accessory();
    const inputSource = accessory._inputSourceServices.get('zone2-input-0')!;
    expect(inputSource.setCharacteristic).toHaveBeenCalledWith('ConfiguredName', 'Follow Main');
  });

  it('links InputSource to TV service', () => {
    const { accessory } = buildZone2Accessory();
    expect(accessory._tvService.addLinkedService).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Power on/off (AC 6, 7)
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioZone2Accessory — Power on/off (AC 6, 7, D15 siblings)', () => {
  it('Zone 2 power off (mute) — sends ssp.zones.mute.[13, 1] (integer 1, not "on")', () => {
    const { accessory, client } = buildZone2Accessory();
    const activeChar = accessory._tvService._getChar('Active')!;
    activeChar._triggerSet(0); // INACTIVE
    expect(client.setZoneMute).toHaveBeenCalledWith(13, true);
  });

  it('Zone 2 power on (unmute) — sends ssp.zones.mute.[13, 0] (integer 0, not "off")', () => {
    const { accessory, client } = buildZone2Accessory();
    const activeChar = accessory._tvService._getChar('Active')!;
    activeChar._triggerSet(1); // ACTIVE
    expect(client.setZoneMute).toHaveBeenCalledWith(13, false);
  });

  it('Active onGet returns ACTIVE when unmuted', () => {
    const { accessory } = buildZone2Accessory();
    const activeChar = accessory._tvService._getChar('Active')!;
    expect(activeChar._triggerGet()).toBe(1); // ACTIVE (state.mute=false by default)
  });

  it('Active onGet returns INACTIVE when muted', () => {
    const { accessory, client } = buildZone2Accessory();
    // Simulate mute broadcast to set state
    client._emit('zoneUpdate', 13, 'mute', true);
    const activeChar = accessory._tvService._getChar('Active')!;
    expect(activeChar._triggerGet()).toBe(0); // INACTIVE
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Volume proxy — Fan (AC 3)
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioZone2Accessory — Volume proxy: Fan', () => {
  it('creates Fan service when volumeControl="fan"', () => {
    const { accessory } = buildZone2Accessory({ volumeControl: 'fan' });
    expect(accessory.addService).toHaveBeenCalledWith('Fan', 'Patio Volume', 'zone2-volume-fan');
  });

  it('Zone 2 volume set via Fan proxy — 50% maps to -40dB', () => {
    // floor=-80, ceiling=0: 50% → -80 + 0.5*80 = -80+40 = -40
    const { accessory, client } = buildZone2Accessory({ volumeControl: 'fan', volumeFloor: -80, volumeCeiling: 0 });
    const rotSpeedChar = accessory._fanService._getChar('RotationSpeed')!;
    rotSpeedChar._triggerSet(50);
    expect(client.setZoneVolume).toHaveBeenCalledWith(13, -40);
  });

  it('Fan proxy On=false maps to zone mute (setZoneMute true)', () => {
    const { accessory, client } = buildZone2Accessory({ volumeControl: 'fan' });
    const onChar = accessory._fanService._getChar('On')!;
    onChar._triggerSet(false);
    expect(client.setZoneMute).toHaveBeenCalledWith(13, true);
  });

  it('Fan proxy On=true maps to zone unmute (setZoneMute false)', () => {
    const { accessory, client } = buildZone2Accessory({ volumeControl: 'fan' });
    const onChar = accessory._fanService._getChar('On')!;
    onChar._triggerSet(true);
    expect(client.setZoneMute).toHaveBeenCalledWith(13, false);
  });

  it('Fan RotationSpeed onGet returns correct percentage from state', () => {
    const { accessory, client } = buildZone2Accessory({ volumeControl: 'fan', volumeFloor: -80, volumeCeiling: 0 });
    client._emit('zoneUpdate', 13, 'volume', -60);
    const rotSpeedChar = accessory._fanService._getChar('RotationSpeed')!;
    expect(rotSpeedChar._triggerGet()).toBe(25); // dBToPercentage(-60, -80, 0) = 25%
  });

  it('Fan On onGet returns true when unmuted (default)', () => {
    const { accessory } = buildZone2Accessory({ volumeControl: 'fan' });
    const onChar = accessory._fanService._getChar('On')!;
    expect(onChar._triggerGet()).toBe(true); // state.mute=false → !false = true
  });

  it('Fan On onGet returns false when muted', () => {
    const { accessory, client } = buildZone2Accessory({ volumeControl: 'fan' });
    client._emit('zoneUpdate', 13, 'mute', true);
    const onChar = accessory._fanService._getChar('On')!;
    expect(onChar._triggerGet()).toBe(false); // state.mute=true → !true = false
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Volume proxy — Lightbulb (AC 3)
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioZone2Accessory — Volume proxy: Lightbulb', () => {
  it('creates Lightbulb service when volumeControl="lightbulb"', () => {
    const { accessory } = buildZone2Accessory({ volumeControl: 'lightbulb' });
    expect(accessory.addService).toHaveBeenCalledWith('Lightbulb', 'Patio Volume', 'zone2-volume-lightbulb');
  });

  it('Zone 2 volume set via Lightbulb proxy — 50% maps to -40dB', () => {
    const { accessory, client } = buildZone2Accessory({ volumeControl: 'lightbulb', volumeFloor: -80, volumeCeiling: 0 });
    const brightnessChar = accessory._lightbulbService._getChar('Brightness')!;
    brightnessChar._triggerSet(50);
    expect(client.setZoneVolume).toHaveBeenCalledWith(13, -40);
  });

  it('Lightbulb proxy On=false maps to zone mute (integer 1, not "on")', () => {
    const { accessory, client } = buildZone2Accessory({ volumeControl: 'lightbulb' });
    const onChar = accessory._lightbulbService._getChar('On')!;
    onChar._triggerSet(false);
    expect(client.setZoneMute).toHaveBeenCalledWith(13, true);
  });

  it('Lightbulb proxy On=true maps to zone unmute (integer 0, not "off")', () => {
    const { accessory, client } = buildZone2Accessory({ volumeControl: 'lightbulb' });
    const onChar = accessory._lightbulbService._getChar('On')!;
    onChar._triggerSet(true);
    expect(client.setZoneMute).toHaveBeenCalledWith(13, false);
  });

  it('Lightbulb Brightness onGet returns correct percentage from state', () => {
    const { accessory, client } = buildZone2Accessory({ volumeControl: 'lightbulb', volumeFloor: -80, volumeCeiling: 0 });
    client._emit('zoneUpdate', 13, 'volume', -40);
    const brightnessChar = accessory._lightbulbService._getChar('Brightness')!;
    expect(brightnessChar._triggerGet()).toBe(50); // dBToPercentage(-40, -80, 0) = 50%
  });

  it('Lightbulb On onGet returns true when unmuted, false when muted', () => {
    const { accessory, client } = buildZone2Accessory({ volumeControl: 'lightbulb' });
    const onChar = accessory._lightbulbService._getChar('On')!;
    expect(onChar._triggerGet()).toBe(true); // unmuted by default
    client._emit('zoneUpdate', 13, 'mute', true);
    expect(onChar._triggerGet()).toBe(false); // muted
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Volume proxy disabled (none) (AC 26)
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioZone2Accessory — Volume proxy: none (AC 26)', () => {
  it('no Fan or Lightbulb service created when volumeControl="none"', () => {
    const { accessory } = buildZone2Accessory({ volumeControl: 'none' });
    const addCalls = (accessory.addService as ReturnType<typeof vi.fn>).mock.calls;
    const serviceTypes = addCalls.map(c => String(c[0]));
    expect(serviceTypes).not.toContain('Fan');
    expect(serviceTypes).not.toContain('Lightbulb');
  });

  it('TelevisionSpeaker Volume onGet still works with no proxy', () => {
    const { accessory } = buildZone2Accessory({ volumeControl: 'none', volumeFloor: -80, volumeCeiling: 0 });
    const volumeChar = accessory._speakerService._getChar('Volume')!;
    // state.volume starts at -80 (floor), so 0%
    const val = volumeChar._triggerGet();
    expect(val).toBe(0); // dBToPercentage(-80, -80, 0) = 0%
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VolumeSelector (AC 9)
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioZone2Accessory — VolumeSelector (AC 9)', () => {
  it('VolumeSelector INCREMENT sends volume + 1 dB', () => {
    const { accessory, client } = buildZone2Accessory({ volumeFloor: -80, volumeCeiling: 0 });
    // Set initial volume to -60 via broadcast
    client._emit('zoneUpdate', 13, 'volume', -60);
    const selectorChar = accessory._speakerService._getChar('VolumeSelector')!;
    selectorChar._triggerSet(0); // INCREMENT
    expect(client.setZoneVolume).toHaveBeenCalledWith(13, -59);
  });

  it('VolumeSelector DECREMENT sends volume - 1 dB', () => {
    const { accessory, client } = buildZone2Accessory({ volumeFloor: -80, volumeCeiling: 0 });
    client._emit('zoneUpdate', 13, 'volume', -60);
    const selectorChar = accessory._speakerService._getChar('VolumeSelector')!;
    selectorChar._triggerSet(1); // DECREMENT
    expect(client.setZoneVolume).toHaveBeenCalledWith(13, -61);
  });

  // Boundary: VolumeSelector at ceiling — no command sent (AC 19)
  it('VolumeSelector INCREMENT at ceiling — no command sent', () => {
    const { accessory, client } = buildZone2Accessory({ volumeFloor: -80, volumeCeiling: 0 });
    client._emit('zoneUpdate', 13, 'volume', 0); // at ceiling
    const selectorChar = accessory._speakerService._getChar('VolumeSelector')!;
    selectorChar._triggerSet(0); // INCREMENT
    expect(client.setZoneVolume).not.toHaveBeenCalled();
  });

  // Boundary: VolumeSelector at floor — no command sent (AC 20)
  it('VolumeSelector DECREMENT at floor — no command sent', () => {
    const { accessory, client } = buildZone2Accessory({ volumeFloor: -80, volumeCeiling: 0 });
    // state.volume starts at -80 (floor default)
    const selectorChar = accessory._speakerService._getChar('VolumeSelector')!;
    selectorChar._triggerSet(1); // DECREMENT
    expect(client.setZoneVolume).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Zone 2 volume broadcast sync (AC 11)
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioZone2Accessory — volume broadcast sync (AC 11)', () => {
  it('zoneUpdate volume=-60 updates TelevisionSpeaker Volume to 25%', () => {
    // floor=-80, ceiling=0: (-60 - (-80)) / (0 - (-80)) * 100 = 20/80*100 = 25
    const { accessory, client } = buildZone2Accessory({ volumeFloor: -80, volumeCeiling: 0, volumeControl: 'fan' });
    client._emit('zoneUpdate', 13, 'volume', -60);
    const volumeUpdateMock = accessory._speakerService._getChar('Volume')!._getUpdateValueMock();
    expect(volumeUpdateMock).toHaveBeenCalledWith(25, { source: 'stormaudio' });
  });

  it('zoneUpdate volume updates Fan proxy RotationSpeed', () => {
    const { accessory, client } = buildZone2Accessory({ volumeFloor: -80, volumeCeiling: 0, volumeControl: 'fan' });
    client._emit('zoneUpdate', 13, 'volume', -60);
    const rotSpeedUpdateMock = accessory._fanService._getChar('RotationSpeed')!._getUpdateValueMock();
    expect(rotSpeedUpdateMock).toHaveBeenCalledWith(25, { source: 'stormaudio' });
  });

  // Boundary: broadcast dB below floor — clamps to 0% (AC 21)
  it('zoneUpdate volume below floor clamps to 0%', () => {
    const { accessory, client } = buildZone2Accessory({ volumeFloor: -80, volumeCeiling: 0, volumeControl: 'none' });
    client._emit('zoneUpdate', 13, 'volume', -120); // below floor
    const volumeUpdateMock = accessory._speakerService._getChar('Volume')!._getUpdateValueMock();
    expect(volumeUpdateMock).toHaveBeenCalledWith(0, { source: 'stormaudio' });
  });

  it('zoneUpdate volume at ceiling = 100%', () => {
    const { accessory, client } = buildZone2Accessory({ volumeFloor: -80, volumeCeiling: 0, volumeControl: 'none' });
    client._emit('zoneUpdate', 13, 'volume', 0);
    const volumeUpdateMock = accessory._speakerService._getChar('Volume')!._getUpdateValueMock();
    expect(volumeUpdateMock).toHaveBeenCalledWith(100, { source: 'stormaudio' });
  });

  it('zoneUpdate volume at floor = 0%', () => {
    const { accessory, client } = buildZone2Accessory({ volumeFloor: -80, volumeCeiling: 0, volumeControl: 'none' });
    client._emit('zoneUpdate', 13, 'volume', -80);
    const volumeUpdateMock = accessory._speakerService._getChar('Volume')!._getUpdateValueMock();
    expect(volumeUpdateMock).toHaveBeenCalledWith(0, { source: 'stormaudio' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Zone 2 mute broadcast sync (AC 10)
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioZone2Accessory — mute broadcast sync (AC 10)', () => {
  it('zoneUpdate mute=true pushes Active=INACTIVE, Mute=true, proxy On=false', () => {
    const { accessory, client } = buildZone2Accessory({ volumeControl: 'fan' });
    client._emit('zoneUpdate', 13, 'mute', true);

    const activeUpdate = accessory._tvService._getChar('Active')!._getUpdateValueMock();
    const muteUpdate = accessory._speakerService._getChar('Mute')!._getUpdateValueMock();
    const proxyOnUpdate = accessory._fanService._getChar('On')!._getUpdateValueMock();

    expect(activeUpdate).toHaveBeenCalledWith(0, { source: 'stormaudio' }); // INACTIVE
    expect(muteUpdate).toHaveBeenCalledWith(true, { source: 'stormaudio' });
    expect(proxyOnUpdate).toHaveBeenCalledWith(false, { source: 'stormaudio' });
  });

  it('zoneUpdate mute=false pushes Active=ACTIVE, Mute=false, proxy On=true', () => {
    const { accessory, client } = buildZone2Accessory({ volumeControl: 'fan' });
    // First mute, then unmute
    client._emit('zoneUpdate', 13, 'mute', true);
    client._emit('zoneUpdate', 13, 'mute', false);

    const activeUpdate = accessory._tvService._getChar('Active')!._getUpdateValueMock();
    const muteUpdate = accessory._speakerService._getChar('Mute')!._getUpdateValueMock();
    const proxyOnUpdate = accessory._fanService._getChar('On')!._getUpdateValueMock();

    expect(activeUpdate).toHaveBeenLastCalledWith(1, { source: 'stormaudio' }); // ACTIVE
    expect(muteUpdate).toHaveBeenLastCalledWith(false, { source: 'stormaudio' });
    expect(proxyOnUpdate).toHaveBeenLastCalledWith(true, { source: 'stormaudio' });
  });

  // zoneUpdate field siblings
  it('zoneUpdate field=useZone2 for configured zoneId — silently ignored', () => {
    const { accessory, client } = buildZone2Accessory({ volumeControl: 'none' });
    expect(() => client._emit('zoneUpdate', 13, 'useZone2', true)).not.toThrow();
    // No HomeKit updates triggered
    const activeUpdate = accessory._tvService._getChar('Active')!._getUpdateValueMock();
    expect(activeUpdate).not.toHaveBeenCalled();
  });

  // zoneUpdate for wrong zoneId ignored (AC 25)
  it('zoneUpdate for different zoneId is ignored', () => {
    const { accessory, client } = buildZone2Accessory({ volumeControl: 'fan' });
    client._emit('zoneUpdate', 99, 'mute', true); // wrong zoneId
    const activeUpdate = accessory._tvService._getChar('Active')!._getUpdateValueMock();
    const muteUpdate = accessory._speakerService._getChar('Mute')!._getUpdateValueMock();
    expect(activeUpdate).not.toHaveBeenCalled();
    expect(muteUpdate).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Processor sleep/wake handling (AC 12, 13)
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioZone2Accessory — processor state siblings (AC 12, 13)', () => {
  it('processorState=Sleep pushes Active=INACTIVE — no command sent', () => {
    const { accessory, client } = buildZone2Accessory();
    client._emit('processorState', ProcessorState.Sleep);
    const activeUpdate = accessory._tvService._getChar('Active')!._getUpdateValueMock();
    expect(activeUpdate).toHaveBeenCalledWith(0, { source: 'stormaudio' }); // INACTIVE
    expect(client.setZoneMute).not.toHaveBeenCalled();
    expect(client.setZoneVolume).not.toHaveBeenCalled();
  });

  it('processorState=Active — no Active push (state dump broadcasts handle it)', () => {
    const { accessory, client } = buildZone2Accessory();
    client._emit('processorState', ProcessorState.Active);
    const activeUpdate = accessory._tvService._getChar('Active')!._getUpdateValueMock();
    expect(activeUpdate).not.toHaveBeenCalled();
  });

  it('processorState=Initializing — no Active push', () => {
    const { accessory, client } = buildZone2Accessory();
    client._emit('processorState', ProcessorState.Initializing);
    const activeUpdate = accessory._tvService._getChar('Active')!._getUpdateValueMock();
    expect(activeUpdate).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Disconnect / reconnect handling (AC 16, 22)
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioZone2Accessory — disconnect handling (AC 16, 22)', () => {
  it('disconnect pushes Active=INACTIVE', () => {
    const { accessory, client } = buildZone2Accessory();
    client._emit('disconnected');
    const activeUpdate = accessory._tvService._getChar('Active')!._getUpdateValueMock();
    expect(activeUpdate).toHaveBeenCalledWith(0, { source: 'stormaudio' }); // INACTIVE
  });

  it('Active onSet throws HapStatusError when disconnected', () => {
    const { accessory, client } = buildZone2Accessory();
    client._emit('disconnected');
    const activeChar = accessory._tvService._getChar('Active')!;
    expect(() => activeChar._triggerSet(1)).toThrow(MockHapStatusError);
  });

  it('volume proxy level onSet throws HapStatusError when disconnected', () => {
    const { accessory, client } = buildZone2Accessory({ volumeControl: 'fan' });
    client._emit('disconnected');
    const rotSpeedChar = accessory._fanService._getChar('RotationSpeed')!;
    expect(() => rotSpeedChar._triggerSet(50)).toThrow(MockHapStatusError);
  });

  it('reconnect restores connected=true — commands work again', () => {
    const { accessory, client } = buildZone2Accessory();
    client._emit('disconnected');
    client._emit('connected');
    const activeChar = accessory._tvService._getChar('Active')!;
    expect(() => activeChar._triggerSet(0)).not.toThrow();
    expect(client.setZoneMute).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Volume boundary tests (AC 15, 16, 17, 18)
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioZone2Accessory — volume boundary tests', () => {
  // Boundary: volume at ceiling (AC 15)
  it('set Fan proxy to 100% — sends exactly ceiling dB (0)', () => {
    const { accessory, client } = buildZone2Accessory({ volumeFloor: -80, volumeCeiling: 0, volumeControl: 'fan' });
    const rotSpeedChar = accessory._fanService._getChar('RotationSpeed')!;
    rotSpeedChar._triggerSet(100);
    expect(client.setZoneVolume).toHaveBeenCalledWith(13, 0);
  });

  // Boundary: volume at floor (AC 16)
  it('set Fan proxy to 0% — sends exactly floor dB (-80)', () => {
    const { accessory, client } = buildZone2Accessory({ volumeFloor: -80, volumeCeiling: 0, volumeControl: 'fan' });
    const rotSpeedChar = accessory._fanService._getChar('RotationSpeed')!;
    rotSpeedChar._triggerSet(0);
    expect(client.setZoneVolume).toHaveBeenCalledWith(13, -80);
  });

  // Boundary: out of range > 100% — clamped (AC 17)
  it('set Fan proxy to 110% — clamps to ceiling dB (0)', () => {
    const { accessory, client } = buildZone2Accessory({ volumeFloor: -80, volumeCeiling: 0, volumeControl: 'fan' });
    const rotSpeedChar = accessory._fanService._getChar('RotationSpeed')!;
    rotSpeedChar._triggerSet(110);
    expect(client.setZoneVolume).toHaveBeenCalledWith(13, 0);
  });

  // Boundary: out of range < 0% — clamped (AC 18)
  it('set Fan proxy to -5% — clamps to floor dB (-80)', () => {
    const { accessory, client } = buildZone2Accessory({ volumeFloor: -80, volumeCeiling: 0, volumeControl: 'fan' });
    const rotSpeedChar = accessory._fanService._getChar('RotationSpeed')!;
    rotSpeedChar._triggerSet(-5);
    expect(client.setZoneVolume).toHaveBeenCalledWith(13, -80);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Listener cleanup verification
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioZone2Accessory — listener cleanup (listenerCount)', () => {
  it('constructor registers 1 zoneUpdate listener', () => {
    const client = createMockClient();
    const baseline = client.listenerCount('zoneUpdate');
    const platform = createMockPlatform();
    const accessory = createMockAccessory();
    const zone2Config: Zone2Config = { zoneId: 13, name: 'Patio', volumeFloor: -80, volumeCeiling: 0, volumeControl: 'none' };
    new StormAudioZone2Accessory(platform, accessory as never, client as never, zone2Config);
    expect(client.listenerCount('zoneUpdate')).toBe(baseline + 1);
  });

  it('constructor registers 1 processorState listener', () => {
    const client = createMockClient();
    const baseline = client.listenerCount('processorState');
    const platform = createMockPlatform();
    const accessory = createMockAccessory();
    const zone2Config: Zone2Config = { zoneId: 13, name: 'Patio', volumeFloor: -80, volumeCeiling: 0, volumeControl: 'none' };
    new StormAudioZone2Accessory(platform, accessory as never, client as never, zone2Config);
    expect(client.listenerCount('processorState')).toBe(baseline + 1);
  });

  it('constructor registers 1 disconnected listener', () => {
    const client = createMockClient();
    const baseline = client.listenerCount('disconnected');
    const platform = createMockPlatform();
    const accessory = createMockAccessory();
    const zone2Config: Zone2Config = { zoneId: 13, name: 'Patio', volumeFloor: -80, volumeCeiling: 0, volumeControl: 'none' };
    new StormAudioZone2Accessory(platform, accessory as never, client as never, zone2Config);
    expect(client.listenerCount('disconnected')).toBe(baseline + 1);
  });

  it('constructor registers 1 connected listener', () => {
    const client = createMockClient();
    const baseline = client.listenerCount('connected');
    const platform = createMockPlatform();
    const accessory = createMockAccessory();
    const zone2Config: Zone2Config = { zoneId: 13, name: 'Patio', volumeFloor: -80, volumeCeiling: 0, volumeControl: 'none' };
    new StormAudioZone2Accessory(platform, accessory as never, client as never, zone2Config);
    expect(client.listenerCount('connected')).toBe(baseline + 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mute speaker handlers
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioZone2Accessory — TelevisionSpeaker Mute handlers', () => {
  it('Mute onSet sends setZoneMute', () => {
    const { accessory, client } = buildZone2Accessory();
    const muteChar = accessory._speakerService._getChar('Mute')!;
    muteChar._triggerSet(true);
    expect(client.setZoneMute).toHaveBeenCalledWith(13, true);
  });

  it('Mute onGet returns current mute state', () => {
    const { accessory, client } = buildZone2Accessory();
    client._emit('zoneUpdate', 13, 'mute', true);
    const muteChar = accessory._speakerService._getChar('Mute')!;
    expect(muteChar._triggerGet()).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TelevisionSpeaker Volume onGet
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioZone2Accessory — TelevisionSpeaker Volume onGet', () => {
  it('Volume onGet returns percentage based on zone2 floor/ceiling', () => {
    // Initial state.volume = -80 (floor), floor=-80, ceiling=0 → 0%
    const { accessory } = buildZone2Accessory({ volumeFloor: -80, volumeCeiling: 0 });
    const volumeChar = accessory._speakerService._getChar('Volume')!;
    expect(volumeChar._triggerGet()).toBe(0);
  });

  it('Volume onGet after broadcast returns updated percentage', () => {
    const { accessory, client } = buildZone2Accessory({ volumeFloor: -80, volumeCeiling: 0 });
    client._emit('zoneUpdate', 13, 'volume', -40);
    const volumeChar = accessory._speakerService._getChar('Volume')!;
    expect(volumeChar._triggerGet()).toBe(50); // (-40 - (-80)) / 80 * 100 = 50
  });
});
