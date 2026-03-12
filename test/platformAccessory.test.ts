import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

import type { StormAudioPlatform } from '../src/platform';
import { StormAudioAccessory, dBToPercentage, percentageToDB } from '../src/platformAccessory';
import { ProcessorState } from '../src/types';

// --- Mock Homebridge types ---

const ActiveEnum = { ACTIVE: 1, INACTIVE: 0 } as const;

const SleepDiscoveryModeEnum = {
  ALWAYS_DISCOVERABLE: 1,
  NOT_DISCOVERABLE: 0,
} as const;

const CategoriesEnum = { TELEVISION: 31 } as const;

function createMockCharacteristic() {
  let onSetHandler: ((value: unknown) => void | Promise<void>) | null = null;
  let onGetHandler: (() => unknown) | null = null;
  const updateValueFn = vi.fn();

  return {
    onSet: vi.fn((handler: (value: unknown) => void | Promise<void>) => {
      onSetHandler = handler;
      return createMockCharacteristic(); // chaining
    }),
    onGet: vi.fn((handler: () => unknown) => {
      onGetHandler = handler;
      return createMockCharacteristic(); // chaining
    }),
    updateValue: updateValueFn,
    // Test helpers
    _triggerSet: (value: unknown) => onSetHandler?.(value),
    _triggerGet: () => onGetHandler?.(),
    _getUpdateValueMock: () => updateValueFn,
  };
}

function createMockService() {
  const characteristics = new Map<string, ReturnType<typeof createMockCharacteristic>>();

  // Normalize keys to primitive strings (Object.assign('Active', {...}) creates a String wrapper)
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
    _getCharacteristicMock: (name: string) => characteristics.get(key(name)),
    _characteristics: characteristics,
  };
}

function createMockClient() {
  const emitter = new EventEmitter();
  return {
    on: emitter.on.bind(emitter),
    setPower: vi.fn(),
    setVolume: vi.fn(),
    setInput: vi.fn(),
    setMute: vi.fn(),
    volumeUp: vi.fn(),
    volumeDown: vi.fn(),
    getVolume: vi.fn().mockReturnValue(-40),
    getMute: vi.fn().mockReturnValue(false),
    disconnect: vi.fn(),
    connect: vi.fn(),
    getProcessorState: vi.fn().mockReturnValue(ProcessorState.Sleep),
    ensureActive: vi.fn().mockResolvedValue(true),
    _emit: emitter.emit.bind(emitter),
    _emitter: emitter,
  };
}

interface MockPlatformConfig {
  volumeControl?: 'fan' | 'lightbulb' | 'none';
  volumeFloor?: number;
  volumeCeiling?: number;
  inputs?: Record<string, string>;
}

function createMockPlatform(nameOverride?: string, configOverride?: MockPlatformConfig) {
  const name = nameOverride ?? 'StormAudio';
  const volumeControl = configOverride?.volumeControl ?? 'fan';
  const volumeFloor = configOverride?.volumeFloor ?? -100;
  const volumeCeiling = configOverride?.volumeCeiling ?? -20;
  const inputs = configOverride?.inputs ?? {};

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
    InputSourceType: Object.assign('InputSourceType', { HDMI: 3 }),
    CurrentVisibilityState: Object.assign('CurrentVisibilityState', { SHOWN: 0, HIDDEN: 1 }),
  };

  const ServiceMock = {
    Television: 'Television',
    TelevisionSpeaker: 'TelevisionSpeaker',
    Fan: 'Fan',
    Lightbulb: 'Lightbulb',
    InputSource: 'InputSource',
  };

  return {
    Service: ServiceMock,
    Characteristic: CharacteristicMock,
    config: { name },
    validatedConfig: { name, volumeControl, volumeFloor, volumeCeiling, inputs },
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
        Categories: CategoriesEnum,
        uuid: { generate: vi.fn().mockReturnValue('mock-uuid') },
      },
      platformAccessory: vi.fn(),
      publishExternalAccessories: vi.fn(),
      on: vi.fn(),
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
    _getInputSource: (id: number) => inputSourceServices.get(`input-${id}`),
    _inputSourceServices: inputSourceServices,
    category: undefined as number | undefined,
    displayName: 'StormAudio',
  };
}

describe('StormAudioAccessory — Television service setup (Task 2)', () => {
  let platform: StormAudioPlatform;
  let accessory: ReturnType<typeof createMockAccessory>;
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    platform = createMockPlatform();
    accessory = createMockAccessory();
    client = createMockClient();
  });

  it('gets or adds Television service on the accessory', () => {
    new StormAudioAccessory(platform, accessory as never, client as never);
    expect(accessory.getService).toHaveBeenCalledWith('Television');
  });

  it('sets Name characteristic to configured name', () => {
    new StormAudioAccessory(platform, accessory as never, client as never);
    expect(accessory._tvService.setCharacteristic).toHaveBeenCalledWith('Name', 'StormAudio');
  });

  it('sets ConfiguredName characteristic to configured name', () => {
    new StormAudioAccessory(platform, accessory as never, client as never);
    expect(accessory._tvService.setCharacteristic).toHaveBeenCalledWith('ConfiguredName', 'StormAudio');
  });

  it('sets SleepDiscoveryMode to ALWAYS_DISCOVERABLE', () => {
    new StormAudioAccessory(platform, accessory as never, client as never);
    const calls = accessory._tvService.setCharacteristic.mock.calls;
    const sdmCall = calls.find((c: unknown[]) => String(c[0]) === 'SleepDiscoveryMode');
    expect(sdmCall).toBeDefined();
    expect(sdmCall![1]).toBe(SleepDiscoveryModeEnum.ALWAYS_DISCOVERABLE);
  });

  it('sets ActiveIdentifier to 0', () => {
    new StormAudioAccessory(platform, accessory as never, client as never);
    expect(accessory._tvService.setCharacteristic).toHaveBeenCalledWith('ActiveIdentifier', 0);
  });

  it('adds Television service if not already present', () => {
    accessory.getService.mockReturnValue(null);
    const tvService = createMockService();
    accessory.addService.mockReturnValue(tvService);
    new StormAudioAccessory(platform, accessory as never, client as never);
    expect(accessory.addService).toHaveBeenCalledWith('Television', 'StormAudio');
  });

  it('uses custom name from config', () => {
    platform = createMockPlatform('Theater');
    accessory = createMockAccessory();
    client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
    expect(accessory._tvService.setCharacteristic).toHaveBeenCalledWith('Name', 'Theater');
    expect(accessory._tvService.setCharacteristic).toHaveBeenCalledWith('ConfiguredName', 'Theater');
  });

  it('uses default name StormAudio when validatedConfig.name falls back to default', () => {
    // Simulate platform where config.name was omitted — validateConfig resolves to 'StormAudio'
    platform = createMockPlatform('StormAudio');
    accessory = createMockAccessory();
    client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
    expect(accessory._tvService.setCharacteristic).toHaveBeenCalledWith('Name', 'StormAudio');
    expect(accessory._tvService.setCharacteristic).toHaveBeenCalledWith('ConfiguredName', 'StormAudio');
  });
});

