import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EventEmitter } from 'events';

import { StormAudioPlatform } from '../src/platform';

// --- Mock StorageService (homebridge internal) ---
vi.mock('homebridge/lib/storageService', () => ({
  StorageService: vi.fn().mockImplementation(() => ({
    initSync: vi.fn(),
    setItem: vi.fn().mockResolvedValue(undefined),
  })),
}));

// --- Mock StormAudioClient ---
vi.mock('../src/stormAudioClient', () => {
  return {
    StormAudioClient: vi.fn().mockImplementation(() => {
      const emitter = new EventEmitter();
      return {
        on: emitter.on.bind(emitter),
        once: emitter.once.bind(emitter),
        emit: emitter.emit.bind(emitter),
        listenerCount: emitter.listenerCount.bind(emitter),
        connect: vi.fn(),
        disconnect: vi.fn(),
        setPower: vi.fn(),
      };
    }),
  };
});

// --- Mock StormAudioAccessory ---
vi.mock('../src/platformAccessory', () => {
  return {
    StormAudioAccessory: vi.fn(),
  };
});

// --- Mock StormAudioZone2Accessory ---
vi.mock('../src/zone2Accessory', () => {
  return {
    StormAudioZone2Accessory: vi.fn().mockImplementation(() => ({
      replayCachedInputs: vi.fn(),
    })),
  };
});

// --- Helpers ---

function createMockApi() {
  const eventHandlers = new Map<string, ((...args: unknown[]) => void)[]>();

  return {
    user: {
      storagePath: vi.fn().mockReturnValue('/tmp/test-storage'),
    },
    hap: {
      Service: { Television: 'Television' },
      Characteristic: {
        Name: 'Name',
        Active: Object.assign('Active', { ACTIVE: 1, INACTIVE: 0 }),
      },
      Categories: { TELEVISION: 31 },
      uuid: { generate: vi.fn().mockReturnValue('mock-uuid') },
    },
    platformAccessory: vi.fn().mockImplementation((name: string, uuid: string) => ({
      displayName: name,
      UUID: uuid,
      category: undefined as number | undefined,
      getService: vi.fn(),
      addService: vi.fn(),
    })),
    publishExternalAccessories: vi.fn(),
    registerPlatformAccessories: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!eventHandlers.has(event)) {
        eventHandlers.set(event, []);
      }
      eventHandlers.get(event)!.push(handler);
    }),
    _trigger: (event: string) => {
      const handlers = eventHandlers.get(event) || [];
      for (const handler of handlers) {
        handler();
      }
    },
  };
}

function createMockLog() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
    prefix: 'StormAudioISP',
  };
}

const validConfig = {
  platform: 'StormAudioISP',
  name: 'StormAudio',
  host: '192.168.1.100',
  port: 23,
  volumeCeiling: -20,
  volumeFloor: -100,
  volumeControl: 'lightbulb',
};

