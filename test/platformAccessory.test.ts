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
    disconnect: vi.fn(),
    connect: vi.fn(),
    getProcessorState: vi.fn().mockReturnValue(ProcessorState.Sleep),
    ensureActive: vi.fn().mockResolvedValue(true),
    _emit: emitter.emit.bind(emitter),
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
  };

  const ServiceMock = {
    Television: 'Television',
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

  return {
    getService: vi.fn().mockReturnValue(tvService),
    addService: vi.fn().mockReturnValue(tvService),
    _tvService: tvService,
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
    await activeChar._triggerSet(ActiveEnum.ACTIVE);
    expect(platform.log.warn).toHaveBeenCalledWith('[State] Power-on timed out — processor did not reach active state');
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
