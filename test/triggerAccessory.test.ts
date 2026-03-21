import { describe, expect, it, vi } from 'vitest';

import { EventEmitter } from 'events';

import type { StormAudioPlatform } from '../src/platform';
import { StormAudioTriggerAccessory } from '../src/triggerAccessory';
import type { TriggerConfig } from '../src/types';

// --- Mock Homebridge types ---

const ContactSensorStateEnum = {
  CONTACT_DETECTED: 0,
  CONTACT_NOT_DETECTED: 1,
} as const;

class MockHapStatusError extends Error {
  constructor(public readonly hapStatus: number) {
    super(`HapStatusError: ${hapStatus}`);
    this.name = 'HapStatusError';
  }
}
const MockHAPStatus = { SERVICE_COMMUNICATION_FAILURE: -70402 } as const;

function createMockCharacteristic() {
  let onSetHandler: ((value: unknown) => void) | null = null;
  let onGetHandler: (() => unknown) | null = null;
  const updateValueFn = vi.fn();

  return {
    onSet: vi.fn((handler: (value: unknown) => void) => {
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
    _hasSetHandler: () => onSetHandler !== null,
    _hasGetHandler: () => onGetHandler !== null,
  };
}

function createMockService(serviceType: string) {
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
    type: serviceType,
    setCharacteristic: vi.fn().mockReturnThis(),
    getCharacteristic,
    _getChar: (name: string) => characteristics.get(key(name)),
    _characteristics: characteristics,
  };
}

function createMockClient(triggerStates?: Map<number, boolean>) {
  const emitter = new EventEmitter();
  const states = triggerStates ?? new Map<number, boolean>();
  return {
    on: emitter.on.bind(emitter),
    listenerCount: emitter.listenerCount.bind(emitter),
    setTrigger: vi.fn(),
    getTriggerStates: vi.fn(() => new Map(states)),
    _emit: emitter.emit.bind(emitter),
    _setTriggerState: (id: number, on: boolean) => {
      states.set(id, on);
    },
  };
}

function createMockPlatform() {
  const CharacteristicMock = {
    Name: 'Name',
    ConfiguredName: 'ConfiguredName',
    On: 'On',
    ContactSensorState: Object.assign('ContactSensorState', ContactSensorStateEnum),
  };

  const ServiceMock = {
    Switch: 'Switch',
    ContactSensor: 'ContactSensor',
  };

  return {
    Service: ServiceMock,
    Characteristic: CharacteristicMock,
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

function createMockAccessory(triggerConfig: TriggerConfig) {
  const switchService = createMockService('Switch');
  const contactService = createMockService('ContactSensor');

  const getService = vi.fn(() => null); // return null so addService is called
  const addService = vi.fn((...args: unknown[]) => {
    const serviceType = String(args[0]);
    if (serviceType === 'Switch') return switchService;
    if (serviceType === 'ContactSensor') return contactService;
    return switchService;
  });

  return {
    getService,
    addService,
    _switchService: switchService,
    _contactService: contactService,
    category: undefined as number | undefined,
    displayName: triggerConfig.name,
  };
}

function buildTriggerAccessory(options: {
  triggerId?: number;
  triggerConfig?: Partial<TriggerConfig>;
  triggerStates?: Map<number, boolean>;
}) {
  const triggerId = options.triggerId ?? 1;
  const triggerConfig: TriggerConfig = {
    name: 'Amp Power',
    type: 'switch',
    ...options.triggerConfig,
  };
  const platform = createMockPlatform();
  const accessory = createMockAccessory(triggerConfig);
  const client = createMockClient(options.triggerStates);
  const accessor = new StormAudioTriggerAccessory(
    platform,
    accessory as never,
    client as never,
    triggerId,
    triggerConfig,
  );
  return { platform, accessory, client, accessor, triggerConfig };
}

// ─────────────────────────────────────────────────────────────────────────────
// Switch type — service setup
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioTriggerAccessory — Switch service setup (AC 1)', () => {
  it('type=switch — adds Switch service', () => {
    const { accessory } = buildTriggerAccessory({ triggerConfig: { type: 'switch' } });
    expect(accessory.addService).toHaveBeenCalledWith('Switch', expect.any(String));
  });

  it('type=switch — does NOT add ContactSensor service', () => {
    const { accessory } = buildTriggerAccessory({ triggerConfig: { type: 'switch' } });
    const contactCall = (accessory.addService as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => String(c[0]) === 'ContactSensor',
    );
    expect(contactCall).toBeUndefined();
  });

  it('type=switch — sets ConfiguredName on service', () => {
    const { accessory } = buildTriggerAccessory({ triggerConfig: { name: 'Amp Power', type: 'switch' } });
    expect(accessory._switchService.setCharacteristic).toHaveBeenCalledWith('ConfiguredName', 'Amp Power');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Switch — On characteristic handlers
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioTriggerAccessory — Switch On characteristic', () => {
  it('Switch On onSet=true sends ssp.trig1.on command', () => {
    const { accessory, client } = buildTriggerAccessory({ triggerId: 1 });
    const onChar = accessory._switchService._getChar('On')!;
    onChar._triggerSet(true);
    expect(client.setTrigger).toHaveBeenCalledWith(1, true);
  });

  it('Switch On onSet=false sends ssp.trig1.off command', () => {
    const { accessory, client } = buildTriggerAccessory({ triggerId: 1 });
    const onChar = accessory._switchService._getChar('On')!;
    onChar._triggerSet(false);
    expect(client.setTrigger).toHaveBeenCalledWith(1, false);
  });

  it('Switch On onGet returns current state (initially false)', () => {
    const { accessory } = buildTriggerAccessory({ triggerId: 1 });
    const onChar = accessory._switchService._getChar('On')!;
    expect(onChar._triggerGet()).toBe(false);
  });

  it('Switch On onGet returns true after triggerState(1, true) broadcast', () => {
    const { accessory, client } = buildTriggerAccessory({ triggerId: 1 });
    client._emit('triggerState', 1, true);
    const onChar = accessory._switchService._getChar('On')!;
    expect(onChar._triggerGet()).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ContactSensor type — service setup
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioTriggerAccessory — ContactSensor service setup (AC 3)', () => {
  it('type=contact — adds ContactSensor service', () => {
    const { accessory } = buildTriggerAccessory({ triggerConfig: { type: 'contact' } });
    expect(accessory.addService).toHaveBeenCalledWith('ContactSensor', expect.any(String));
  });

  it('type=contact — does NOT add Switch service', () => {
    const { accessory } = buildTriggerAccessory({ triggerConfig: { type: 'contact' } });
    const switchCall = (accessory.addService as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => String(c[0]) === 'Switch',
    );
    expect(switchCall).toBeUndefined();
  });

  it('type=contact — sets ConfiguredName on service', () => {
    const { accessory } = buildTriggerAccessory({ triggerConfig: { name: 'Screen Down', type: 'contact' } });
    expect(accessory._contactService.setCharacteristic).toHaveBeenCalledWith('ConfiguredName', 'Screen Down');
  });

  it('type=contact — ContactSensorState has NO onSet handler (read-only)', () => {
    const { accessory } = buildTriggerAccessory({ triggerConfig: { type: 'contact' } });
    const csChar = accessory._contactService._getChar('ContactSensorState')!;
    expect(csChar._hasSetHandler()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ContactSensor — ContactSensorState mapping
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioTriggerAccessory — ContactSensorState mapping', () => {
  it('trigger ON → CONTACT_DETECTED (0)', () => {
    const { accessory, client } = buildTriggerAccessory({
      triggerId: 2,
      triggerConfig: { name: 'Screen Down', type: 'contact' },
    });
    client._emit('triggerState', 2, true);
    const csChar = accessory._contactService._getChar('ContactSensorState')!;
    expect(csChar._getUpdateValueMock()).toHaveBeenCalledWith(ContactSensorStateEnum.CONTACT_DETECTED, {
      source: 'stormaudio',
    });
  });

  it('trigger OFF → CONTACT_NOT_DETECTED (1)', () => {
    const { accessory, client } = buildTriggerAccessory({
      triggerId: 2,
      triggerConfig: { name: 'Screen Down', type: 'contact' },
    });
    client._emit('triggerState', 2, true);
    client._emit('triggerState', 2, false);
    const csChar = accessory._contactService._getChar('ContactSensorState')!;
    expect(csChar._getUpdateValueMock()).toHaveBeenCalledWith(ContactSensorStateEnum.CONTACT_NOT_DETECTED, {
      source: 'stormaudio',
    });
  });

  it('contact onGet when trigger is ON → CONTACT_DETECTED', () => {
    const { accessory, client } = buildTriggerAccessory({
      triggerId: 2,
      triggerConfig: { type: 'contact' },
    });
    client._emit('triggerState', 2, true);
    const csChar = accessory._contactService._getChar('ContactSensorState')!;
    expect(csChar._triggerGet()).toBe(ContactSensorStateEnum.CONTACT_DETECTED);
  });

  it('contact onGet when trigger is OFF → CONTACT_NOT_DETECTED', () => {
    const { accessory } = buildTriggerAccessory({
      triggerId: 2,
      triggerConfig: { type: 'contact' },
    });
    const csChar = accessory._contactService._getChar('ContactSensorState')!;
    expect(csChar._triggerGet()).toBe(ContactSensorStateEnum.CONTACT_NOT_DETECTED);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// triggerState filtering
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioTriggerAccessory — triggerState filtering', () => {
  it('triggerState for matching triggerId updates HomeKit', () => {
    const { accessory, client } = buildTriggerAccessory({ triggerId: 1 });
    client._emit('triggerState', 1, true);
    const onChar = accessory._switchService._getChar('On')!;
    expect(onChar._getUpdateValueMock()).toHaveBeenCalledWith(true, { source: 'stormaudio' });
  });

  it('triggerState for different triggerId — ignored, no HomeKit update', () => {
    const { accessory, client } = buildTriggerAccessory({ triggerId: 1 });
    client._emit('triggerState', 2, true);
    const onChar = accessory._switchService._getChar('On')!;
    expect(onChar._getUpdateValueMock()).not.toHaveBeenCalled();
  });

  it('trigger ON broadcast → Switch On updated to true with EXTERNAL_CONTEXT', () => {
    const { accessory, client } = buildTriggerAccessory({ triggerId: 1 });
    client._emit('triggerState', 1, true);
    const onChar = accessory._switchService._getChar('On')!;
    expect(onChar._getUpdateValueMock()).toHaveBeenCalledWith(true, { source: 'stormaudio' });
  });

  it('trigger OFF broadcast → Switch On updated to false with EXTERNAL_CONTEXT', () => {
    const { accessory, client } = buildTriggerAccessory({ triggerId: 1 });
    client._emit('triggerState', 1, false);
    const onChar = accessory._switchService._getChar('On')!;
    expect(onChar._getUpdateValueMock()).toHaveBeenCalledWith(false, { source: 'stormaudio' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Connection state — Switch
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioTriggerAccessory — connection state (switch)', () => {
  it('Switch onSet when disconnected throws HapStatusError', () => {
    const { accessory, client } = buildTriggerAccessory({ triggerId: 1 });
    client._emit('disconnected');
    const onChar = accessory._switchService._getChar('On')!;
    expect(() => onChar._triggerSet(true)).toThrow(MockHapStatusError);
    expect(client.setTrigger).not.toHaveBeenCalled();
  });

  it('Switch onGet when disconnected throws HapStatusError', () => {
    const { accessory, client } = buildTriggerAccessory({ triggerId: 1 });
    client._emit('disconnected');
    const onChar = accessory._switchService._getChar('On')!;
    expect(() => onChar._triggerGet()).toThrow(MockHapStatusError);
  });

  it('Switch reconnect restores connected — onSet works without error', () => {
    const { accessory, client } = buildTriggerAccessory({ triggerId: 1 });
    client._emit('disconnected');
    client._emit('connected');
    const onChar = accessory._switchService._getChar('On')!;
    expect(() => onChar._triggerSet(true)).not.toThrow();
    expect(client.setTrigger).toHaveBeenCalledWith(1, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Connection state — Contact sensor (read-only, no throw)
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioTriggerAccessory — connection state (contact sensor)', () => {
  it('contact onGet during disconnect returns last known state (no error)', () => {
    const { accessory, client } = buildTriggerAccessory({
      triggerId: 2,
      triggerConfig: { type: 'contact' },
    });
    client._emit('triggerState', 2, true);
    client._emit('disconnected');
    const csChar = accessory._contactService._getChar('ContactSensorState')!;
    expect(() => csChar._triggerGet()).not.toThrow();
    expect(csChar._triggerGet()).toBe(ContactSensorStateEnum.CONTACT_DETECTED);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Initial state from triggerStates
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioTriggerAccessory — initial state', () => {
  it('initial state from populated triggerStates — onGet returns true', () => {
    const triggerStates = new Map([[1, true]]);
    const { accessory } = buildTriggerAccessory({ triggerId: 1, triggerStates });
    const onChar = accessory._switchService._getChar('On')!;
    expect(onChar._triggerGet()).toBe(true);
  });

  it('initial state defaults to false when triggerStates has no entry', () => {
    const { accessory } = buildTriggerAccessory({ triggerId: 1 });
    const onChar = accessory._switchService._getChar('On')!;
    expect(onChar._triggerGet()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Listener cleanup verification
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioTriggerAccessory — listener cleanup verification', () => {
  it('registers exactly 1 "triggerState" listener per trigger accessory', () => {
    const { client } = buildTriggerAccessory({ triggerId: 1 });
    expect(client.listenerCount('triggerState')).toBe(1);
  });

  it('registers exactly 1 "disconnected" listener per trigger accessory', () => {
    const { client } = buildTriggerAccessory({ triggerId: 1 });
    expect(client.listenerCount('disconnected')).toBe(1);
  });

  it('registers exactly 1 "connected" listener per trigger accessory', () => {
    const { client } = buildTriggerAccessory({ triggerId: 1 });
    expect(client.listenerCount('connected')).toBe(1);
  });

  it('2 trigger accessories register 2 "triggerState" listeners', () => {
    // Use separate client instances for each accessory
    const client1 = createMockClient();
    const client2 = createMockClient();
    const platform = createMockPlatform();
    const acc1 = createMockAccessory({ name: 'Amp', type: 'switch' });
    const acc2 = createMockAccessory({ name: 'Screen', type: 'contact' });

    new StormAudioTriggerAccessory(platform, acc1 as never, client1 as never, 1, { name: 'Amp', type: 'switch' });
    new StormAudioTriggerAccessory(platform, acc2 as never, client1 as never, 2, { name: 'Screen', type: 'contact' });

    expect(client1.listenerCount('triggerState')).toBe(2);
    void client2; // unused, just suppressing lint
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration smoke tests
// ─────────────────────────────────────────────────────────────────────────────

describe('StormAudioTriggerAccessory — integration smoke tests', () => {
  it('QA-37: end-to-end switch lifecycle', () => {
    const { accessory, client } = buildTriggerAccessory({ triggerId: 1 });
    const onChar = accessory._switchService._getChar('On')!;

    // Set ON from HomeKit
    onChar._triggerSet(true);
    expect(client.setTrigger).toHaveBeenCalledWith(1, true);

    // Broadcast turns OFF
    client._emit('triggerState', 1, false);
    expect(onChar._getUpdateValueMock()).toHaveBeenCalledWith(false, { source: 'stormaudio' });

    // Disconnect
    client._emit('disconnected');
    expect(() => onChar._triggerSet(true)).toThrow(MockHapStatusError);

    // Reconnect
    client._emit('connected');
    (client.setTrigger as ReturnType<typeof vi.fn>).mockClear();
    onChar._triggerSet(true);
    expect(client.setTrigger).toHaveBeenCalledWith(1, true);
  });

  it('QA-38: end-to-end contact sensor lifecycle', () => {
    const { accessory, client } = buildTriggerAccessory({
      triggerId: 2,
      triggerConfig: { name: 'Screen Down', type: 'contact' },
    });
    const csChar = accessory._contactService._getChar('ContactSensorState')!;

    // Trigger ON → CONTACT_DETECTED
    client._emit('triggerState', 2, true);
    expect(csChar._getUpdateValueMock()).toHaveBeenCalledWith(ContactSensorStateEnum.CONTACT_DETECTED, {
      source: 'stormaudio',
    });

    // Trigger OFF → CONTACT_NOT_DETECTED
    client._emit('triggerState', 2, false);
    expect(csChar._getUpdateValueMock()).toHaveBeenCalledWith(ContactSensorStateEnum.CONTACT_NOT_DETECTED, {
      source: 'stormaudio',
    });

    // Disconnect — contact onGet still works
    client._emit('disconnected');
    expect(() => csChar._triggerGet()).not.toThrow();
  });
});
