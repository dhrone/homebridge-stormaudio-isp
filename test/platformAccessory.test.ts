import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

import type { StormAudioPlatform } from '../src/platform';
import { StormAudioAccessory } from '../src/platformAccessory';
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

function createMockPlatform(nameOverride?: string) {
  const name = nameOverride ?? 'StormAudio';

  const CharacteristicMock = {
    Name: 'Name',
    ConfiguredName: 'ConfiguredName',
    SleepDiscoveryMode: Object.assign('SleepDiscoveryMode', SleepDiscoveryModeEnum),
    ActiveIdentifier: 'ActiveIdentifier',
    Active: Object.assign('Active', ActiveEnum),
    VolumeSelector: Object.assign('VolumeSelector', { INCREMENT: 0, DECREMENT: 1 }),
    Mute: 'Mute',
    VolumeControlType: Object.assign('VolumeControlType', { ABSOLUTE: 3 }),
  };

  const ServiceMock = {
    Television: 'Television',
    TelevisionSpeaker: 'TelevisionSpeaker',
  };

  return {
    Service: ServiceMock,
    Characteristic: CharacteristicMock,
    config: { name },
    validatedConfig: { name },
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

  const getService = vi.fn((type: unknown) =>
    String(type) === 'Television' ? tvService : null,
  );

  const addService = vi.fn((...args: unknown[]) =>
    String(args[0]) === 'TelevisionSpeaker' ? speakerService : tvService,
  );

  return {
    getService,
    addService,
    _tvService: tvService,
    _speakerService: speakerService,
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

  it('volume event updates internal state.volume and logs the level', () => {
    client._emit('volume', -45);
    expect(platform.log.debug).toHaveBeenCalledWith('[HomeKit] Volume level: -45dB');
  });

  it('volume event logs at -55dB', () => {
    client._emit('volume', -55);
    expect(platform.log.debug).toHaveBeenCalledWith('[HomeKit] Volume level: -55dB');
  });

  it('volume event does NOT update any characteristic (state tracking only)', () => {
    // No characteristic.updateValue should be called from the volume handler
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