describe('StormAudioAccessory — power on/off commands (Task 3 / Task 5)', () => {
  let platform: StormAudioPlatform;
  let accessory: ReturnType<typeof createMockAccessory>;
  let client: ReturnType<typeof createMockClient>;
  let activeChar: ReturnType<typeof createMockCharacteristic>;

  beforeEach(() => {
    platform = createMockPlatform();
    accessory = createMockAccessory();
    client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
    activeChar = accessory._tvService._getCharacteristicMock('Active')!;
  });

  it('onSet(Active.ACTIVE) calls client.ensureActive() via requiresActive()', () => {
    activeChar._triggerSet(ActiveEnum.ACTIVE);
    expect(client.ensureActive).toHaveBeenCalled();
  });

  it('onSet(Active.ACTIVE) does NOT call client.setPower(true)', () => {
    activeChar._triggerSet(ActiveEnum.ACTIVE);
    expect(client.setPower).not.toHaveBeenCalledWith(true);
  });

  it('onSet(Active.ACTIVE) performs optimistic update to ACTIVE before awaiting', () => {
    activeChar._triggerSet(ActiveEnum.ACTIVE);
    expect(activeChar._getUpdateValueMock()).toHaveBeenCalledWith(ActiveEnum.ACTIVE, { source: 'stormaudio' });
  });

  it('onSet(Active.ACTIVE) logs warn when ensureActive returns false', async () => {
    client.ensureActive.mockResolvedValue(false);
    activeChar._triggerSet(ActiveEnum.ACTIVE);
    await new Promise(r => setTimeout(r, 0)); // flush fire-and-forget promise chain
    expect(platform.log.warn).toHaveBeenCalledWith('[State] Power-on timed out — processor did not reach active state');
  });

  it('onSet(Active.ACTIVE) logs debug "Command dropped" when ensureActive returns false', async () => {
    client.ensureActive.mockResolvedValue(false);
    activeChar._triggerSet(ActiveEnum.ACTIVE);
    await new Promise(r => setTimeout(r, 0)); // flush fire-and-forget promise chain
    expect(platform.log.debug).toHaveBeenCalledWith('[State] Command dropped — processor did not reach active state');
  });

  it('onSet(Active.ACTIVE) skips ensureActive() when processor is already Active', () => {
    client.getProcessorState.mockReturnValue(ProcessorState.Active);
    activeChar._triggerSet(ActiveEnum.ACTIVE);
    expect(client.ensureActive).not.toHaveBeenCalled();
  });

  it('onSet(Active.INACTIVE) calls client.setPower(false)', () => {
    activeChar._triggerSet(ActiveEnum.INACTIVE);
    expect(client.setPower).toHaveBeenCalledWith(false);
  });

  it('onSet with unexpected value (not ACTIVE) calls setPower(false)', () => {
    // Any value other than ACTIVE(1) is treated as inactive — documents edge case behavior
    activeChar._triggerSet(2);
    expect(client.setPower).toHaveBeenCalledWith(false);
  });
});

describe('StormAudioAccessory — onGet handler (Task 4)', () => {
  it('returns Active.INACTIVE when state.power is false (default)', () => {
    const platform = createMockPlatform();
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
    const activeChar = accessory._tvService._getCharacteristicMock('Active')!;
    const result = activeChar._triggerGet();
    expect(result).toBe(ActiveEnum.INACTIVE);
  });

  it('returns Active.ACTIVE when state.power is true', () => {
    const platform = createMockPlatform();
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
    // Simulate power event to set state.power = true
    client._emit('power', true);
    const activeChar = accessory._tvService._getCharacteristicMock('Active')!;
    const result = activeChar._triggerGet();
    expect(result).toBe(ActiveEnum.ACTIVE);
  });
});

describe('StormAudioAccessory — power state updates from StormAudio (Task 5)', () => {
  let platform: StormAudioPlatform;
  let accessory: ReturnType<typeof createMockAccessory>;
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    platform = createMockPlatform();
    accessory = createMockAccessory();
    client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
  });

  it('power event with true updates Active characteristic to ACTIVE with EXTERNAL_CONTEXT', () => {
    client._emit('power', true);
    const activeChar = accessory._tvService._getCharacteristicMock('Active')!;
    expect(activeChar._getUpdateValueMock()).toHaveBeenCalledWith(ActiveEnum.ACTIVE, { source: 'stormaudio' });
  });

  it('power event with false updates Active characteristic to INACTIVE with EXTERNAL_CONTEXT', () => {
    client._emit('power', false);
    const activeChar = accessory._tvService._getCharacteristicMock('Active')!;
    expect(activeChar._getUpdateValueMock()).toHaveBeenCalledWith(ActiveEnum.INACTIVE, { source: 'stormaudio' });
  });

  it('power event updates internal state cache (verified via onGet)', () => {
    client._emit('power', true);
    const activeChar = accessory._tvService._getCharacteristicMock('Active')!;
    expect(activeChar._triggerGet()).toBe(ActiveEnum.ACTIVE);

    client._emit('power', false);
    expect(activeChar._triggerGet()).toBe(ActiveEnum.INACTIVE);
  });

  it('logs power state at debug level', () => {
    client._emit('power', true);
    expect(platform.log.debug).toHaveBeenCalledWith('[HomeKit] Power state updated: ON');
    client._emit('power', false);
    expect(platform.log.debug).toHaveBeenCalledWith('[HomeKit] Power state updated: OFF');
  });
});

describe('StormAudioAccessory — processorState event subscription (Task 6)', () => {
  let platform: StormAudioPlatform;
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    platform = createMockPlatform();
    const accessory = createMockAccessory();
    client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
  });

  it('processorState(Active) logs [HomeKit] Processor is active — ready for commands', () => {
    client._emit('processorState', ProcessorState.Active);
    expect(platform.log.debug).toHaveBeenCalledWith('[HomeKit] Processor is active — ready for commands');
  });

  it('processorState(Sleep) logs [HomeKit] Processor in sleep mode', () => {
    client._emit('processorState', ProcessorState.Sleep);
    expect(platform.log.debug).toHaveBeenCalledWith('[HomeKit] Processor in sleep mode');
  });

  it('processorState(Initializing) does not log any processor-related message', () => {
    client._emit('processorState', ProcessorState.Initializing);
    expect(platform.log.debug).not.toHaveBeenCalledWith(
      expect.stringContaining('[HomeKit] Processor'),
    );
  });
});

