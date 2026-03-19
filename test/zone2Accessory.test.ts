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
  let inputZone2 = 0;
  return {
    on: emitter.on.bind(emitter),
    listenerCount: emitter.listenerCount.bind(emitter),
    setZoneMute: vi.fn(),
    setZoneVolume: vi.fn(),
    setZoneUseZone2: vi.fn(),
    setInputZone2: vi.fn(),
    getInputZone2: vi.fn(() => inputZone2),
    _setInputZone2State: (id: number) => { inputZone2 = id; },
    _emit: emitter.emit.bind(emitter),
  };
}

function createMockPlatform(zone2ConfigOverride?: Partial<Zone2Config>, inputsOverride?: Record<string, string>) {
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
    validatedConfig: { zone2: defaultZone2, inputs: (inputsOverride ?? {}) as Record<string, string> },
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
function buildZone2Accessory(zone2Override?: Partial<Zone2Config>, inputsOverride?: Record<string, string>) {
  const platform = createMockPlatform(zone2Override, inputsOverride);
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

// Helper to simulate inputList with Zone 2-capable inputs
function simulateInputList(client: ReturnType<typeof createMockClient>, inputs: Array<{ id: number; name: string; zone2AudioInId: number }>) {
  client._emit('inputList', inputs);
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

  it('sets IsConfigured=CONFIGURED and InputSourceType=OTHER on Follow Main InputSource', () => {
    const { accessory } = buildZone2Accessory();
    const inputSource = accessory._inputSourceServices.get('zone2-input-0')!;
    const calls = (inputSource.setCharacteristic as ReturnType<typeof vi.fn>).mock.calls;
    const isConfiguredCall = calls.find((c: unknown[]) => String(c[0]) === 'IsConfigured');
    expect(isConfiguredCall).toBeDefined();
    expect(isConfiguredCall![1]).toBe(1); // CONFIGURED
    const inputSourceTypeCall = calls.find((c: unknown[]) => String(c[0]) === 'InputSourceType');
    expect(inputSourceTypeCall).toBeDefined();
    expect(inputSourceTypeCall![1]).toBe(2); // OTHER
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

  // zoneUpdate field siblings — useZone2Source now handled by Story 5.2
  it('zoneUpdate field=useZone2Source for configured zoneId — pushes ActiveIdentifier', () => {
    const { accessory, client } = buildZone2Accessory({ volumeControl: 'none' });
    client._emit('zoneUpdate', 13, 'useZone2Source', false);
    const aiUpdate = accessory._tvService._getChar('ActiveIdentifier')!._getUpdateValueMock();
    expect(aiUpdate).toHaveBeenCalledWith(0, { source: 'stormaudio' });
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

// ═════════════════════════════════════════════════════════════════════════════
// Story 5.2 — Zone 2 Source Selection
// ═════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// Zone 2 InputSource registration (QA #3, #4, #25)
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioZone2Accessory — Zone 2 InputSource registration (Story 5.2)', () => {
  // QA #3: Zone 2-capable InputSources registered
  it('QA3: registers InputSource with correct subtype, Identifier, IsConfigured, InputSourceType, and SHOWN visibility', () => {
    const { accessory, client } = buildZone2Accessory();
    simulateInputList(client, [
      { id: 6, name: 'Z2-RCA1', zone2AudioInId: 18 },
    ]);
    const svc = accessory._inputSourceServices.get('zone2-input-6')!;
    expect(svc).toBeDefined();
    expect(svc.setCharacteristic).toHaveBeenCalledWith('Identifier', 6);
    expect(svc.setCharacteristic).toHaveBeenCalledWith('ConfiguredName', 'Z2-RCA1');
    // IsConfigured, InputSourceType, CurrentVisibilityState are Object.assign'd — use mock.calls to match
    const calls = (svc.setCharacteristic as ReturnType<typeof vi.fn>).mock.calls;
    const isConfiguredCall = calls.find((c: unknown[]) => String(c[0]) === 'IsConfigured');
    expect(isConfiguredCall).toBeDefined();
    expect(isConfiguredCall![1]).toBe(1); // CONFIGURED
    const inputSourceTypeCall = calls.find((c: unknown[]) => String(c[0]) === 'InputSourceType');
    expect(inputSourceTypeCall).toBeDefined();
    expect(inputSourceTypeCall![1]).toBe(2); // OTHER
    const visCall = calls.find((c: unknown[]) => String(c[0]) === 'CurrentVisibilityState');
    expect(visCall).toBeDefined();
    expect(visCall![1]).toBe(0); // SHOWN
  });

  // QA #4: InputSource ConfiguredName from alias map
  it('QA4: alias from config.inputs overrides processor name', () => {
    const { accessory, client } = buildZone2Accessory(undefined, { '6': 'Patio Music' });
    simulateInputList(client, [
      { id: 6, name: 'Z2-RCA1', zone2AudioInId: 18 },
    ]);
    const svc = accessory._inputSourceServices.get('zone2-input-6')!;
    expect(svc.setCharacteristic).toHaveBeenCalledWith('ConfiguredName', 'Patio Music');
  });

  // QA #12: No Zone 2-capable inputs — only Follow Main
  it('QA12: no Zone 2-capable inputs → no additional InputSources created', () => {
    const { accessory, client } = buildZone2Accessory();
    simulateInputList(client, [
      { id: 1, name: 'TV', zone2AudioInId: 0 },
      { id: 2, name: 'Roon', zone2AudioInId: 0 },
    ]);
    // Only 'zone2-input-0' (Follow Main) should exist
    expect(accessory._inputSourceServices.has('zone2-input-1')).toBe(false);
    expect(accessory._inputSourceServices.has('zone2-input-2')).toBe(false);
  });

  // QA #25: Multiple Zone 2-capable inputs registered
  it('QA25: multiple Zone 2-capable inputs register correctly', () => {
    const { accessory, client } = buildZone2Accessory();
    simulateInputList(client, [
      { id: 6, name: 'Z2-RCA1', zone2AudioInId: 18 },
      { id: 7, name: 'Z2-RCA2', zone2AudioInId: 19 },
      { id: 8, name: 'Z2-Optical', zone2AudioInId: 20 },
    ]);
    expect(accessory._inputSourceServices.has('zone2-input-6')).toBe(true);
    expect(accessory._inputSourceServices.has('zone2-input-7')).toBe(true);
    expect(accessory._inputSourceServices.has('zone2-input-8')).toBe(true);
  });

  // QA #27: Idempotent InputSource re-registration
  it('QA27: same inputList twice → no duplicate InputSources', () => {
    const { accessory, client } = buildZone2Accessory();
    const inputs = [{ id: 6, name: 'Z2-RCA1', zone2AudioInId: 18 }];
    simulateInputList(client, inputs);
    simulateInputList(client, inputs);
    // addService for zone2-input-6 must be called exactly once (idempotent getService || addService)
    const zone2Input6Calls = (accessory.addService as ReturnType<typeof vi.fn>).mock.calls
      .filter((c: unknown[]) => String(c[2]) === 'zone2-input-6');
    expect(zone2Input6Calls).toHaveLength(1);
    const svc = accessory._inputSourceServices.get('zone2-input-6')!;
    expect(svc).toBeDefined();
    expect(svc.setCharacteristic).toHaveBeenCalledWith('ConfiguredName', 'Z2-RCA1');
  });

  // QA #18: Input name changes on re-broadcast
  it('QA18: name change on re-broadcast updates ConfiguredName', () => {
    const { accessory, client } = buildZone2Accessory();
    simulateInputList(client, [{ id: 6, name: 'Z2-RCA1', zone2AudioInId: 18 }]);
    simulateInputList(client, [{ id: 6, name: 'Patio In', zone2AudioInId: 18 }]);
    const svc = accessory._inputSourceServices.get('zone2-input-6')!;
    const calls = (svc.setCharacteristic as ReturnType<typeof vi.fn>).mock.calls;
    const nameUpdates = calls.filter((c: unknown[]) => c[0] === 'ConfiguredName');
    expect(nameUpdates[nameUpdates.length - 1][1]).toBe('Patio In');
  });

  // QA #28: Alias overrides processor name on re-broadcast
  it('QA28: alias always overrides processor name, even when processor name changes', () => {
    const { accessory, client } = buildZone2Accessory(undefined, { '6': 'Patio Music' });
    simulateInputList(client, [{ id: 6, name: 'Z2-RCA1', zone2AudioInId: 18 }]);
    simulateInputList(client, [{ id: 6, name: 'Renamed-RCA', zone2AudioInId: 18 }]);
    const svc = accessory._inputSourceServices.get('zone2-input-6')!;
    const calls = (svc.setCharacteristic as ReturnType<typeof vi.fn>).mock.calls;
    const nameUpdates = calls.filter((c: unknown[]) => c[0] === 'ConfiguredName');
    // Both should be 'Patio Music' (alias wins)
    expect(nameUpdates[0][1]).toBe('Patio Music');
    expect(nameUpdates[1][1]).toBe('Patio Music');
  });

  // InputSource linked to TV service
  it('Zone 2 InputSources are linked to tvService', () => {
    const { accessory, client } = buildZone2Accessory();
    simulateInputList(client, [{ id: 6, name: 'Z2-RCA1', zone2AudioInId: 18 }]);
    // addLinkedService called for Follow Main + zone2-input-6
    expect(accessory._tvService.addLinkedService).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ActiveIdentifier onSet — source selection commands (QA #5, #6, #26)
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioZone2Accessory — ActiveIdentifier onSet (Story 5.2)', () => {
  // QA #5: Select Follow Main sends useZone2=0
  it('QA5: ActiveIdentifier=0 sends useZone2=[13, 0], no inputZone2 sent', () => {
    const { accessory, client } = buildZone2Accessory();
    const aiChar = accessory._tvService._getChar('ActiveIdentifier')!;
    aiChar._triggerSet(0);
    expect(client.setZoneUseZone2).toHaveBeenCalledWith(13, false);
    expect(client.setInputZone2).not.toHaveBeenCalled();
  });

  // QA #6: Select independent source sends useZone2=1 + inputZone2
  it('QA6: ActiveIdentifier=6 sends useZone2=[13, 1] + inputZone2=[6]', () => {
    const { accessory, client } = buildZone2Accessory();
    const aiChar = accessory._tvService._getChar('ActiveIdentifier')!;
    aiChar._triggerSet(6);
    expect(client.setZoneUseZone2).toHaveBeenCalledWith(13, true);
    expect(client.setInputZone2).toHaveBeenCalledWith(6);
  });

  // QA #26: Independent source command ordering
  it('QA26: useZone2 called BEFORE inputZone2 (ordering matters)', () => {
    const { accessory, client } = buildZone2Accessory();
    const callOrder: string[] = [];
    (client.setZoneUseZone2 as ReturnType<typeof vi.fn>).mockImplementation(() => { callOrder.push('useZone2'); });
    (client.setInputZone2 as ReturnType<typeof vi.fn>).mockImplementation(() => { callOrder.push('inputZone2'); });
    const aiChar = accessory._tvService._getChar('ActiveIdentifier')!;
    aiChar._triggerSet(6);
    expect(callOrder).toEqual(['useZone2', 'inputZone2']);
  });

  // QA #21: ActiveIdentifier onSet while disconnected
  it('QA21: ActiveIdentifier onSet while disconnected throws HapStatusError', () => {
    const { accessory, client } = buildZone2Accessory();
    client._emit('disconnected');
    const aiChar = accessory._tvService._getChar('ActiveIdentifier')!;
    expect(() => aiChar._triggerSet(6)).toThrow(MockHapStatusError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ActiveIdentifier onGet (QA #19, #20)
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioZone2Accessory — ActiveIdentifier onGet (Story 5.2)', () => {
  // QA #19: Follow Main mode
  it('QA19: useZone2Source=false → onGet returns 0', () => {
    const { accessory } = buildZone2Accessory();
    // useZone2Source defaults to false
    const aiChar = accessory._tvService._getChar('ActiveIdentifier')!;
    expect(aiChar._triggerGet()).toBe(0);
  });

  // QA #20: Independent mode
  it('QA20: useZone2Source=true, inputZone2=6 → onGet returns 6', () => {
    const { accessory, client } = buildZone2Accessory();
    // Register zone2 input so it's in the set
    simulateInputList(client, [{ id: 6, name: 'Z2-RCA1', zone2AudioInId: 18 }]);
    // Set state
    client._emit('zoneUpdate', 13, 'useZone2Source', true);
    client._emit('inputZone2', 6);
    const aiChar = accessory._tvService._getChar('ActiveIdentifier')!;
    expect(aiChar._triggerGet()).toBe(6);
  });

  it('useZone2Source=true but inputZone2 not in zone2 set → onGet returns 0', () => {
    const { accessory, client } = buildZone2Accessory();
    client._emit('zoneUpdate', 13, 'useZone2Source', true);
    client._emit('inputZone2', 99); // not registered
    const aiChar = accessory._tvService._getChar('ActiveIdentifier')!;
    expect(aiChar._triggerGet()).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// useZone2Source broadcast handling (QA #7, #8, #13, #14)
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioZone2Accessory — useZone2Source broadcast (Story 5.2)', () => {
  // QA #7: External useZone2=false pushes ActiveIdentifier=0
  it('QA7: useZone2Source=false → ActiveIdentifier pushed to 0', () => {
    const { accessory, client } = buildZone2Accessory();
    client._emit('zoneUpdate', 13, 'useZone2Source', false);
    const aiUpdate = accessory._tvService._getChar('ActiveIdentifier')!._getUpdateValueMock();
    expect(aiUpdate).toHaveBeenCalledWith(0, { source: 'stormaudio' });
  });

  // QA #8: External useZone2=true pushes ActiveIdentifier to inputZone2
  it('QA8: useZone2Source=true with valid inputZone2 → ActiveIdentifier pushed to inputZone2', () => {
    const { accessory, client } = buildZone2Accessory();
    simulateInputList(client, [{ id: 6, name: 'Z2-RCA1', zone2AudioInId: 18 }]);
    client._emit('inputZone2', 6);
    client._emit('zoneUpdate', 13, 'useZone2Source', true);
    const aiUpdate = accessory._tvService._getChar('ActiveIdentifier')!._getUpdateValueMock();
    expect(aiUpdate).toHaveBeenCalledWith(6, { source: 'stormaudio' });
  });

  // QA #13: useZone2=true with inputZone2=0 (unrecognized) → Follow Main fallback
  it('QA13: useZone2Source=true with inputZone2=0 → ActiveIdentifier pushed to 0 (fallback)', () => {
    const { accessory, client } = buildZone2Accessory();
    // inputZone2 defaults to 0, not in zone2 set
    client._emit('zoneUpdate', 13, 'useZone2Source', true);
    const aiUpdate = accessory._tvService._getChar('ActiveIdentifier')!._getUpdateValueMock();
    expect(aiUpdate).toHaveBeenCalledWith(0, { source: 'stormaudio' });
  });

  // QA #14: useZone2=true with inputZone2 not in zone2 set → Follow Main fallback
  it('QA14: useZone2Source=true with inputZone2=99 (not in set) → ActiveIdentifier=0', () => {
    const { accessory, client } = buildZone2Accessory();
    client._emit('inputZone2', 99);
    client._emit('zoneUpdate', 13, 'useZone2Source', true);
    const aiUpdate = accessory._tvService._getChar('ActiveIdentifier')!._getUpdateValueMock();
    expect(aiUpdate).toHaveBeenCalledWith(0, { source: 'stormaudio' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// inputZone2 broadcast handling (QA #9, #10)
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioZone2Accessory — inputZone2 broadcast (Story 5.2)', () => {
  // QA #9: inputZone2 while independent → HomeKit push
  it('QA9: inputZone2 broadcast while useZone2Source=true → ActiveIdentifier pushed', () => {
    const { accessory, client } = buildZone2Accessory();
    client._emit('zoneUpdate', 13, 'useZone2Source', true);
    client._emit('inputZone2', 7);
    const aiUpdate = accessory._tvService._getChar('ActiveIdentifier')!._getUpdateValueMock();
    expect(aiUpdate).toHaveBeenCalledWith(7, { source: 'stormaudio' });
  });

  // QA #10: inputZone2 while Follow Main → state only, no push
  it('QA10: inputZone2 broadcast while useZone2Source=false → state updated, no HomeKit push', () => {
    const { accessory, client } = buildZone2Accessory();
    // useZone2Source=false by default
    const aiUpdate = accessory._tvService._getChar('ActiveIdentifier')!._getUpdateValueMock();
    aiUpdate.mockClear();
    client._emit('inputZone2', 7);
    // No ActiveIdentifier push should happen
    expect(aiUpdate).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Input capability changes (QA #15, #16, #17)
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioZone2Accessory — input capability changes (Story 5.2)', () => {
  // QA #15: Input loses Zone 2 capability → HIDDEN
  it('QA15: input loses zone2 capability → CurrentVisibilityState=HIDDEN', () => {
    const { accessory, client } = buildZone2Accessory();
    simulateInputList(client, [{ id: 6, name: 'Z2-RCA1', zone2AudioInId: 18 }]);
    simulateInputList(client, [{ id: 6, name: 'Z2-RCA1', zone2AudioInId: 0 }]);
    const svc = accessory._inputSourceServices.get('zone2-input-6')!;
    const calls = (svc.setCharacteristic as ReturnType<typeof vi.fn>).mock.calls;
    const visibilityChanges = calls.filter((c: unknown[]) => String(c[0]) === 'CurrentVisibilityState');
    expect(visibilityChanges[visibilityChanges.length - 1][1]).toBe(1); // HIDDEN
  });

  // QA #16: Input loses Zone 2 capability while active → revert to Follow Main
  it('QA16: active input loses zone2 capability → ActiveIdentifier=0 + useZone2=false sent', () => {
    const { accessory, client } = buildZone2Accessory();
    simulateInputList(client, [{ id: 6, name: 'Z2-RCA1', zone2AudioInId: 18 }]);
    // Set as active: useZone2Source=true, inputZone2=6
    client._emit('zoneUpdate', 13, 'useZone2Source', true);
    client._emit('inputZone2', 6);
    // Clear mocks to isolate
    (client.setZoneUseZone2 as ReturnType<typeof vi.fn>).mockClear();
    const aiUpdate = accessory._tvService._getChar('ActiveIdentifier')!._getUpdateValueMock();
    aiUpdate.mockClear();
    // Input 6 loses capability
    simulateInputList(client, [{ id: 6, name: 'Z2-RCA1', zone2AudioInId: 0 }]);
    expect(aiUpdate).toHaveBeenCalledWith(0, { source: 'stormaudio' });
    expect(client.setZoneUseZone2).toHaveBeenCalledWith(13, false);
  });

  // QA #17: Input gains Zone 2 capability → new InputSource with SHOWN
  it('QA17: input gains zone2 capability → new InputSource created with SHOWN', () => {
    const { accessory, client } = buildZone2Accessory();
    simulateInputList(client, [{ id: 3, name: 'Optical', zone2AudioInId: 0 }]);
    expect(accessory._inputSourceServices.has('zone2-input-3')).toBe(false);
    simulateInputList(client, [{ id: 3, name: 'Optical', zone2AudioInId: 5 }]);
    const svc = accessory._inputSourceServices.get('zone2-input-3')!;
    expect(svc).toBeDefined();
    const calls = (svc.setCharacteristic as ReturnType<typeof vi.fn>).mock.calls;
    const visCall = calls.find((c: unknown[]) => String(c[0]) === 'CurrentVisibilityState');
    expect(visCall).toBeDefined();
    expect(visCall![1]).toBe(0); // SHOWN
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Processor wake source state restoration (QA #22, #23, #24, #29)
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioZone2Accessory — processor wake source state (Story 5.2)', () => {
  // QA #22: Processor wake restores independent source state
  it('QA22: Sleep → Active → useZone2Source=true + inputZone2=6 → ActiveIdentifier=6, no commands', () => {
    const { accessory, client } = buildZone2Accessory();
    simulateInputList(client, [{ id: 6, name: 'Z2-RCA1', zone2AudioInId: 18 }]);
    client._emit('processorState', ProcessorState.Sleep);
    client._emit('processorState', ProcessorState.Active);
    // Clear mocks after state transitions
    (client.setZoneUseZone2 as ReturnType<typeof vi.fn>).mockClear();
    (client.setInputZone2 as ReturnType<typeof vi.fn>).mockClear();
    const aiUpdate = accessory._tvService._getChar('ActiveIdentifier')!._getUpdateValueMock();
    aiUpdate.mockClear();
    // Simulate state dump broadcasts
    client._emit('zoneUpdate', 13, 'useZone2Source', true);
    client._emit('inputZone2', 6);
    expect(aiUpdate).toHaveBeenCalledWith(6, { source: 'stormaudio' });
    expect(client.setZoneUseZone2).not.toHaveBeenCalled();
    expect(client.setInputZone2).not.toHaveBeenCalled();
  });

  // QA #23: Processor wake restores Follow Main state
  it('QA23: Sleep → Active → useZone2Source=false → ActiveIdentifier=0, no commands', () => {
    const { accessory, client } = buildZone2Accessory();
    client._emit('processorState', ProcessorState.Sleep);
    client._emit('processorState', ProcessorState.Active);
    (client.setZoneUseZone2 as ReturnType<typeof vi.fn>).mockClear();
    const aiUpdate = accessory._tvService._getChar('ActiveIdentifier')!._getUpdateValueMock();
    aiUpdate.mockClear();
    client._emit('zoneUpdate', 13, 'useZone2Source', false);
    expect(aiUpdate).toHaveBeenCalledWith(0, { source: 'stormaudio' });
    expect(client.setZoneUseZone2).not.toHaveBeenCalled();
  });

  // QA #24: Initial inputZone2 from client state
  it('QA24: client.getInputZone2()=6 before accessory → useZone2=true pushes 6', () => {
    const platform = createMockPlatform();
    const accessory = createMockAccessory();
    const client = createMockClient();
    client._setInputZone2State(6);
    const zone2Config: Zone2Config = { zoneId: 13, name: 'Patio', volumeFloor: -80, volumeCeiling: 0, volumeControl: 'none' };
    new StormAudioZone2Accessory(platform, accessory as never, client as never, zone2Config);
    // Register inputs so 6 is in the set
    simulateInputList(client, [{ id: 6, name: 'Z2-RCA1', zone2AudioInId: 18 }]);
    client._emit('zoneUpdate', 13, 'useZone2Source', true);
    const aiUpdate = accessory._tvService._getChar('ActiveIdentifier')!._getUpdateValueMock();
    expect(aiUpdate).toHaveBeenCalledWith(6, { source: 'stormaudio' });
  });

  // QA #29: Processor wake with useZone2=true but inputZone2=0 → Follow Main fallback
  it('QA29: wake with useZone2=true, inputZone2=0 → ActiveIdentifier=0, no commands', () => {
    const { accessory, client } = buildZone2Accessory();
    client._emit('processorState', ProcessorState.Sleep);
    client._emit('processorState', ProcessorState.Active);
    (client.setZoneUseZone2 as ReturnType<typeof vi.fn>).mockClear();
    (client.setInputZone2 as ReturnType<typeof vi.fn>).mockClear();
    const aiUpdate = accessory._tvService._getChar('ActiveIdentifier')!._getUpdateValueMock();
    aiUpdate.mockClear();
    // inputZone2=0 by default, not in zone2 set
    client._emit('zoneUpdate', 13, 'useZone2Source', true);
    expect(aiUpdate).toHaveBeenCalledWith(0, { source: 'stormaudio' }); // Follow Main fallback
    expect(client.setZoneUseZone2).not.toHaveBeenCalled();
    expect(client.setInputZone2).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// End-to-end lifecycle (QA #30)
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioZone2Accessory — end-to-end lifecycle (Story 5.2)', () => {
  // QA #30: Full source selection lifecycle
  it('QA30: create → inputList → select source → external follow main → inputZone2 → external independent', () => {
    const { accessory, client } = buildZone2Accessory();

    // Step 1: Register 2 Zone 2-capable inputs
    simulateInputList(client, [
      { id: 6, name: 'Z2-RCA1', zone2AudioInId: 18 },
      { id: 7, name: 'Z2-RCA2', zone2AudioInId: 19 },
    ]);
    expect(accessory._inputSourceServices.has('zone2-input-6')).toBe(true);
    expect(accessory._inputSourceServices.has('zone2-input-7')).toBe(true);

    // Step 2: User selects independent source
    const aiChar = accessory._tvService._getChar('ActiveIdentifier')!;
    aiChar._triggerSet(6);
    expect(client.setZoneUseZone2).toHaveBeenCalledWith(13, true);
    expect(client.setInputZone2).toHaveBeenCalledWith(6);

    // Step 3: External switch to Follow Main
    const aiUpdate = aiChar._getUpdateValueMock();
    aiUpdate.mockClear();
    client._emit('zoneUpdate', 13, 'useZone2Source', false);
    expect(aiUpdate).toHaveBeenCalledWith(0, { source: 'stormaudio' });

    // Step 4: inputZone2 broadcast while Follow Main → state only, no push
    aiUpdate.mockClear();
    client._emit('inputZone2', 7);
    expect(aiUpdate).not.toHaveBeenCalled();

    // Step 5: External switch to independent → pushes to tracked inputZone2=7
    aiUpdate.mockClear();
    client._emit('zoneUpdate', 13, 'useZone2Source', true);
    expect(aiUpdate).toHaveBeenCalledWith(7, { source: 'stormaudio' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Listener cleanup for Story 5.2 listeners
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioZone2Accessory — Story 5.2 listener cleanup', () => {
  it('constructor registers 1 inputList listener', () => {
    const client = createMockClient();
    const baseline = client.listenerCount('inputList');
    const platform = createMockPlatform();
    const accessory = createMockAccessory();
    const zone2Config: Zone2Config = { zoneId: 13, name: 'Patio', volumeFloor: -80, volumeCeiling: 0, volumeControl: 'none' };
    new StormAudioZone2Accessory(platform, accessory as never, client as never, zone2Config);
    expect(client.listenerCount('inputList')).toBe(baseline + 1);
  });

  it('constructor registers 1 inputZone2 listener', () => {
    const client = createMockClient();
    const baseline = client.listenerCount('inputZone2');
    const platform = createMockPlatform();
    const accessory = createMockAccessory();
    const zone2Config: Zone2Config = { zoneId: 13, name: 'Patio', volumeFloor: -80, volumeCeiling: 0, volumeControl: 'none' };
    new StormAudioZone2Accessory(platform, accessory as never, client as never, zone2Config);
    expect(client.listenerCount('inputZone2')).toBe(baseline + 1);
  });

  it('existing Story 5.1 listener counts preserved (zoneUpdate, processorState, disconnected, connected)', () => {
    const client = createMockClient();
    const baselines = {
      zoneUpdate: client.listenerCount('zoneUpdate'),
      processorState: client.listenerCount('processorState'),
      disconnected: client.listenerCount('disconnected'),
      connected: client.listenerCount('connected'),
    };
    const platform = createMockPlatform();
    const accessory = createMockAccessory();
    const zone2Config: Zone2Config = { zoneId: 13, name: 'Patio', volumeFloor: -80, volumeCeiling: 0, volumeControl: 'none' };
    new StormAudioZone2Accessory(platform, accessory as never, client as never, zone2Config);
    expect(client.listenerCount('zoneUpdate')).toBe(baselines.zoneUpdate + 1);
    expect(client.listenerCount('processorState')).toBe(baselines.processorState + 1);
    expect(client.listenerCount('disconnected')).toBe(baselines.disconnected + 1);
    expect(client.listenerCount('connected')).toBe(baselines.connected + 1);
  });
});
