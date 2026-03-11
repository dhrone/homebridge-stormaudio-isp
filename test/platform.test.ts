import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EventEmitter } from 'events';

import { StormAudioPlatform } from '../src/platform';

// --- Mock StormAudioClient ---
vi.mock('../src/stormAudioClient', () => {
  return {
    StormAudioClient: vi.fn().mockImplementation(() => {
      const emitter = new EventEmitter();
      return {
        on: emitter.on.bind(emitter),
        emit: emitter.emit.bind(emitter),
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

// --- Helpers ---

function createMockApi() {
  const eventHandlers = new Map<string, ((...args: unknown[]) => void)[]>();

  return {
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

  it('creates accessory and calls publishExternalAccessories', () => {
    new StormAudioPlatform(log as never, validConfig as never, api as never);
    api._trigger('didFinishLaunching');

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

  it('creates StormAudioAccessory with the client', async () => {
    const { StormAudioAccessory } = await import('../src/platformAccessory');
    new StormAudioPlatform(log as never, validConfig as never, api as never);
    api._trigger('didFinishLaunching');

    expect(StormAudioAccessory).toHaveBeenCalledWith(
      expect.anything(), // platform
      expect.anything(), // accessory
      expect.anything(), // client
    );
  });

  it('logs info when accessory is published', () => {
    new StormAudioPlatform(log as never, validConfig as never, api as never);
    api._trigger('didFinishLaunching');

    expect(log.info).toHaveBeenCalledWith('[HomeKit] Published StormAudio accessory: StormAudio');
  });

  it('uses custom name for accessory', () => {
    const customConfig = { ...validConfig, name: 'Theater' };
    new StormAudioPlatform(log as never, customConfig as never, api as never);
    api._trigger('didFinishLaunching');

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