describe('StormAudioPlatform — didFinishLaunching (Task 6)', () => {
  let api: ReturnType<typeof createMockApi>;
  let log: ReturnType<typeof createMockLog>;

  beforeEach(() => {
    vi.clearAllMocks();
    api = createMockApi();
    log = createMockLog();
  });

  it('creates accessory and calls publishExternalAccessories', async () => {
    const { StormAudioClient } = await import('../src/stormAudioClient');
    new StormAudioPlatform(log as never, validConfig as never, api as never);
    api._trigger('didFinishLaunching');
    const clientInstance = (StormAudioClient as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    clientInstance.emit('inputList', []);

    expect(api.platformAccessory).toHaveBeenCalledWith('StormAudio', 'mock-uuid');
    expect(api.publishExternalAccessories).toHaveBeenCalledWith(
      'homebridge-stormaudio-isp',
      expect.arrayContaining([expect.objectContaining({ UUID: 'mock-uuid' })]),
    );
  });

  it('generates UUID using stormaudio-isp seed', () => {
    new StormAudioPlatform(log as never, validConfig as never, api as never);
    api._trigger('didFinishLaunching');

    expect(api.hap.uuid.generate).toHaveBeenCalledWith('stormaudio-isp');
  });

  it('sets accessory category to TELEVISION', () => {
    new StormAudioPlatform(log as never, validConfig as never, api as never);
    api._trigger('didFinishLaunching');

    const createdAccessory = api.platformAccessory.mock.results[0]?.value;
    expect(createdAccessory.category).toBe(31); // Categories.TELEVISION
  });

  it('calls client.connect() during didFinishLaunching', async () => {
    const { StormAudioClient } = await import('../src/stormAudioClient');
    new StormAudioPlatform(log as never, validConfig as never, api as never);
    api._trigger('didFinishLaunching');

    const clientInstance = (StormAudioClient as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    expect(clientInstance.connect).toHaveBeenCalled();
  });

  it('registers error listener on client — emit error does not throw', async () => {
    const { StormAudioClient } = await import('../src/stormAudioClient');
    new StormAudioPlatform(log as never, validConfig as never, api as never);
    api._trigger('didFinishLaunching');

    const clientInstance = (StormAudioClient as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    // Without an error listener, EventEmitter throws on 'error' emit — crashing the plugin
    expect(() => clientInstance.emit('error', new Error('test'))).not.toThrow();
  });

  it('creates StormAudioAccessory with correct accessory and client instances', async () => {
    const { StormAudioAccessory } = await import('../src/platformAccessory');
    const { StormAudioClient } = await import('../src/stormAudioClient');
    new StormAudioPlatform(log as never, validConfig as never, api as never);
    api._trigger('didFinishLaunching');

    const createdAccessory = api.platformAccessory.mock.results[0]?.value;
    const clientInstance = (StormAudioClient as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    expect(StormAudioAccessory).toHaveBeenCalledWith(
      expect.anything(), // platform (StormAudioPlatform instance — hard to assert directly)
      createdAccessory,
      clientInstance,
    );
  });

  it('logs info when accessory is published', async () => {
    const { StormAudioClient } = await import('../src/stormAudioClient');
    new StormAudioPlatform(log as never, validConfig as never, api as never);
    api._trigger('didFinishLaunching');
    const clientInstance = (StormAudioClient as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    clientInstance.emit('inputList', []);

    expect(log.info).toHaveBeenCalledWith('[HomeKit] Published StormAudio accessory: StormAudio');
  });

  it('uses custom name for accessory', async () => {
    const { StormAudioClient } = await import('../src/stormAudioClient');
    const customConfig = { ...validConfig, name: 'Theater' };
    new StormAudioPlatform(log as never, customConfig as never, api as never);
    api._trigger('didFinishLaunching');
    const clientInstance = (StormAudioClient as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    clientInstance.emit('inputList', []);

    expect(api.platformAccessory).toHaveBeenCalledWith('Theater', 'mock-uuid');
    expect(log.info).toHaveBeenCalledWith('[HomeKit] Published StormAudio accessory: Theater');
  });
});

describe('StormAudioPlatform — shutdown handler (Task 8)', () => {
  let api: ReturnType<typeof createMockApi>;
  let log: ReturnType<typeof createMockLog>;

  beforeEach(() => {
    vi.clearAllMocks();
    api = createMockApi();
    log = createMockLog();
  });

  it('calls client.disconnect() on shutdown', async () => {
    const { StormAudioClient } = await import('../src/stormAudioClient');
    new StormAudioPlatform(log as never, validConfig as never, api as never);

    // First trigger didFinishLaunching to create the client
    api._trigger('didFinishLaunching');

    // Get the client instance
    const clientInstance = (StormAudioClient as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value;

    // Now trigger shutdown
    api._trigger('shutdown');

    expect(clientInstance.disconnect).toHaveBeenCalled();
  });

  it('logs graceful close message on shutdown', () => {
    new StormAudioPlatform(log as never, validConfig as never, api as never);
    api._trigger('didFinishLaunching');
    api._trigger('shutdown');

    expect(log.info).toHaveBeenCalledWith('[TCP] Connection closed gracefully');
  });

  it('does not throw if shutdown fires before didFinishLaunching (no client)', () => {
    new StormAudioPlatform(log as never, validConfig as never, api as never);
    // Trigger shutdown without didFinishLaunching
    expect(() => api._trigger('shutdown')).not.toThrow();
  });
});

describe('StormAudioPlatform — config validation disabled', () => {
  it('does not create client or accessories when config is invalid', () => {
    const api = createMockApi();
    const log = createMockLog();
    const invalidConfig = { platform: 'StormAudioISP' }; // missing host

    new StormAudioPlatform(log as never, invalidConfig as never, api as never);
    api._trigger('didFinishLaunching');

    expect(api.publishExternalAccessories).not.toHaveBeenCalled();
  });
});

describe('StormAudioPlatform — configureAccessory', () => {
  let api: ReturnType<typeof createMockApi>;
  let log: ReturnType<typeof createMockLog>;

  beforeEach(() => {
    vi.clearAllMocks();
    api = createMockApi();
    log = createMockLog();
  });

  it('stores accessory in accessories map by UUID', () => {
    const platform = new StormAudioPlatform(log as never, validConfig as never, api as never);
    const mockAccessory = { UUID: 'test-uuid-123', displayName: 'Theater' };

    platform.configureAccessory(mockAccessory as never);

    expect(platform.accessories.has('test-uuid-123')).toBe(true);
    expect(platform.accessories.get('test-uuid-123')).toBe(mockAccessory);
  });

  it('logs accessory name when loading from cache', () => {
    const platform = new StormAudioPlatform(log as never, validConfig as never, api as never);
    const mockAccessory = { UUID: 'test-uuid', displayName: 'Theater' };

    platform.configureAccessory(mockAccessory as never);

    expect(log.info).toHaveBeenCalledWith('Loading accessory from cache:', 'Theater');
  });
});

describe('StormAudioPlatform — Zone 2 zoneList handling (Story 5.1)', () => {
  let api: ReturnType<typeof createMockApi>;
  let log: ReturnType<typeof createMockLog>;

  const zone2Config = {
    ...validConfig,
    zone2: { zoneId: 13, name: 'Patio' },
  };

  // Sample zone state entries (matches ZoneState interface shape used by platform event)
  const zone1 = { id: 1, name: 'Downmix', layout: 0, type: 0, useZone2Source: false, volume: -40, delay: 0, eq: 0, lipsync: 0, mode: 0, mute: false, loudness: 0, avzones: 0, bass: 0, treble: 0 };
  const zone13 = { id: 13, name: 'Patio', layout: 0, type: 0, useZone2Source: false, volume: -50, delay: 0, eq: 0, lipsync: 0, mode: 0, mute: false, loudness: 0, avzones: 0, bass: 0, treble: 0 };

  beforeEach(() => {
    vi.clearAllMocks();
    api = createMockApi();
    log = createMockLog();
  });

  // Zone type label siblings (AC 1)
  it('logs Zone ID 1 as (built-in)', async () => {
    const { StormAudioClient } = await import('../src/stormAudioClient');
    new StormAudioPlatform(log as never, validConfig as never, api as never);
    api._trigger('didFinishLaunching');
    const clientInstance = (StormAudioClient as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    clientInstance.emit('zoneList', [zone1]);
    expect(log.info).toHaveBeenCalledWith('[State] Zone 1: "Downmix" (built-in)');
  });

  it('logs Zone ID != 1 as (user zone)', async () => {
    const { StormAudioClient } = await import('../src/stormAudioClient');
    new StormAudioPlatform(log as never, validConfig as never, api as never);
    api._trigger('didFinishLaunching');
    const clientInstance = (StormAudioClient as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    clientInstance.emit('zoneList', [zone13]);
    expect(log.info).toHaveBeenCalledWith('[State] Zone 13: "Patio" (user zone)');
  });

  // Zone logging fires without zone2 config (AC 1 — always fires)
  it('logs all zones even when no zone2 config', async () => {
    const { StormAudioClient } = await import('../src/stormAudioClient');
    new StormAudioPlatform(log as never, validConfig as never, api as never);
    api._trigger('didFinishLaunching');
    const clientInstance = (StormAudioClient as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    clientInstance.emit('zoneList', [zone1, zone13]);
    expect(log.info).toHaveBeenCalledWith('[State] Zone 1: "Downmix" (built-in)');
    expect(log.info).toHaveBeenCalledWith('[State] Zone 13: "Patio" (user zone)');
    // No Zone 2 accessory created
    const calls = (api.publishExternalAccessories as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.every(c => (c[1] as { displayName: string }[])[0]?.displayName === validConfig.name)).toBe(true);
  });

  // Zone 2 accessory created when zone found (AC 3)
  it('creates Zone 2 accessory when zoneId found in zone list', async () => {
    const { StormAudioClient } = await import('../src/stormAudioClient');
    const { StormAudioZone2Accessory } = await import('../src/zone2Accessory');
    api.hap.uuid.generate = vi.fn()
      .mockReturnValueOnce('mock-main-uuid')
      .mockReturnValueOnce('mock-zone2-uuid');

    new StormAudioPlatform(log as never, zone2Config as never, api as never);
    api._trigger('didFinishLaunching');
    const clientInstance = (StormAudioClient as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    clientInstance.emit('zoneList', [zone1, zone13]);

    expect(StormAudioZone2Accessory).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith('[HomeKit] Published Zone 2 accessory: Patio');
    // Zone 2 is published immediately when zoneList arrives with the matching zone
    expect(api.publishExternalAccessories).toHaveBeenCalled();
  });

  // Zone 2 zoneId not found → error log, no accessory (AC 4)
  it('logs error when zone2.zoneId not found in zone list', async () => {
    const { StormAudioClient } = await import('../src/stormAudioClient');
    const missingZoneConfig = { ...validConfig, zone2: { zoneId: 99 } };
    new StormAudioPlatform(log as never, missingZoneConfig as never, api as never);
    api._trigger('didFinishLaunching');
    const clientInstance = (StormAudioClient as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    clientInstance.emit('zoneList', [zone1, zone13]);

    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('zone2.zoneId 99 not found'));
  });

  // Empty zone list — zoneId not found (AC 30 equivalent)
  it('handles empty zone list — logs error if zone2 configured', async () => {
    const { StormAudioClient } = await import('../src/stormAudioClient');
    new StormAudioPlatform(log as never, zone2Config as never, api as never);
    api._trigger('didFinishLaunching');
    const clientInstance = (StormAudioClient as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    clientInstance.emit('zoneList', []);
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('zone2.zoneId 13 not found'));
  });

  // Zone 2 accessory created only once even when zoneList fires twice (persistent listener)
  it('creates Zone 2 accessory only once when zoneList fires twice', async () => {
    const { StormAudioClient } = await import('../src/stormAudioClient');
    const { StormAudioZone2Accessory } = await import('../src/zone2Accessory');
    new StormAudioPlatform(log as never, zone2Config as never, api as never);
    api._trigger('didFinishLaunching');
    const clientInstance = (StormAudioClient as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value;

    clientInstance.emit('zoneList', [zone1, zone13]);
    clientInstance.emit('zoneList', [zone1, zone13]); // second emit (reconnect)

    expect(StormAudioZone2Accessory).toHaveBeenCalledTimes(1);
  });

  // Zone logging fires on both first and second zoneList emit (persistent listener, AC 1 ZFR3)
  it('logs zone names on both first and second zoneList emit (reconnect scenario)', async () => {
    const { StormAudioClient } = await import('../src/stormAudioClient');
    new StormAudioPlatform(log as never, zone2Config as never, api as never);
    api._trigger('didFinishLaunching');
    const clientInstance = (StormAudioClient as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value;

    clientInstance.emit('zoneList', [zone1]);
    clientInstance.emit('zoneList', [zone1]); // reconnect

    const infoCalls = (log.info as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0] as string);
    const zoneLogCount = infoCalls.filter(m => m.includes('[State] Zone 1:')).length;
    expect(zoneLogCount).toBe(2);
  });

  // Verify zoneList listener count remains at +1 after emit (persistent, not once)
  it('zoneList listener count stays at 1 after first emit (not once — persistent)', async () => {
    const { StormAudioClient } = await import('../src/stormAudioClient');
    new StormAudioPlatform(log as never, zone2Config as never, api as never);
    api._trigger('didFinishLaunching');
    const clientInstance = (StormAudioClient as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    const beforeCount = clientInstance.listenerCount('zoneList');
    clientInstance.emit('zoneList', [zone1, zone13]);
    expect(clientInstance.listenerCount('zoneList')).toBe(beforeCount); // stays same, not removed
  });
});

describe('StormAudioPlatform — zone storage persistence (Story 5.3)', () => {
  let api: ReturnType<typeof createMockApi>;
  let log: ReturnType<typeof createMockLog>;

  // Zone definitions: Downmix (built-in via name + layout), and user zones
  const z1Downmix = {
    id: 1, name: 'Downmix', layout: 2000, type: 0,
    useZone2Source: false, volume: -40, delay: 0, eq: 0, lipsync: 0,
    mode: 0, mute: false, loudness: 0, avzones: 0, bass: 0, treble: 0,
  };
  const z13User = {
    id: 13, name: 'Zone 2', layout: 0, type: 0,
    useZone2Source: false, volume: -50, delay: 0, eq: 0, lipsync: 0,
    mode: 0, mute: false, loudness: 0, avzones: 0, bass: 0, treble: 0,
  };
  const z14User = {
    id: 14, name: 'Zone 3', layout: 0, type: 0,
    useZone2Source: false, volume: -60, delay: 0, eq: 0, lipsync: 0,
    mode: 0, mute: false, loudness: 0, avzones: 0, bass: 0, treble: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    api = createMockApi();
    log = createMockLog();
  });

  async function setupPlatform(config: typeof validConfig = validConfig) {
    const { StormAudioClient } = await import('../src/stormAudioClient');
    const { StorageService } = await import('homebridge/lib/storageService');
    new StormAudioPlatform(log as never, config as never, api as never);
    api._trigger('didFinishLaunching');
    const client = (StormAudioClient as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    const storage = (StorageService as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    return { client, storage };
  }

  // P1-1: StorageService constructed with correct path
  it('initializes StorageService with correct storage path', async () => {
    const { StorageService } = await import('homebridge/lib/storageService');
    await setupPlatform();
    expect(StorageService).toHaveBeenCalledWith(
      '/tmp/test-storage/homebridge-stormaudio-isp',
    );
  });

  // P1-2: initSync() called during construction
  it('calls initSync() on StorageService during platform construction', async () => {
    const { storage } = await setupPlatform();
    expect(storage.initSync).toHaveBeenCalledOnce();
  });

  // QA-1: setItem called with zone array on zoneList event
  it('QA-1: calls storageService.setItem with { id, name } zone array when zoneList fires', async () => {
    const { client, storage } = await setupPlatform();
    client.emit('zoneList', [z1Downmix, z13User]);
    expect(storage.setItem).toHaveBeenCalledWith('zones', [
      { id: 1, name: 'Downmix' },
      { id: 13, name: 'Zone 2' },
    ]);
  });

  // QA-1b: storage write failure — plugin does not throw, logs DEBUG
  it('QA-1b: storage write failure — plugin does not throw and logs DEBUG error message', async () => {
    const { StormAudioClient } = await import('../src/stormAudioClient');
    const { StorageService } = await import('homebridge/lib/storageService');
    const failingSetItem = vi.fn().mockRejectedValue(new Error('disk full'));
    (StorageService as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      initSync: vi.fn(),
      setItem: failingSetItem,
    }));
    new StormAudioPlatform(log as never, validConfig as never, api as never);
    api._trigger('didFinishLaunching');
    const clientInstance = (StormAudioClient as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value;

    expect(() => clientInstance.emit('zoneList', [z1Downmix])).not.toThrow();
    await new Promise(resolve => setTimeout(resolve, 0)); // flush microtasks
    expect(log.debug).toHaveBeenCalledWith(
      expect.stringContaining('Failed to persist zone list to storage: disk full'),
    );
  });

  // QA-4: Each zone entry has id (number) and name (string) — no type field
  it('QA-4: each stored zone entry has id (number) and name (string), no type field', async () => {
    const { client, storage } = await setupPlatform();
    client.emit('zoneList', [z1Downmix, z13User]);
    const zones = storage.setItem.mock.calls[0][1] as { id: number; name: string }[];
    for (const z of zones) {
      expect(typeof z.id).toBe('number');
      expect(typeof z.name).toBe('string');
      expect(Object.keys(z)).toEqual(['id', 'name']);
    }
  });

  // QA-16: Single zone — stored as { id, name }
  it('QA-16: single zone → stored as { id, name } only', async () => {
    const { client, storage } = await setupPlatform();
    client.emit('zoneList', [z1Downmix]);
    expect(storage.setItem).toHaveBeenCalledWith('zones', [{ id: 1, name: 'Downmix' }]);
  });

  // QA-17: Multiple zones — all stored as { id, name }
  it('QA-17: multiple zones all stored as { id, name }', async () => {
    const { client, storage } = await setupPlatform();
    client.emit('zoneList', [z1Downmix, z13User, z14User]);
    expect(storage.setItem).toHaveBeenCalledWith('zones', [
      { id: 1, name: 'Downmix' },
      { id: 13, name: 'Zone 2' },
      { id: 14, name: 'Zone 3' },
    ]);
  });

  // QA-18: Storage updated on reconnect — setItem called twice
  it('QA-18: storage updated on every connection — setItem called again on reconnect', async () => {
    const { client, storage } = await setupPlatform();
    client.emit('zoneList', [z1Downmix]);
    client.emit('zoneList', [z1Downmix]); // simulate reconnect
    expect(storage.setItem).toHaveBeenCalledTimes(2);
  });
});