describe('StormAudioAccessory — zero net imports (Task 1)', () => {
  it('platformAccessory.ts does not import from net module', () => {
    const filePath = path.resolve(__dirname, '../src/platformAccessory.ts');
    const content = fs.readFileSync(filePath, 'utf-8');
    // Check for any form of net import
    expect(content).not.toMatch(/from\s+['"]net['"]/);
    expect(content).not.toMatch(/require\s*\(\s*['"]net['"]\s*\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Story 2.1 tests
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioAccessory — TelevisionSpeaker service setup (Task 4)', () => {
  let platform: StormAudioPlatform;
  let accessory: ReturnType<typeof createMockAccessory>;
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    platform = createMockPlatform();
    accessory = createMockAccessory();
    client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
  });

  it('creates TelevisionSpeaker service via addService when not present', () => {
    expect(accessory.addService).toHaveBeenCalledWith('TelevisionSpeaker', 'StormAudio Speaker', 'speaker');
  });

  it('reuses existing TelevisionSpeaker service via getService when present', () => {
    const platform2 = createMockPlatform();
    const accessory2 = createMockAccessory();
    // Make getService return speakerService for TelevisionSpeaker too
    accessory2.getService.mockImplementation((type: unknown) =>
      String(type) === 'Television' ? accessory2._tvService : accessory2._speakerService,
    );
    const client2 = createMockClient();
    new StormAudioAccessory(platform2, accessory2 as never, client2 as never);
    expect(accessory2.addService).not.toHaveBeenCalledWith(
      'TelevisionSpeaker',
      expect.anything(),
      expect.anything(),
    );
  });

  it('sets Active characteristic to ACTIVE on TelevisionSpeaker', () => {
    const calls = accessory._speakerService.setCharacteristic.mock.calls;
    const activeCall = calls.find((c: unknown[]) => String(c[0]) === 'Active');
    expect(activeCall).toBeDefined();
    expect(activeCall![1]).toBe(1); // ActiveEnum.ACTIVE
  });

  it('sets VolumeControlType characteristic to ABSOLUTE on TelevisionSpeaker', () => {
    const calls = accessory._speakerService.setCharacteristic.mock.calls;
    const vtcCall = calls.find((c: unknown[]) => String(c[0]) === 'VolumeControlType');
    expect(vtcCall).toBeDefined();
    expect(vtcCall![1]).toBe(3); // VolumeControlType.ABSOLUTE
  });

  it('links TelevisionSpeaker to Television via addLinkedService', () => {
    expect(accessory._tvService.addLinkedService).toHaveBeenCalledWith(accessory._speakerService);
  });

  it('exposes VolumeSelector characteristic on TelevisionSpeaker', () => {
    expect(accessory._speakerService._getCharacteristicMock('VolumeSelector')).toBeDefined();
  });

  it('exposes Mute characteristic on TelevisionSpeaker', () => {
    expect(accessory._speakerService._getCharacteristicMock('Mute')).toBeDefined();
  });
});

describe('StormAudioAccessory — VolumeSelector handler (Task 5)', () => {
  let platform: StormAudioPlatform;
  let accessory: ReturnType<typeof createMockAccessory>;
  let client: ReturnType<typeof createMockClient>;
  let volumeSelectorChar: ReturnType<typeof createMockCharacteristic>;

  beforeEach(() => {
    platform = createMockPlatform();
    accessory = createMockAccessory();
    client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
    volumeSelectorChar = accessory._speakerService._getCharacteristicMock('VolumeSelector')!;
  });

  it('INCREMENT (0) → client.volumeUp() called when processor is active', async () => {
    client.getProcessorState.mockReturnValue(ProcessorState.Active);
    await volumeSelectorChar._triggerSet(0);
    expect(client.volumeUp).toHaveBeenCalled();
    expect(client.volumeDown).not.toHaveBeenCalled();
  });

  it('DECREMENT (1) → client.volumeDown() called when processor is active', async () => {
    client.getProcessorState.mockReturnValue(ProcessorState.Active);
    await volumeSelectorChar._triggerSet(1);
    expect(client.volumeDown).toHaveBeenCalled();
    expect(client.volumeUp).not.toHaveBeenCalled();
  });

  it('INCREMENT logs [HomeKit] Volume up', async () => {
    client.getProcessorState.mockReturnValue(ProcessorState.Active);
    await volumeSelectorChar._triggerSet(0);
    expect(platform.log.debug).toHaveBeenCalledWith('[HomeKit] Volume up');
  });

  it('DECREMENT logs [HomeKit] Volume down', async () => {
    client.getProcessorState.mockReturnValue(ProcessorState.Active);
    await volumeSelectorChar._triggerSet(1);
    expect(platform.log.debug).toHaveBeenCalledWith('[HomeKit] Volume down');
  });

  it('volumeUp NOT called when requiresActive returns false (sleep + timeout)', async () => {
    client.getProcessorState.mockReturnValue(ProcessorState.Sleep);
    client.ensureActive.mockResolvedValue(false);
    await volumeSelectorChar._triggerSet(0);
    expect(client.volumeUp).not.toHaveBeenCalled();
  });

  it('volumeDown NOT called when requiresActive returns false (sleep + timeout)', async () => {
    client.getProcessorState.mockReturnValue(ProcessorState.Sleep);
    client.ensureActive.mockResolvedValue(false);
    await volumeSelectorChar._triggerSet(1);
    expect(client.volumeDown).not.toHaveBeenCalled();
  });

  it('calls requiresActive() — skips ensureActive when processor is already Active', async () => {
    client.getProcessorState.mockReturnValue(ProcessorState.Active);
    await volumeSelectorChar._triggerSet(0);
    expect(client.ensureActive).not.toHaveBeenCalled();
  });
});

describe('StormAudioAccessory — Mute onSet and onGet handlers (Task 6)', () => {
  let platform: StormAudioPlatform;
  let accessory: ReturnType<typeof createMockAccessory>;
  let client: ReturnType<typeof createMockClient>;
  let muteChar: ReturnType<typeof createMockCharacteristic>;

  beforeEach(() => {
    platform = createMockPlatform();
    accessory = createMockAccessory();
    client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
    muteChar = accessory._speakerService._getCharacteristicMock('Mute')!;
  });

  it('Mute onSet true → client.setMute(true) called when processor is active', async () => {
    client.getProcessorState.mockReturnValue(ProcessorState.Active);
    await muteChar._triggerSet(true);
    expect(client.setMute).toHaveBeenCalledWith(true);
  });

  it('Mute onSet false → client.setMute(false) called when processor is active', async () => {
    client.getProcessorState.mockReturnValue(ProcessorState.Active);
    await muteChar._triggerSet(false);
    expect(client.setMute).toHaveBeenCalledWith(false);
  });

  it('Mute onSet true logs [HomeKit] Mute on', async () => {
    client.getProcessorState.mockReturnValue(ProcessorState.Active);
    await muteChar._triggerSet(true);
    expect(platform.log.debug).toHaveBeenCalledWith('[HomeKit] Mute on');
  });

  it('Mute onSet false logs [HomeKit] Mute off', async () => {
    client.getProcessorState.mockReturnValue(ProcessorState.Active);
    await muteChar._triggerSet(false);
    expect(platform.log.debug).toHaveBeenCalledWith('[HomeKit] Mute off');
  });

  it('setMute NOT called when requiresActive returns false (sleep + timeout)', async () => {
    client.getProcessorState.mockReturnValue(ProcessorState.Sleep);
    client.ensureActive.mockResolvedValue(false);
    await muteChar._triggerSet(true);
    expect(client.setMute).not.toHaveBeenCalled();
  });

  it('Mute onGet returns false by default (cached state)', () => {
    const result = muteChar._triggerGet();
    expect(result).toBe(false);
  });

  it('Mute onGet returns true after mute event updates state', () => {
    client._emit('mute', true);
    const result = muteChar._triggerGet();
    expect(result).toBe(true);
  });

  it('Mute onGet returns false after unmute event updates state', () => {
    client._emit('mute', true);
    client._emit('mute', false);
    const result = muteChar._triggerGet();
    expect(result).toBe(false);
  });
});

describe('StormAudioAccessory — mute event bidirectional sync (Task 7)', () => {
  let platform: StormAudioPlatform;
  let accessory: ReturnType<typeof createMockAccessory>;
  let client: ReturnType<typeof createMockClient>;
  let muteChar: ReturnType<typeof createMockCharacteristic>;

  beforeEach(() => {
    platform = createMockPlatform();
    accessory = createMockAccessory();
    client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
    muteChar = accessory._speakerService._getCharacteristicMock('Mute')!;
  });

  it('mute event(true) updates TelevisionSpeaker Mute characteristic with EXTERNAL_CONTEXT', () => {
    client._emit('mute', true);
    expect(muteChar._getUpdateValueMock()).toHaveBeenCalledWith(true, { source: 'stormaudio' });
  });

  it('mute event(false) updates TelevisionSpeaker Mute characteristic with EXTERNAL_CONTEXT', () => {
    client._emit('mute', false);
    expect(muteChar._getUpdateValueMock()).toHaveBeenCalledWith(false, { source: 'stormaudio' });
  });

  it('mute event(true) logs [HomeKit] Mute state updated: muted', () => {
    client._emit('mute', true);
    expect(platform.log.debug).toHaveBeenCalledWith('[HomeKit] Mute state updated: muted');
  });

  it('mute event(false) logs [HomeKit] Mute state updated: unmuted', () => {
    client._emit('mute', false);
    expect(platform.log.debug).toHaveBeenCalledWith('[HomeKit] Mute state updated: unmuted');
  });

  it('mute event updates internal state (verified via onGet)', () => {
    client._emit('mute', true);
    expect(muteChar._triggerGet()).toBe(true);
    client._emit('mute', false);
    expect(muteChar._triggerGet()).toBe(false);
  });
});

describe('StormAudioAccessory — volume event state tracking (Task 8)', () => {
  let platform: StormAudioPlatform;
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    platform = createMockPlatform();
    const accessory = createMockAccessory();
    client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
  });

  it('volume event updates internal state.volume and logs the level with percentage', () => {
    // dBToPercentage(-45, -100, -20) = round((55/80)*100) = round(68.75) = 69
    client._emit('volume', -45);
    expect(platform.log.debug).toHaveBeenCalledWith('[HomeKit] Volume level: -45dB (69%)');
  });

  it('volume event logs at -55dB with percentage', () => {
    // dBToPercentage(-55, -100, -20) = round((45/80)*100) = round(56.25) = 56
    client._emit('volume', -55);
    expect(platform.log.debug).toHaveBeenCalledWith('[HomeKit] Volume level: -55dB (56%)');
  });

  it('volume event does NOT update Mute or Active characteristics', () => {
    // Volume event only updates Volume and Brightness characteristics, not Mute or Active
    const accessory2 = createMockAccessory();
    const client2 = createMockClient();
    new StormAudioAccessory(platform, accessory2 as never, client2 as never);
    const muteChar = accessory2._speakerService._getCharacteristicMock('Mute')!;
    const activeChar = accessory2._tvService._getCharacteristicMock('Active')!;
    muteChar._getUpdateValueMock().mockClear();
    activeChar._getUpdateValueMock().mockClear();

    client2._emit('volume', -45);
    expect(muteChar._getUpdateValueMock()).not.toHaveBeenCalled();
    expect(activeChar._getUpdateValueMock()).not.toHaveBeenCalled();
  });
});

describe('StormAudioAccessory — listener count baseline verification (Task 9)', () => {
  it('registers exactly one mute listener and one volume listener in constructor', () => {
    const platform = createMockPlatform();
    const accessory = createMockAccessory();
    const client = createMockClient();

    const baselineMute = client._emitter.listenerCount('mute');
    const baselineVolume = client._emitter.listenerCount('volume');

    new StormAudioAccessory(platform, accessory as never, client as never);

    expect(client._emitter.listenerCount('mute')).toBe(baselineMute + 1);
    expect(client._emitter.listenerCount('volume')).toBe(baselineVolume + 1);
  });

  it('mute and volume listener counts do NOT grow after repeated onSet calls', async () => {
    const platform = createMockPlatform();
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);

    const muteBefore = client._emitter.listenerCount('mute');
    const volumeBefore = client._emitter.listenerCount('volume');

    client.getProcessorState.mockReturnValue(ProcessorState.Active);
    const muteChar = accessory._speakerService._getCharacteristicMock('Mute')!;
    const volumeSelectorChar = accessory._speakerService._getCharacteristicMock('VolumeSelector')!;

    await muteChar._triggerSet(true);
    await muteChar._triggerSet(false);
    await volumeSelectorChar._triggerSet(0);
    await volumeSelectorChar._triggerSet(1);

    expect(client._emitter.listenerCount('mute')).toBe(muteBefore);
    expect(client._emitter.listenerCount('volume')).toBe(volumeBefore);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Volume proxy tests (Fan and Lightbulb)
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioAccessory — Fan service registration (default)', () => {
  it('creates Fan service via addService when volumeControl="fan" (default)', () => {
    const platform = createMockPlatform();
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
    expect(accessory.addService).toHaveBeenCalledWith('Fan', 'StormAudio Volume', 'volume-fan');
  });

  it('Fan service has RotationSpeed characteristic', () => {
    const platform = createMockPlatform();
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
    expect(accessory._fanService._getCharacteristicMock('RotationSpeed')).toBeDefined();
  });

  it('Fan service has On characteristic', () => {
    const platform = createMockPlatform();
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
    expect(accessory._fanService._getCharacteristicMock('On')).toBeDefined();
  });

  it('Fan service is added with subtype "volume-fan"', () => {
    const platform = createMockPlatform();
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
    const call = accessory.addService.mock.calls.find((c: unknown[]) => String(c[0]) === 'Fan');
    expect(call).toBeDefined();
    expect(call![2]).toBe('volume-fan');
  });

  it('sets ConfiguredName on Fan service', () => {
    const platform = createMockPlatform();
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
    expect(accessory._fanService.setCharacteristic).toHaveBeenCalledWith('ConfiguredName', 'StormAudio Volume');
  });

  it('logs info "Volume control: fan proxy enabled"', () => {
    const platform = createMockPlatform();
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
    expect(platform.log.info).toHaveBeenCalledWith('[HomeKit] Volume control: fan proxy enabled');
  });

  it('reuses existing Fan service via getService when already present', () => {
    const platform = createMockPlatform();
    const accessory = createMockAccessory();
    accessory.getService.mockImplementation((type: unknown) => {
      const t = String(type);
      if (t === 'Television') return accessory._tvService;
      if (t === 'Fan') return accessory._fanService;
      return null;
    });
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
    expect(accessory.addService).not.toHaveBeenCalledWith('Fan', expect.anything(), expect.anything());
  });
});

describe('StormAudioAccessory — Fan RotationSpeed handlers', () => {
  let platform: StormAudioPlatform;
  let accessory: ReturnType<typeof createMockAccessory>;
  let client: ReturnType<typeof createMockClient>;
  let speedChar: ReturnType<typeof createMockCharacteristic>;

  beforeEach(() => {
    platform = createMockPlatform();
    accessory = createMockAccessory();
    client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
    speedChar = accessory._fanService._getCharacteristicMock('RotationSpeed')!;
  });

  it('RotationSpeed onSet 50% → client.setVolume(-60)', async () => {
    client.getProcessorState.mockReturnValue(ProcessorState.Active);
    await speedChar._triggerSet(50);
    expect(client.setVolume).toHaveBeenCalledWith(-60);
  });

  it('RotationSpeed onSet 100% → client.setVolume(-20) (ceiling)', async () => {
    client.getProcessorState.mockReturnValue(ProcessorState.Active);
    await speedChar._triggerSet(100);
    expect(client.setVolume).toHaveBeenCalledWith(-20);
  });

  it('RotationSpeed onSet 0% → client.setVolume(-100) (floor)', async () => {
    client.getProcessorState.mockReturnValue(ProcessorState.Active);
    await speedChar._triggerSet(0);
    expect(client.setVolume).toHaveBeenCalledWith(-100);
  });

  it('RotationSpeed onSet when processor sleeping → setVolume NOT called', async () => {
    client.getProcessorState.mockReturnValue(ProcessorState.Sleep);
    client.ensureActive.mockResolvedValue(false);
    await speedChar._triggerSet(50);
    expect(client.setVolume).not.toHaveBeenCalled();
  });

  it('RotationSpeed onSet logs debug with percentage and dB', async () => {
    client.getProcessorState.mockReturnValue(ProcessorState.Active);
    await speedChar._triggerSet(50);
    expect(platform.log.debug).toHaveBeenCalledWith('[HomeKit] Set volume to 50% (-60dB)');
  });

  it('RotationSpeed onGet returns 0% when state.volume=-100 (default)', () => {
    expect(speedChar._triggerGet()).toBe(0);
  });

  it('RotationSpeed onGet returns 50% when state.volume=-60', () => {
    client._emit('volume', -60);
    expect(speedChar._triggerGet()).toBe(50);
  });

  it('RotationSpeed onGet returns 75% after volume event(-40)', () => {
    client._emit('volume', -40);
    expect(speedChar._triggerGet()).toBe(75);
  });
});

describe('StormAudioAccessory — Fan On handlers (mute)', () => {
  let platform: StormAudioPlatform;
  let accessory: ReturnType<typeof createMockAccessory>;
  let client: ReturnType<typeof createMockClient>;
  let onChar: ReturnType<typeof createMockCharacteristic>;

  beforeEach(() => {
    platform = createMockPlatform();
    accessory = createMockAccessory();
    client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
    onChar = accessory._fanService._getCharacteristicMock('On')!;
  });

  it('On onSet true (unmute) → client.setMute(false)', async () => {
    client.getProcessorState.mockReturnValue(ProcessorState.Active);
    await onChar._triggerSet(true);
    expect(client.setMute).toHaveBeenCalledWith(false);
  });

  it('On onSet false (mute) → client.setMute(true)', async () => {
    client.getProcessorState.mockReturnValue(ProcessorState.Active);
    await onChar._triggerSet(false);
    expect(client.setMute).toHaveBeenCalledWith(true);
  });

  it('On onSet when processor sleeping → setMute NOT called', async () => {
    client.getProcessorState.mockReturnValue(ProcessorState.Sleep);
    client.ensureActive.mockResolvedValue(false);
    await onChar._triggerSet(false);
    expect(client.setMute).not.toHaveBeenCalled();
  });

  it('On onSet true logs [HomeKit] Volume proxy on (unmute)', async () => {
    client.getProcessorState.mockReturnValue(ProcessorState.Active);
    await onChar._triggerSet(true);
    expect(platform.log.debug).toHaveBeenCalledWith('[HomeKit] Volume proxy on (unmute)');
  });

  it('On onSet false logs [HomeKit] Volume proxy off (mute)', async () => {
    client.getProcessorState.mockReturnValue(ProcessorState.Active);
    await onChar._triggerSet(false);
    expect(platform.log.debug).toHaveBeenCalledWith('[HomeKit] Volume proxy off (mute)');
  });

  it('On onGet returns true (not muted) — default state.mute=false', () => {
    expect(onChar._triggerGet()).toBe(true);
  });

  it('On onGet returns false when muted', () => {
    client._emit('mute', true);
    expect(onChar._triggerGet()).toBe(false);
  });

  it('On onGet returns true after unmute event', () => {
    client._emit('mute', true);
    client._emit('mute', false);
    expect(onChar._triggerGet()).toBe(true);
  });
});

describe('StormAudioAccessory — Fan volume event bidirectional sync', () => {
  it('volume(-40) updates Fan RotationSpeed to 75 with EXTERNAL_CONTEXT', () => {
    const platform = createMockPlatform();
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
    client._emit('volume', -40);
    const speedChar = accessory._fanService._getCharacteristicMock('RotationSpeed')!;
    expect(speedChar._getUpdateValueMock()).toHaveBeenCalledWith(75, { source: 'stormaudio' });
  });

  it('mute(true) updates Fan On to false with EXTERNAL_CONTEXT', () => {
    const platform = createMockPlatform();
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
    client._emit('mute', true);
    const onChar = accessory._fanService._getCharacteristicMock('On')!;
    expect(onChar._getUpdateValueMock()).toHaveBeenCalledWith(false, { source: 'stormaudio' });
  });

  it('mute(false) updates Fan On to true with EXTERNAL_CONTEXT', () => {
    const platform = createMockPlatform();
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
    client._emit('mute', false);
    const onChar = accessory._fanService._getCharacteristicMock('On')!;
    expect(onChar._getUpdateValueMock()).toHaveBeenCalledWith(true, { source: 'stormaudio' });
  });
});

describe('StormAudioAccessory — Lightbulb service registration (volumeControl="lightbulb")', () => {
  it('creates Lightbulb service via addService when volumeControl="lightbulb"', () => {
    const platform = createMockPlatform(undefined, { volumeControl: 'lightbulb' });
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
    expect(accessory.addService).toHaveBeenCalledWith('Lightbulb', 'StormAudio Volume', 'volume-lightbulb');
  });

  it('does NOT create Fan service when volumeControl="lightbulb"', () => {
    const platform = createMockPlatform(undefined, { volumeControl: 'lightbulb' });
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
    expect(accessory.addService).not.toHaveBeenCalledWith('Fan', expect.anything(), expect.anything());
  });

  it('logs info "Volume control: lightbulb proxy enabled"', () => {
    const platform = createMockPlatform(undefined, { volumeControl: 'lightbulb' });
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
    expect(platform.log.info).toHaveBeenCalledWith('[HomeKit] Volume control: lightbulb proxy enabled');
  });

  it('Lightbulb Brightness onSet 50% → client.setVolume(-60)', async () => {
    const platform = createMockPlatform(undefined, { volumeControl: 'lightbulb' });
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
    client.getProcessorState.mockReturnValue(ProcessorState.Active);
    await accessory._lightbulbService._getCharacteristicMock('Brightness')!._triggerSet(50);
    expect(client.setVolume).toHaveBeenCalledWith(-60);
  });

  it('volume(-40) updates Lightbulb Brightness to 75 with EXTERNAL_CONTEXT', () => {
    const platform = createMockPlatform(undefined, { volumeControl: 'lightbulb' });
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
    client._emit('volume', -40);
    const brightnessChar = accessory._lightbulbService._getCharacteristicMock('Brightness')!;
    expect(brightnessChar._getUpdateValueMock()).toHaveBeenCalledWith(75, { source: 'stormaudio' });
  });

  it('mute(true) updates Lightbulb On to false with EXTERNAL_CONTEXT', () => {
    const platform = createMockPlatform(undefined, { volumeControl: 'lightbulb' });
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
    client._emit('mute', true);
    const onChar = accessory._lightbulbService._getCharacteristicMock('On')!;
    expect(onChar._getUpdateValueMock()).toHaveBeenCalledWith(false, { source: 'stormaudio' });
  });
});

describe('StormAudioAccessory — volumeControl="none"', () => {
  it('does NOT create Fan or Lightbulb service', () => {
    const platform = createMockPlatform(undefined, { volumeControl: 'none' });
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
    expect(accessory.addService).not.toHaveBeenCalledWith('Fan', expect.anything(), expect.anything());
    expect(accessory.addService).not.toHaveBeenCalledWith('Lightbulb', expect.anything(), expect.anything());
  });

  it('logs info "Volume control: proxy disabled"', () => {
    const platform = createMockPlatform(undefined, { volumeControl: 'none' });
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
    expect(platform.log.info).toHaveBeenCalledWith('[HomeKit] Volume control: proxy disabled');
  });

  it('volume event only updates TelevisionSpeaker Volume (no proxy)', () => {
    const platform = createMockPlatform(undefined, { volumeControl: 'none' });
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
    client._emit('volume', -40);
    const volumeChar = accessory._speakerService._getCharacteristicMock('Volume')!;
    expect(volumeChar._getUpdateValueMock()).toHaveBeenCalledWith(75, { source: 'stormaudio' });
  });

  it('mute event only updates TelevisionSpeaker Mute (no proxy)', () => {
    const platform = createMockPlatform(undefined, { volumeControl: 'none' });
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
    client._emit('mute', true);
    const muteChar = accessory._speakerService._getCharacteristicMock('Mute')!;
    expect(muteChar._getUpdateValueMock()).toHaveBeenCalledWith(true, { source: 'stormaudio' });
  });
});

describe('StormAudioAccessory — TelevisionSpeaker Volume onGet (Task 4)', () => {
  it('EC13: Volume onGet returns dBToPercentage(state.volume) — default state.volume=-100 → 0%', () => {
    const platform = createMockPlatform();
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
    const volumeChar = accessory._speakerService._getCharacteristicMock('Volume')!;
    expect(volumeChar._triggerGet()).toBe(0);
  });

  it('Volume onGet returns 50% when state.volume=-60', () => {
    const platform = createMockPlatform();
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
    client._emit('volume', -60);
    const volumeChar = accessory._speakerService._getCharacteristicMock('Volume')!;
    expect(volumeChar._triggerGet()).toBe(50);
  });

  it('Volume onGet returns 75% when state.volume=-40', () => {
    const platform = createMockPlatform();
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
    client._emit('volume', -40);
    const volumeChar = accessory._speakerService._getCharacteristicMock('Volume')!;
    expect(volumeChar._triggerGet()).toBe(75);
  });
});

describe('StormAudioAccessory — volume proxy listener count verification', () => {
  it('fan proxy does NOT add extra client.on() listeners beyond mute+volume', () => {
    const platform = createMockPlatform();
    const accessory = createMockAccessory();
    const client = createMockClient();

    const baselineMute = client._emitter.listenerCount('mute');
    const baselineVolume = client._emitter.listenerCount('volume');

    new StormAudioAccessory(platform, accessory as never, client as never);

    expect(client._emitter.listenerCount('mute')).toBe(baselineMute + 1);
    expect(client._emitter.listenerCount('volume')).toBe(baselineVolume + 1);
  });

  it('RotationSpeed and On onSet handlers do NOT register new client listeners', async () => {
    const platform = createMockPlatform();
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);

    const muteBefore = client._emitter.listenerCount('mute');
    const volumeBefore = client._emitter.listenerCount('volume');

    client.getProcessorState.mockReturnValue(ProcessorState.Active);
    const speedChar = accessory._fanService._getCharacteristicMock('RotationSpeed')!;
    const onChar = accessory._fanService._getCharacteristicMock('On')!;

    await speedChar._triggerSet(50);
    await speedChar._triggerSet(75);
    await onChar._triggerSet(true);
    await onChar._triggerSet(false);

    expect(client._emitter.listenerCount('mute')).toBe(muteBefore);
    expect(client._emitter.listenerCount('volume')).toBe(volumeBefore);
  });
});

describe('percentageToDB and dBToPercentage — volume mapping functions', () => {
  it('percentageToDB(50, -100, -20) = -60', () => {
    expect(percentageToDB(50, -100, -20)).toBe(-60);
  });

  it('percentageToDB(100, -100, -20) = -20 (ceiling)', () => {
    expect(percentageToDB(100, -100, -20)).toBe(-20);
  });

  it('percentageToDB(0, -100, -20) = -100 (floor)', () => {
    expect(percentageToDB(0, -100, -20)).toBe(-100);
  });

  it('percentageToDB(50, -80, -30) = -55 (custom range)', () => {
    expect(percentageToDB(50, -80, -30)).toBe(-55);
  });

  it('percentageToDB(1, -100, -20) = -99 (boundary)', () => {
    expect(percentageToDB(1, -100, -20)).toBe(-99);
  });

  it('percentageToDB(99, -100, -20) = -21 (boundary)', () => {
    expect(percentageToDB(99, -100, -20)).toBe(-21);
  });

  it('dBToPercentage(-60, -100, -20) = 50', () => {
    expect(dBToPercentage(-60, -100, -20)).toBe(50);
  });

  it('dBToPercentage(-40, -100, -20) = 75', () => {
    expect(dBToPercentage(-40, -100, -20)).toBe(75);
  });

  it('dBToPercentage(-100, -100, -20) = 0 (floor)', () => {
    expect(dBToPercentage(-100, -100, -20)).toBe(0);
  });

  it('dBToPercentage(-20, -100, -20) = 100 (ceiling)', () => {
    expect(dBToPercentage(-20, -100, -20)).toBe(100);
  });

  it('dBToPercentage(-55, -80, -30) = 50 (custom range)', () => {
    expect(dBToPercentage(-55, -80, -30)).toBe(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Story 3.1 tests — InputSource registration, input sync, ActiveIdentifier onGet
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioAccessory — inputList event → InputSource registration (Story 3.1)', () => {
  let platform: StormAudioPlatform;
  let accessory: ReturnType<typeof createMockAccessory>;
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    platform = createMockPlatform();
    accessory = createMockAccessory();
    client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
  });

  it('MP3: emitting inputList with 2 inputs creates 2 InputSource services', () => {
    client._emit('inputList', [{ id: 1, name: 'Apple TV' }, { id: 2, name: 'PS5' }]);
    expect(accessory.addService).toHaveBeenCalledWith('InputSource', 'Apple TV', 'input-1');
    expect(accessory.addService).toHaveBeenCalledWith('InputSource', 'PS5', 'input-2');
  });

  it('MP5: InputSource Identifier = StormAudio input ID', () => {
    client._emit('inputList', [{ id: 3, name: 'Blu-ray' }]);
    const inputSource = accessory._getInputSource(3)!;
    expect(inputSource.setCharacteristic).toHaveBeenCalledWith('Identifier', 3);
  });

  it('MP4: InputSource ConfiguredName = StormAudio name (no alias)', () => {
    client._emit('inputList', [{ id: 1, name: 'Apple TV' }]);
    const inputSource = accessory._getInputSource(1)!;
    expect(inputSource.setCharacteristic).toHaveBeenCalledWith('ConfiguredName', 'Apple TV');
  });

  it('EC7: InputSource IsConfigured = CONFIGURED (1)', () => {
    client._emit('inputList', [{ id: 1, name: 'TV' }]);
    const inputSource = accessory._getInputSource(1)!;
    const calls = (inputSource.setCharacteristic as ReturnType<typeof vi.fn>).mock.calls;
    const call = calls.find((c: unknown[]) => String(c[0]) === 'IsConfigured');
    expect(call).toBeDefined();
    expect(call![1]).toBe(1); // CONFIGURED = 1
  });

  it('EC8: InputSource InputSourceType = HDMI (3)', () => {
    client._emit('inputList', [{ id: 1, name: 'TV' }]);
    const inputSource = accessory._getInputSource(1)!;
    const calls = (inputSource.setCharacteristic as ReturnType<typeof vi.fn>).mock.calls;
    const call = calls.find((c: unknown[]) => String(c[0]) === 'InputSourceType');
    expect(call).toBeDefined();
    expect(call![1]).toBe(3); // HDMI = 3
  });

  it('EC9: InputSource CurrentVisibilityState = SHOWN (0)', () => {
    client._emit('inputList', [{ id: 1, name: 'TV' }]);
    const inputSource = accessory._getInputSource(1)!;
    const calls = (inputSource.setCharacteristic as ReturnType<typeof vi.fn>).mock.calls;
    const call = calls.find((c: unknown[]) => String(c[0]) === 'CurrentVisibilityState');
    expect(call).toBeDefined();
    expect(call![1]).toBe(0); // SHOWN = 0
  });

  it('MP6: each InputSource is linked to tvService via addLinkedService', () => {
    client._emit('inputList', [{ id: 1, name: 'Apple TV' }]);
    const inputSource = accessory._getInputSource(1)!;
    expect(accessory._tvService.addLinkedService).toHaveBeenCalledWith(inputSource);
  });

  it('EC1: empty inputList (0 inputs) creates no InputSource services, no errors', () => {
    expect(() => client._emit('inputList', [])).not.toThrow();
    const calls = accessory.addService.mock.calls.filter((c: unknown[]) => String(c[0]) === 'InputSource');
    expect(calls).toHaveLength(0);
  });

  it('EC10: second inputList event uses getService() — addService NOT called again for existing inputs', () => {
    client._emit('inputList', [{ id: 1, name: 'Apple TV' }]);
    const addServiceCallsBefore = accessory.addService.mock.calls.filter(
      (c: unknown[]) => String(c[0]) === 'InputSource',
    ).length;
    // Second inputList event — getService will now find the stored service
    client._emit('inputList', [{ id: 1, name: 'Apple TV' }]);
    const addServiceCallsAfter = accessory.addService.mock.calls.filter(
      (c: unknown[]) => String(c[0]) === 'InputSource',
    ).length;
    expect(addServiceCallsAfter).toBe(addServiceCallsBefore); // No new addService calls
  });

  it('EC13: logs [HomeKit] Registered InputSource: once per input (2 inputs → 2 debug logs)', () => {
    client._emit('inputList', [{ id: 1, name: 'Apple TV' }, { id: 2, name: 'PS5' }]);
    const debugCalls = (platform.log.debug as ReturnType<typeof vi.fn>).mock.calls;
    const registeredLogs = debugCalls.filter((c: unknown[]) =>
      String(c[0]).includes('[HomeKit] Registered InputSource:'),
    );
    expect(registeredLogs).toHaveLength(2);
  });

  it('EC14: logs [HomeKit] Input sources registered: N at info level', () => {
    client._emit('inputList', [{ id: 1, name: 'Apple TV' }, { id: 2, name: 'PS5' }]);
    expect(platform.log.info).toHaveBeenCalledWith('[HomeKit] Input sources registered: 2');
  });
});

describe('StormAudioAccessory — input event → ActiveIdentifier sync (Story 3.1)', () => {
  let platform: StormAudioPlatform;
  let accessory: ReturnType<typeof createMockAccessory>;
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    platform = createMockPlatform();
    accessory = createMockAccessory();
    client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
  });

  it('MP7: client emits input(3) → tvService.ActiveIdentifier.updateValue(3, EXTERNAL_CONTEXT)', () => {
    client._emit('input', 3);
    const activeIdChar = accessory._tvService._getCharacteristicMock('ActiveIdentifier')!;
    expect(activeIdChar._getUpdateValueMock()).toHaveBeenCalledWith(3, { source: 'stormaudio' });
  });

  it('EC12: input event uses EXTERNAL_CONTEXT', () => {
    client._emit('input', 3);
    const activeIdChar = accessory._tvService._getCharacteristicMock('ActiveIdentifier')!;
    const calls = activeIdChar._getUpdateValueMock().mock.calls;
    const inputCall = calls.find((c: unknown[]) => c[0] === 3);
    expect(inputCall![1]).toEqual({ source: 'stormaudio' });
  });

  it('MP8: input event updates this.state.input (verified via onGet)', () => {
    client._emit('input', 3);
    const activeIdChar = accessory._tvService._getCharacteristicMock('ActiveIdentifier')!;
    expect(activeIdChar._triggerGet()).toBe(3);
  });

  it('EC11: input event with different IDs — ActiveIdentifier updated to 1, then to 3', () => {
    const activeIdChar = accessory._tvService._getCharacteristicMock('ActiveIdentifier')!;
    client._emit('input', 1);
    expect(activeIdChar._getUpdateValueMock()).toHaveBeenCalledWith(1, { source: 'stormaudio' });
    client._emit('input', 3);
    expect(activeIdChar._getUpdateValueMock()).toHaveBeenCalledWith(3, { source: 'stormaudio' });
  });

  it('logs [HomeKit] Active input updated: ID N at debug level', () => {
    client._emit('input', 3);
    expect(platform.log.debug).toHaveBeenCalledWith('[HomeKit] Active input updated: ID 3');
  });
});

describe('StormAudioAccessory — ActiveIdentifier onGet (Story 3.1)', () => {
  let platform: StormAudioPlatform;
  let accessory: ReturnType<typeof createMockAccessory>;
  let client: ReturnType<typeof createMockClient>;
  let activeIdChar: ReturnType<typeof createMockCharacteristic>;

  beforeEach(() => {
    platform = createMockPlatform();
    accessory = createMockAccessory();
    client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
    activeIdChar = accessory._tvService._getCharacteristicMock('ActiveIdentifier')!;
  });

  it('MP9: onGet returns 0 (initial state) before any input event', () => {
    expect(activeIdChar._triggerGet()).toBe(0);
  });

  it('MP10: onGet returns 3 after input(3) event', () => {
    client._emit('input', 3);
    expect(activeIdChar._triggerGet()).toBe(3);
  });

  it('IS3: onGet returns live state after input event', () => {
    client._emit('input', 3);
    expect(activeIdChar._triggerGet()).toBe(3);
    client._emit('input', 1);
    expect(activeIdChar._triggerGet()).toBe(1);
  });
});

describe('StormAudioAccessory — IS1: inputList end-to-end integration (Story 3.1)', () => {
  it('IS1: TCP connects → inputList parsed → 2 InputSource services linked to TV', () => {
    const platform = createMockPlatform();
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);

    client._emit('inputList', [{ id: 1, name: 'TV' }, { id: 2, name: 'PS5' }]);

    const src1 = accessory._getInputSource(1)!;
    const src2 = accessory._getInputSource(2)!;
    expect(src1.setCharacteristic).toHaveBeenCalledWith('Identifier', 1);
    expect(src1.setCharacteristic).toHaveBeenCalledWith('ConfiguredName', 'TV');
    expect(src2.setCharacteristic).toHaveBeenCalledWith('Identifier', 2);
    expect(src2.setCharacteristic).toHaveBeenCalledWith('ConfiguredName', 'PS5');
    expect(accessory._tvService.addLinkedService).toHaveBeenCalledWith(src1);
    expect(accessory._tvService.addLinkedService).toHaveBeenCalledWith(src2);
  });

  it('IS2: StormAudio broadcasts ssp.input.[3] → ActiveIdentifier.updateValue(3, EXTERNAL_CONTEXT)', () => {
    const platform = createMockPlatform();
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);

    client._emit('input', 3);
    const activeIdChar = accessory._tvService._getCharacteristicMock('ActiveIdentifier')!;
    expect(activeIdChar._getUpdateValueMock()).toHaveBeenCalledWith(3, { source: 'stormaudio' });
  });
});

