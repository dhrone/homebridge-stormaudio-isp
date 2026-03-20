import { describe, expect, it, vi } from 'vitest';

import { EventEmitter } from 'events';

import type { StormAudioPlatform } from '../src/platform';
import { StormAudioPresetAccessory } from '../src/presetAccessory';
import { ProcessorState } from '../src/types';
import type { PresetsConfig } from '../src/types';

// --- Mock Homebridge types ---

const ActiveEnum = { ACTIVE: 1, INACTIVE: 0 } as const;
const SleepDiscoveryModeEnum = { ALWAYS_DISCOVERABLE: 1, NOT_DISCOVERABLE: 0 } as const;
const IsConfiguredEnum = { CONFIGURED: 1, NOT_CONFIGURED: 0 } as const;
const InputSourceTypeEnum = { OTHER: 2 } as const;
const CurrentVisibilityStateEnum = { SHOWN: 0, HIDDEN: 1 } as const;

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

function createMockClient(overrides?: Partial<{
  processorState: ProcessorState;
  preset: number;
  presetList: Array<{ id: number; name: string }>;
}>) {
  const emitter = new EventEmitter();
  const state = {
    processorState: overrides?.processorState ?? ProcessorState.Active,
    audioConfig: {
      preset: overrides?.preset ?? 0,
      presetList: overrides?.presetList ?? [],
    },
  };
  return {
    on: emitter.on.bind(emitter),
    listenerCount: emitter.listenerCount.bind(emitter),
    getProcessorState: vi.fn(() => state.processorState),
    getAudioConfig: vi.fn(() => ({
      ...state.audioConfig,
      presetList: [...state.audioConfig.presetList],
    })),
    setPreset: vi.fn(),
    ensureActive: vi.fn().mockResolvedValue(true),
    _emit: emitter.emit.bind(emitter),
    _setProcessorState: (s: ProcessorState) => { state.processorState = s; },
    _setPreset: (id: number) => { state.audioConfig.preset = id; },
    _setPresetList: (list: Array<{ id: number; name: string }>) => { state.audioConfig.presetList = list; },
  };
}

function createMockPlatform(presetsConfig?: Partial<PresetsConfig>) {
  const defaults: PresetsConfig = {
    enabled: true,
    name: 'Presets',
    aliases: {},
    ...presetsConfig,
  };

  const CharacteristicMock = {
    Name: 'Name',
    ConfiguredName: 'ConfiguredName',
    SleepDiscoveryMode: Object.assign('SleepDiscoveryMode', SleepDiscoveryModeEnum),
    ActiveIdentifier: 'ActiveIdentifier',
    Active: Object.assign('Active', ActiveEnum),
    Identifier: 'Identifier',
    IsConfigured: Object.assign('IsConfigured', IsConfiguredEnum),
    InputSourceType: Object.assign('InputSourceType', InputSourceTypeEnum),
    CurrentVisibilityState: Object.assign('CurrentVisibilityState', CurrentVisibilityStateEnum),
  };

  const ServiceMock = {
    Television: 'Television',
    InputSource: 'InputSource',
  };

  return {
    Service: ServiceMock,
    Characteristic: CharacteristicMock,
    validatedConfig: {
      presets: defaults,
      wakeTimeout: 90,
    },
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    api: {
      hap: {
        HapStatusError: MockHapStatusError,
        HAPStatus: MockHAPStatus,
      },
    },
  } as unknown as StormAudioPlatform;
}