describe('StormAudioAccessory — listener count verification (Story 3.1)', () => {
  it('registers exactly 1 inputList listener and 1 input listener in constructor', () => {
    const platform = createMockPlatform();
    const accessory = createMockAccessory();
    const client = createMockClient();

    const baselineInputList = client._emitter.listenerCount('inputList');
    const baselineInput = client._emitter.listenerCount('input');

    new StormAudioAccessory(platform, accessory as never, client as never);

    expect(client._emitter.listenerCount('inputList')).toBe(baselineInputList + 1);
    expect(client._emitter.listenerCount('input')).toBe(baselineInput + 1);
  });

  it('inputList listener does NOT register new client.on() inside the handler', () => {
    const platform = createMockPlatform();
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);

    const inputListBefore = client._emitter.listenerCount('inputList');
    const inputBefore = client._emitter.listenerCount('input');

    client._emit('inputList', [{ id: 1, name: 'TV' }]);
    client._emit('inputList', [{ id: 1, name: 'TV' }]);

    expect(client._emitter.listenerCount('inputList')).toBe(inputListBefore);
    expect(client._emitter.listenerCount('input')).toBe(inputBefore);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Story 3.2 tests — ActiveIdentifier onSet, alias configuration
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioAccessory — ActiveIdentifier onSet handler (Story 3.2)', () => {
  let platform: StormAudioPlatform;
  let accessory: ReturnType<typeof createMockAccessory>;
  let client: ReturnType<typeof createMockClient>;
  let activeIdChar: ReturnType<typeof createMockCharacteristic>;

  beforeEach(() => {
    platform = createMockPlatform();
    accessory = createMockAccessory();
    client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);
    activeIdChar = accessory._tvService._getCharacteristicMock('ActiveIdentifier')!;
  });

  it('MP1: processor active → Set ActiveIdentifier = 3 → client.setInput(3) called', async () => {
    client.getProcessorState.mockReturnValue(ProcessorState.Active);
    await activeIdChar._triggerSet(3);
    expect(client.setInput).toHaveBeenCalledWith(3);
  });

  it('MP2: processor active → Set ActiveIdentifier = 1 → client.setInput(1) called', async () => {
    client.getProcessorState.mockReturnValue(ProcessorState.Active);
    await activeIdChar._triggerSet(1);
    expect(client.setInput).toHaveBeenCalledWith(1);
  });

  it('EC1/EC2(false): processor sleeping → requiresActive returns false → setInput NOT called', async () => {
    client.getProcessorState.mockReturnValue(ProcessorState.Sleep);
    client.ensureActive.mockResolvedValue(false);
    await activeIdChar._triggerSet(3);
    await new Promise(r => setTimeout(r, 0));
    expect(client.setInput).not.toHaveBeenCalled();
  });

  it('EC2(true): processor active → requiresActive returns true → setInput called', async () => {
    client.getProcessorState.mockReturnValue(ProcessorState.Active);
    await activeIdChar._triggerSet(3);
    expect(client.setInput).toHaveBeenCalled();
    expect(client.ensureActive).not.toHaveBeenCalled(); // fast path skips ensureActive
  });

  it('EC7: setInput called with number type (not string)', async () => {
    client.getProcessorState.mockReturnValue(ProcessorState.Active);
    await activeIdChar._triggerSet(3);
    const calls = client.setInput.mock.calls;
    expect(typeof calls[0][0]).toBe('number');
    expect(calls[0][0]).toBe(3);
  });

  it('logs [HomeKit] Input switch to ID N at debug level', async () => {
    client.getProcessorState.mockReturnValue(ProcessorState.Active);
    await activeIdChar._triggerSet(3);
    expect(platform.log.debug).toHaveBeenCalledWith('[HomeKit] Input switch to ID 3');
  });

  it('EC8: Initializing state — requiresActive calls ensureActive and waits', async () => {
    client.getProcessorState.mockReturnValue(ProcessorState.Initializing);
    client.ensureActive.mockResolvedValue(true);
    await activeIdChar._triggerSet(3);
    await new Promise(r => setTimeout(r, 0));
    expect(client.ensureActive).toHaveBeenCalled();
  });
});

describe('StormAudioAccessory — alias configuration (Story 3.2)', () => {
  it('MP3: alias for ID 3 → ConfiguredName = "TV" instead of "Blu-ray"', () => {
    const platform = createMockPlatform(undefined, { inputs: { '3': 'TV' } });
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);

    client._emit('inputList', [{ id: 3, name: 'Blu-ray' }]);
    const inputSource = accessory._getInputSource(3)!;
    expect(inputSource.setCharacteristic).toHaveBeenCalledWith('ConfiguredName', 'TV');
    expect(inputSource.setCharacteristic).not.toHaveBeenCalledWith('ConfiguredName', 'Blu-ray');
  });

  it('MP4: alias for ID 5 → ConfiguredName = "PS5"', () => {
    const platform = createMockPlatform(undefined, { inputs: { '5': 'PS5' } });
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);

    client._emit('inputList', [{ id: 5, name: 'Input 5' }]);
    const inputSource = accessory._getInputSource(5)!;
    expect(inputSource.setCharacteristic).toHaveBeenCalledWith('ConfiguredName', 'PS5');
  });

  it('MP5: no alias (inputs: {}) → ConfiguredName = StormAudio name', () => {
    const platform = createMockPlatform(undefined, { inputs: {} });
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);

    client._emit('inputList', [{ id: 3, name: 'Blu-ray' }]);
    const inputSource = accessory._getInputSource(3)!;
    expect(inputSource.setCharacteristic).toHaveBeenCalledWith('ConfiguredName', 'Blu-ray');
  });

  it('MP6: partial aliases — aliased input gets alias, unaliased gets StormAudio name', () => {
    const platform = createMockPlatform(undefined, { inputs: { '5': 'PS5' } });
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);

    client._emit('inputList', [{ id: 3, name: 'Blu-ray' }, { id: 5, name: 'Input 5' }]);
    const src3 = accessory._getInputSource(3)!;
    const src5 = accessory._getInputSource(5)!;
    expect(src3.setCharacteristic).toHaveBeenCalledWith('ConfiguredName', 'Blu-ray');
    expect(src5.setCharacteristic).toHaveBeenCalledWith('ConfiguredName', 'PS5');
  });

  it('EC3: alias lookup uses String(input.id) — alias key "3" resolved for numeric id 3', () => {
    const platform = createMockPlatform(undefined, { inputs: { '3': 'TV' } });
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);

    client._emit('inputList', [{ id: 3, name: 'Default' }]);
    const inputSource = accessory._getInputSource(3)!;
    expect(inputSource.setCharacteristic).toHaveBeenCalledWith('ConfiguredName', 'TV');
  });

  it('EC4: input ID without matching alias key falls through to StormAudio name', () => {
    const platform = createMockPlatform(undefined, { inputs: { '5': 'PS5' } });
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);

    client._emit('inputList', [{ id: 3, name: 'Default' }]);
    const inputSource = accessory._getInputSource(3)!;
    expect(inputSource.setCharacteristic).toHaveBeenCalledWith('ConfiguredName', 'Default');
  });

  it('EC5: alias debug log present when alias applied', () => {
    const platform = createMockPlatform(undefined, { inputs: { '3': 'TV' } });
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);

    client._emit('inputList', [{ id: 3, name: 'Default' }]);
    expect(platform.log.debug).toHaveBeenCalledWith(
      expect.stringContaining('[HomeKit] Input ID 3 alias:'),
    );
  });

  it('EC6: no alias debug log when inputs is empty', () => {
    const platform = createMockPlatform(undefined, { inputs: {} });
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);

    client._emit('inputList', [{ id: 3, name: 'Default' }]);
    const debugCalls = (platform.log.debug as ReturnType<typeof vi.fn>).mock.calls;
    const aliasLogs = debugCalls.filter((c: unknown[]) => String(c[0]).includes('alias:'));
    expect(aliasLogs).toHaveLength(0);
  });

  it('alias also applies to addService display name', () => {
    const platform = createMockPlatform(undefined, { inputs: { '3': 'TV' } });
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);

    client._emit('inputList', [{ id: 3, name: 'Blu-ray' }]);
    expect(accessory.addService).toHaveBeenCalledWith('InputSource', 'TV', 'input-3');
  });
});