function createMockAccessory() {
  const tvService = createMockService();
  const inputSourceServices = new Map<string, ReturnType<typeof createMockService>>();

  const getService = vi.fn((type: unknown) => {
    const t = String(type);
    if (t === 'Television') return tvService;
    if (inputSourceServices.has(t)) return inputSourceServices.get(t)!;
    return null;
  });

  const addService = vi.fn((...args: unknown[]) => {
    const serviceType = String(args[0]);
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
    _inputSourceServices: inputSourceServices,
    category: undefined as number | undefined,
    displayName: 'Presets',
  };
}

function buildPresetAccessory(options?: {
  presetsConfig?: Partial<PresetsConfig>;
  clientOverrides?: Partial<{
    processorState: ProcessorState;
    preset: number;
    presetList: Array<{ id: number; name: string }>;
  }>;
}) {
  const platform = createMockPlatform(options?.presetsConfig);
  const accessory = createMockAccessory();
  const client = createMockClient(options?.clientOverrides);
  const presetsConfig: PresetsConfig = {
    enabled: true,
    name: 'Presets',
    aliases: {},
    ...options?.presetsConfig,
  };
  const preset = new StormAudioPresetAccessory(platform, accessory as never, client as never, presetsConfig);
  return { platform, accessory, client, preset };
}

const SAMPLE_PRESETS = [
  { id: 9, name: 'Theater 1' },
  { id: 12, name: 'Music' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Television service setup
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioPresetAccessory — Television service setup', () => {
  it('gets or adds Television service', () => {
    const { accessory } = buildPresetAccessory();
    expect(accessory.getService).toHaveBeenCalledWith('Television');
  });

  it('sets ConfiguredName on TV service', () => {
    const { accessory } = buildPresetAccessory({ presetsConfig: { name: 'Theater Presets' } });
    expect(accessory._tvService.setCharacteristic).toHaveBeenCalledWith('ConfiguredName', 'Theater Presets');
  });

  it('sets SleepDiscoveryMode to ALWAYS_DISCOVERABLE', () => {
    const { accessory } = buildPresetAccessory();
    const calls = (accessory._tvService.setCharacteristic as ReturnType<typeof vi.fn>).mock.calls;
    const sdmCall = calls.find((c: unknown[]) => String(c[0]) === 'SleepDiscoveryMode');
    expect(sdmCall).toBeDefined();
    expect(sdmCall![1]).toBe(SleepDiscoveryModeEnum.ALWAYS_DISCOVERABLE);
  });

  it('sets ActiveIdentifier to current preset ID from client', () => {
    const { accessory } = buildPresetAccessory({ clientOverrides: { preset: 9 } });
    expect(accessory._tvService.setCharacteristic).toHaveBeenCalledWith('ActiveIdentifier', 9);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Active characteristic — informational only
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioPresetAccessory — Active characteristic (informational)', () => {
  it('Active onGet returns ACTIVE when processor is Active and connected', () => {
    const { accessory } = buildPresetAccessory({ clientOverrides: { processorState: ProcessorState.Active } });
    const activeChar = accessory._tvService._getChar('Active')!;
    const result = activeChar._triggerGet();
    expect(result).toBe(ActiveEnum.ACTIVE);
  });

  it('Active onGet returns INACTIVE when processor is Sleep', () => {
    const { accessory, client } = buildPresetAccessory({ clientOverrides: { processorState: ProcessorState.Sleep } });
    (client.getProcessorState as ReturnType<typeof vi.fn>).mockReturnValue(ProcessorState.Sleep);
    const activeChar = accessory._tvService._getChar('Active')!;
    const result = activeChar._triggerGet();
    expect(result).toBe(ActiveEnum.INACTIVE);
  });

  it('Active onGet returns INACTIVE when disconnected', () => {
    const { accessory, client } = buildPresetAccessory();
    client._emit('disconnected');
    const activeChar = accessory._tvService._getChar('Active')!;
    const result = activeChar._triggerGet();
    expect(result).toBe(ActiveEnum.INACTIVE);
  });

  it('Active onSet to ACTIVE is a no-op — no power command sent', () => {
    const { accessory, client } = buildPresetAccessory();
    const activeChar = accessory._tvService._getChar('Active')!;
    activeChar._triggerSet(ActiveEnum.ACTIVE);
    expect(client.setPreset).not.toHaveBeenCalled();
  });

  it('Active onSet to INACTIVE is a no-op — no power command sent', () => {
    const { accessory, client } = buildPresetAccessory();
    const activeChar = accessory._tvService._getChar('Active')!;
    activeChar._triggerSet(ActiveEnum.INACTIVE);
    expect(client.setPreset).not.toHaveBeenCalled();
  });

  it('Active onSet logs debug about "use main accessory"', () => {
    const { accessory, platform } = buildPresetAccessory();
    const activeChar = accessory._tvService._getChar('Active')!;
    activeChar._triggerSet(ActiveEnum.ACTIVE);
    expect(platform.log.debug).toHaveBeenCalledWith(
      expect.stringContaining('use main accessory'),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ActiveIdentifier — preset selection
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioPresetAccessory — ActiveIdentifier', () => {
  it('ActiveIdentifier onGet returns current preset ID', () => {
    const { accessory, client } = buildPresetAccessory({ clientOverrides: { preset: 9 } });
    (client.getAudioConfig as ReturnType<typeof vi.fn>).mockReturnValue({ preset: 9, presetList: [] });
    const activeIdChar = accessory._tvService._getChar('ActiveIdentifier')!;
    expect(activeIdChar._triggerGet()).toBe(9);
  });

  it('ActiveIdentifier onGet when disconnected throws HapStatusError', () => {
    const { accessory, client } = buildPresetAccessory();
    client._emit('disconnected');
    const activeIdChar = accessory._tvService._getChar('ActiveIdentifier')!;
    expect(() => activeIdChar._triggerGet()).toThrow(MockHapStatusError);
  });

  it('ActiveIdentifier onSet sends setPreset command', async () => {
    const { accessory, client } = buildPresetAccessory();
    const activeIdChar = accessory._tvService._getChar('ActiveIdentifier')!;
    await activeIdChar._triggerSet(9);
    await new Promise(resolve => setImmediate(resolve));
    expect(client.setPreset).toHaveBeenCalledWith(9);
  });

  it('ActiveIdentifier onSet when disconnected throws HapStatusError without sending command', async () => {
    const { accessory, client } = buildPresetAccessory();
    client._emit('disconnected');
    const activeIdChar = accessory._tvService._getChar('ActiveIdentifier')!;
    expect(() => activeIdChar._triggerSet(9)).toThrow(MockHapStatusError);
    await new Promise(resolve => setImmediate(resolve));
    expect(client.setPreset).not.toHaveBeenCalled();
  });

  it('ActiveIdentifier onSet with sleeping processor calls ensureActive before command', async () => {
    const { accessory, client } = buildPresetAccessory({
      clientOverrides: { processorState: ProcessorState.Sleep },
    });
    (client.getProcessorState as ReturnType<typeof vi.fn>).mockReturnValue(ProcessorState.Sleep);
    (client.ensureActive as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const activeIdChar = accessory._tvService._getChar('ActiveIdentifier')!;
    await activeIdChar._triggerSet(9);
    await new Promise(resolve => setImmediate(resolve));
    expect(client.ensureActive).toHaveBeenCalled();
    expect(client.setPreset).toHaveBeenCalledWith(9);
  });

  it('ActiveIdentifier onSet drops command when ensureActive returns false', async () => {
    const { accessory, client } = buildPresetAccessory({
      clientOverrides: { processorState: ProcessorState.Sleep },
    });
    (client.getProcessorState as ReturnType<typeof vi.fn>).mockReturnValue(ProcessorState.Sleep);
    (client.ensureActive as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const activeIdChar = accessory._tvService._getChar('ActiveIdentifier')!;
    await activeIdChar._triggerSet(9);
    await new Promise(resolve => setImmediate(resolve));
    expect(client.setPreset).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Preset broadcast sync (AC 4)
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioPresetAccessory — preset broadcast sync', () => {
  it('external preset change updates ActiveIdentifier with EXTERNAL_CONTEXT', () => {
    const { accessory, client } = buildPresetAccessory();
    const activeIdChar = accessory._tvService._getChar('ActiveIdentifier')!;
    client._emit('preset', 12);
    expect(activeIdChar._getUpdateValueMock()).toHaveBeenCalledWith(12, { source: 'stormaudio' });
  });

  it('external preset change to unknown preset ID still updates ActiveIdentifier', () => {
    const { accessory, client } = buildPresetAccessory();
    const activeIdChar = accessory._tvService._getChar('ActiveIdentifier')!;
    client._emit('preset', 99);
    expect(activeIdChar._getUpdateValueMock()).toHaveBeenCalledWith(99, { source: 'stormaudio' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Processor state handling (AC 7, 9)
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioPresetAccessory — processor state handling', () => {
  it('processorState=Sleep pushes Active=INACTIVE', () => {
    const { accessory, client } = buildPresetAccessory();
    const activeChar = accessory._tvService._getChar('Active')!;
    client._emit('processorState', ProcessorState.Sleep);
    expect(activeChar._getUpdateValueMock()).toHaveBeenCalledWith(ActiveEnum.INACTIVE, { source: 'stormaudio' });
  });

  it('processorState=Active pushes Active=ACTIVE', () => {
    const { accessory, client } = buildPresetAccessory();
    const activeChar = accessory._tvService._getChar('Active')!;
    client._emit('processorState', ProcessorState.Active);
    expect(activeChar._getUpdateValueMock()).toHaveBeenCalledWith(ActiveEnum.ACTIVE, { source: 'stormaudio' });
  });

  it('processorState=Initializing — no Active push', () => {
    const { accessory, client } = buildPresetAccessory();
    const activeChar = accessory._tvService._getChar('Active')!;
    client._emit('processorState', ProcessorState.Initializing);
    expect(activeChar._getUpdateValueMock()).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Connection state handling (AC 8)
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioPresetAccessory — connection state handling', () => {
  it('disconnect pushes Active=INACTIVE', () => {
    const { accessory, client } = buildPresetAccessory();
    const activeChar = accessory._tvService._getChar('Active')!;
    client._emit('disconnected');
    expect(activeChar._getUpdateValueMock()).toHaveBeenCalledWith(ActiveEnum.INACTIVE, { source: 'stormaudio' });
  });

  it('reconnect restores connected=true — subsequent onGet works', () => {
    const { accessory, client } = buildPresetAccessory();
    client._emit('disconnected');
    client._emit('connected');
    const activeIdChar = accessory._tvService._getChar('ActiveIdentifier')!;
    expect(() => activeIdChar._triggerGet()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// replayCachedPresets — InputSource registration
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioPresetAccessory — replayCachedPresets / registerPresetInputs', () => {
  it('replayCachedPresets with presets creates InputSource services', () => {
    const { accessory, client, preset } = buildPresetAccessory({
      clientOverrides: { presetList: SAMPLE_PRESETS },
    });
    preset.replayCachedPresets();
    expect(accessory.addService).toHaveBeenCalledWith('InputSource', expect.any(String), 'preset-input-9');
    expect(accessory.addService).toHaveBeenCalledWith('InputSource', expect.any(String), 'preset-input-12');
    expect(client.getAudioConfig).toHaveBeenCalled();
  });

  it('each InputSource has correct Identifier, ConfiguredName', () => {
    const { accessory, preset } = buildPresetAccessory({
      clientOverrides: { presetList: SAMPLE_PRESETS },
    });
    preset.replayCachedPresets();
    const inputSvc9 = accessory._inputSourceServices.get('preset-input-9');
    expect(inputSvc9).toBeDefined();
    expect(inputSvc9!.setCharacteristic).toHaveBeenCalledWith('Identifier', 9);
    expect(inputSvc9!.setCharacteristic).toHaveBeenCalledWith('ConfiguredName', 'Theater 1');
    // IsConfigured and CurrentVisibilityState use String object keys — check via call scan
    const calls = (inputSvc9!.setCharacteristic as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some(c => String(c[0]) === 'IsConfigured' && c[1] === IsConfiguredEnum.CONFIGURED)).toBe(true);
    expect(calls.some(c => String(c[0]) === 'CurrentVisibilityState' && c[1] === CurrentVisibilityStateEnum.SHOWN)).toBe(true);
  });

  it('alias overrides processor name for matching ID', () => {
    const { accessory, preset } = buildPresetAccessory({
      presetsConfig: { aliases: { '9': 'Movie Night' } },
      clientOverrides: { presetList: SAMPLE_PRESETS },
    });
    preset.replayCachedPresets();
    const inputSvc9 = accessory._inputSourceServices.get('preset-input-9');
    expect(inputSvc9!.setCharacteristic).toHaveBeenCalledWith('ConfiguredName', 'Movie Night');
  });

  it('preset without alias uses processor name', () => {
    const { accessory, preset } = buildPresetAccessory({
      presetsConfig: { aliases: { '9': 'Movie Night' } },
      clientOverrides: { presetList: SAMPLE_PRESETS },
    });
    preset.replayCachedPresets();
    const inputSvc12 = accessory._inputSourceServices.get('preset-input-12');
    expect(inputSvc12!.setCharacteristic).toHaveBeenCalledWith('ConfiguredName', 'Music');
  });

  it('empty aliases — all presets use processor names', () => {
    const { accessory, preset } = buildPresetAccessory({
      presetsConfig: { aliases: {} },
      clientOverrides: { presetList: SAMPLE_PRESETS },
    });
    preset.replayCachedPresets();
    const inputSvc9 = accessory._inputSourceServices.get('preset-input-9');
    expect(inputSvc9!.setCharacteristic).toHaveBeenCalledWith('ConfiguredName', 'Theater 1');
  });

  it('replayCachedPresets with empty presetList — no InputSource added', () => {
    const { accessory, preset } = buildPresetAccessory({ clientOverrides: { presetList: [] } });
    preset.replayCachedPresets();
    expect(accessory.addService).not.toHaveBeenCalledWith('InputSource', expect.anything(), expect.anything());
  });

  it('InputSource is linked to TV service via addLinkedService', () => {
    const { accessory, preset } = buildPresetAccessory({
      clientOverrides: { presetList: [{ id: 9, name: 'Theater 1' }] },
    });
    preset.replayCachedPresets();
    expect(accessory._tvService.addLinkedService).toHaveBeenCalled();
  });

  it('preset list update on reconnect hides removed presets', () => {
    const { accessory, client, preset } = buildPresetAccessory({
      clientOverrides: { presetList: SAMPLE_PRESETS },
    });
    preset.replayCachedPresets(); // initial: 9, 12
    // Reconnect with different list: 9, 15
    client._emit('presetList', [{ id: 9, name: 'Theater 1' }, { id: 15, name: 'Sport' }]);
    const inputSvc12 = accessory._inputSourceServices.get('preset-input-12');
    // CurrentVisibilityState uses String object keys — check via call scan
    const calls = (inputSvc12!.setCharacteristic as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some(c => String(c[0]) === 'CurrentVisibilityState' && c[1] === CurrentVisibilityStateEnum.HIDDEN)).toBe(true);
  });

  it('preset list update on reconnect shows new presets', () => {
    const { accessory, client, preset } = buildPresetAccessory({
      clientOverrides: { presetList: SAMPLE_PRESETS },
    });
    preset.replayCachedPresets();
    client._emit('presetList', [{ id: 9, name: 'Theater 1' }, { id: 15, name: 'Sport' }]);
    const inputSvc15 = accessory._inputSourceServices.get('preset-input-15');
    expect(inputSvc15).toBeDefined();
    // CurrentVisibilityState uses String object keys — check via call scan
    const calls15 = (inputSvc15!.setCharacteristic as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls15.some(c => String(c[0]) === 'CurrentVisibilityState' && c[1] === CurrentVisibilityStateEnum.SHOWN)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Listener cleanup verification
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioPresetAccessory — listener cleanup verification', () => {
  it('registers exactly 1 "preset" listener', () => {
    const { client } = buildPresetAccessory();
    expect(client.listenerCount('preset')).toBe(1);
  });

  it('registers exactly 1 "presetList" listener', () => {
    const { client } = buildPresetAccessory();
    expect(client.listenerCount('presetList')).toBe(1);
  });

  it('registers exactly 1 "processorState" listener', () => {
    const { client } = buildPresetAccessory();
    expect(client.listenerCount('processorState')).toBe(1);
  });

  it('registers exactly 1 "disconnected" listener', () => {
    const { client } = buildPresetAccessory();
    expect(client.listenerCount('disconnected')).toBe(1);
  });

  it('registers exactly 1 "connected" listener', () => {
    const { client } = buildPresetAccessory();
    expect(client.listenerCount('connected')).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration smoke tests
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioPresetAccessory — integration smoke tests', () => {
  it('QA-31: end-to-end preset lifecycle', async () => {
    const { accessory, client, preset } = buildPresetAccessory({
      presetsConfig: { aliases: { '9': 'Movie Night' } },
      clientOverrides: { presetList: SAMPLE_PRESETS },
    });
    preset.replayCachedPresets();

    // Verify InputSources created with alias
    const inputSvc9 = accessory._inputSourceServices.get('preset-input-9');
    expect(inputSvc9!.setCharacteristic).toHaveBeenCalledWith('ConfiguredName', 'Movie Night');

    // External preset change
    const activeIdChar = accessory._tvService._getChar('ActiveIdentifier')!;
    client._emit('preset', 12);
    expect(activeIdChar._getUpdateValueMock()).toHaveBeenCalledWith(12, { source: 'stormaudio' });

    // HomeKit preset selection
    await activeIdChar._triggerSet(9);
    await new Promise(resolve => setImmediate(resolve));
    expect(client.setPreset).toHaveBeenCalledWith(9);

    // Disconnect
    client._emit('disconnected');
    const activeChar = accessory._tvService._getChar('Active')!;
    expect(activeChar._getUpdateValueMock()).toHaveBeenCalledWith(ActiveEnum.INACTIVE, { source: 'stormaudio' });
  });

  it('QA-33: preset selection with wake from sleep', async () => {
    const { accessory, client } = buildPresetAccessory({
      clientOverrides: { processorState: ProcessorState.Sleep },
    });
    // Processor remains sleeping — ensureActive resolves true (woke up)
    (client.getProcessorState as ReturnType<typeof vi.fn>).mockReturnValue(ProcessorState.Sleep);
    (client.ensureActive as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const activeIdChar = accessory._tvService._getChar('ActiveIdentifier')!;
    await activeIdChar._triggerSet(9);
    await new Promise(resolve => setImmediate(resolve));

    expect(client.ensureActive).toHaveBeenCalled();
    expect(client.setPreset).toHaveBeenCalledWith(9);
  });
});