describe('StormAudioAccessory — IS round-trip: onSet → setInput → input event (Story 3.2 AC5)', () => {
  it('MP7: Active → Set ActiveIdentifier(3) → setInput(3) → emit input(3) → updateValue(3)', async () => {
    const platform = createMockPlatform();
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);

    client.getProcessorState.mockReturnValue(ProcessorState.Active);
    const activeIdChar = accessory._tvService._getCharacteristicMock('ActiveIdentifier')!;

    // 1. HomeKit sets ActiveIdentifier = 3
    await activeIdChar._triggerSet(3);
    expect(client.setInput).toHaveBeenCalledWith(3);

    // 2. StormAudio confirms via input(3) broadcast
    client._emit('input', 3);
    expect(activeIdChar._getUpdateValueMock()).toHaveBeenCalledWith(3, { source: 'stormaudio' });
  });
});

describe('StormAudioAccessory — Story 3.2 listener count verification', () => {
  it('adding ActiveIdentifier onSet does not increase client EventEmitter listener count', () => {
    const platform = createMockPlatform();
    const accessory = createMockAccessory();
    const client = createMockClient();

    const baselineInputList = client._emitter.listenerCount('inputList');
    const baselineInput = client._emitter.listenerCount('input');

    new StormAudioAccessory(platform, accessory as never, client as never);

    // Total client listeners should still be exactly +1 each (from Story 3.1)
    // onSet is a HAP characteristic handler, not a client EventEmitter listener
    expect(client._emitter.listenerCount('inputList')).toBe(baselineInputList + 1);
    expect(client._emitter.listenerCount('input')).toBe(baselineInput + 1);
  });

  it('inputList handler modification does NOT add new client.on() calls — listener count stable', () => {
    const platform = createMockPlatform(undefined, { inputs: { '3': 'TV' } });
    const accessory = createMockAccessory();
    const client = createMockClient();
    new StormAudioAccessory(platform, accessory as never, client as never);

    const inputListBefore = client._emitter.listenerCount('inputList');

    // Trigger inputList with alias — no new listeners should be registered
    client._emit('inputList', [{ id: 3, name: 'Blu-ray' }]);
    client._emit('inputList', [{ id: 3, name: 'Blu-ray' }]);

    expect(client._emitter.listenerCount('inputList')).toBe(inputListBefore);
  });
});
