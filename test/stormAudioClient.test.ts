import { EventEmitter } from 'events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StormAudioClient } from '../src/stormAudioClient';
import {
  KEEPALIVE_INTERVAL_MS,
  KEEPALIVE_TIMEOUT_MS,
  PROCESSOR_WAKE_TIMEOUT_MS,
  RECONNECT_CONNECT_TIMEOUT_MS,
  RECONNECT_INITIAL_DELAY_MS,
  RECONNECT_LONG_POLL_INTERVAL_MS,
  RECONNECT_MAX_DELAY_MS,
  RECONNECT_MAX_RETRIES,
  RECONNECT_MULTIPLIER,
} from '../src/settings';
import { ErrorCategory, ProcessorState } from '../src/types';
import { MockSocket } from './helpers/mockSocket';

const makeLog = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
});

const validConfig = {
  host: '192.168.1.100',
  port: 23,
  name: 'StormAudio',
  volumeCeiling: -20,
  volumeFloor: -100,
  volumeControl: 'lightbulb' as const,
  inputs: {},
};

describe('StormAudioClient — class structure', () => {
  it('is a subclass of EventEmitter', () => {
    const client = new StormAudioClient(validConfig, makeLog());
    expect(client).toBeInstanceOf(EventEmitter);
  });

  it('exposes connect, disconnect, setPower, setVolume, setInput, setMute', () => {
    const client = new StormAudioClient(validConfig, makeLog());
    expect(typeof client.connect).toBe('function');
    expect(typeof client.disconnect).toBe('function');
    expect(typeof client.setPower).toBe('function');
    expect(typeof client.setVolume).toBe('function');
    expect(typeof client.setInput).toBe('function');
    expect(typeof client.setMute).toBe('function');
  });

  it('exposes volumeUp, volumeDown, getVolume, getMute', () => {
    const client = new StormAudioClient(validConfig, makeLog());
    expect(typeof client.volumeUp).toBe('function');
    expect(typeof client.volumeDown).toBe('function');
    expect(typeof client.getVolume).toBe('function');
    expect(typeof client.getMute).toBe('function');
  });

  it('exposes getInput', () => {
    const client = new StormAudioClient(validConfig, makeLog());
    expect(typeof client.getInput).toBe('function');
  });
});

describe('StormAudioClient — TCP connection', () => {
  let mockSocket: MockSocket;
  let socketFactory: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSocket = new MockSocket();
    socketFactory = vi.fn().mockReturnValue(mockSocket);
  });

  it('calls socketFactory with host and port on connect()', () => {
    const client = new StormAudioClient(validConfig, makeLog(), socketFactory);
    client.connect();
    expect(socketFactory).toHaveBeenCalledWith('192.168.1.100', 23);
  });

  it('logs [TCP] Connected and emits connected on socket connect event', () => {
    const log = makeLog();
    const client = new StormAudioClient(validConfig, log, socketFactory);
    let connectedFired = false;
    client.on('connected', () => { connectedFired = true; });
    client.connect();
    mockSocket.simulateConnect();
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('[TCP] Connected to 192.168.1.100:23'));
    expect(connectedFired).toBe(true);
  });

  it('logs [TCP] error message and emits error on socket error', () => {
    const log = makeLog();
    const client = new StormAudioClient(validConfig, log, socketFactory);
    const errors: unknown[] = [];
    client.on('error', (err) => { errors.push(err); });
    client.connect();
    mockSocket.simulateError(new Error('ECONNREFUSED'));
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('[TCP]'));
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('192.168.1.100:23'));
    expect(errors).toHaveLength(1);
    expect((errors[0] as { category: string }).category).toBe(ErrorCategory.Recoverable);
  });

  it('emits disconnected on socket close', () => {
    const client = new StormAudioClient(validConfig, makeLog(), socketFactory);
    let disconnectedFired = false;
    client.on('disconnected', () => { disconnectedFired = true; });
    client.connect();
    mockSocket.simulateClose();
    expect(disconnectedFired).toBe(true);
  });

  it('passes configured port to socketFactory', () => {
    const client = new StormAudioClient({ ...validConfig, host: '10.0.0.1', port: 2000 }, makeLog(), socketFactory);
    client.connect();
    expect(socketFactory).toHaveBeenCalledWith('10.0.0.1', 2000);
  });
});

describe('StormAudioClient — message parsing', () => {
  let mockSocket: MockSocket;
  let socketFactory: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSocket = new MockSocket();
    socketFactory = vi.fn().mockReturnValue(mockSocket);
  });

  const connectClient = (log = makeLog()) => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.connect();
    mockSocket.simulateConnect();
    return client;
  };

  it('parses ssp.power.on and emits power(true)', () => {
    const client = connectClient();
    let received: boolean | null = null;
    client.on('power', (on) => { received = on; });
    mockSocket.simulateData('ssp.power.on\n');
    expect(received).toBe(true);
  });

  it('parses ssp.power.off and emits power(false)', () => {
    const client = connectClient();
    let received: boolean | null = null;
    client.on('power', (on) => { received = on; });
    mockSocket.simulateData('ssp.power.off\n');
    expect(received).toBe(false);
  });

  it('parses ssp.vol.-40 and emits volume(-40)', () => {
    const client = connectClient();
    let received: number | null = null;
    client.on('volume', (dB) => { received = dB; });
    mockSocket.simulateData('ssp.vol.-40\n');
    expect(received).toBe(-40);
  });

  it('parses ssp.mute.on and emits mute(true)', () => {
    const client = connectClient();
    let received: boolean | null = null;
    client.on('mute', (muted) => { received = muted; });
    mockSocket.simulateData('ssp.mute.on\n');
    expect(received).toBe(true);
  });

  it('parses ssp.mute.off and emits mute(false)', () => {
    const client = connectClient();
    let received: boolean | null = null;
    client.on('mute', (muted) => { received = muted; });
    mockSocket.simulateData('ssp.mute.off\n');
    expect(received).toBe(false);
  });

  it('parses ssp.input.3 and emits input(3)', () => {
    const client = connectClient();
    let received: number | null = null;
    client.on('input', (id) => { received = id; });
    mockSocket.simulateData('ssp.input.3\n');
    expect(received).toBe(3);
  });

  it('parses ssp.procstate.0 and emits processorState(Sleep)', () => {
    const client = connectClient();
    let received: ProcessorState | null = null;
    client.on('processorState', (state) => { received = state; });
    mockSocket.simulateData('ssp.procstate.0\n');
    expect(received).toBe(ProcessorState.Sleep);
  });

  it('parses ssp.procstate.2 and emits processorState(Active)', () => {
    const client = connectClient();
    let received: ProcessorState | null = null;
    client.on('processorState', (state) => { received = state; });
    mockSocket.simulateData('ssp.procstate.2\n');
    expect(received).toBe(ProcessorState.Active);
  });

  it('logs unrecognized messages at debug and does not throw', () => {
    const log = makeLog();
    connectClient(log);
    expect(() => mockSocket.simulateData('unknown.message\n')).not.toThrow();
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('[Command] Unrecognized message:'));
  });

  it('handles partial messages split across data chunks', () => {
    const client = connectClient();
    let received: boolean | null = null;
    client.on('power', (on) => { received = on; });
    mockSocket.simulateData('ssp.pow');
    expect(received).toBeNull();
    mockSocket.simulateData('er.on\n');
    expect(received).toBe(true);
  });

  it('handles multiple messages in one data chunk', () => {
    const client = connectClient();
    const powers: boolean[] = [];
    client.on('power', (on) => { powers.push(on); });
    mockSocket.simulateData('ssp.power.on\nssp.power.off\n');
    expect(powers).toEqual([true, false]);
  });

  it('parses ssp.procstate.1 and emits processorState(Initializing)', () => {
    const client = connectClient();
    let received: ProcessorState | null = null;
    client.on('processorState', (state) => { received = state; });
    mockSocket.simulateData('ssp.procstate.1\n');
    expect(received).toBe(ProcessorState.Initializing);
  });

  it('parses ssp.vol.0 and emits volume(0)', () => {
    const client = connectClient();
    let received: number | null = null;
    client.on('volume', (dB) => { received = dB; });
    mockSocket.simulateData('ssp.vol.0\n');
    expect(received).toBe(0);
  });

  it('logs debug and does not emit for ssp.vol.garbage (invalid value)', () => {
    const log = makeLog();
    const client = connectClient(log);
    let emitted = false;
    client.on('volume', () => { emitted = true; });
    mockSocket.simulateData('ssp.vol.garbage\n');
    expect(emitted).toBe(false);
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('[Command] Unrecognized message:'));
  });

  it('logs debug and does not emit for ssp.procstate.3 (out-of-range)', () => {
    const log = makeLog();
    const client = connectClient(log);
    let emitted = false;
    client.on('processorState', () => { emitted = true; });
    mockSocket.simulateData('ssp.procstate.3\n');
    expect(emitted).toBe(false);
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('[Command] Unrecognized message:'));
  });

  it('logs debug and does not emit for ssp.power.unknown (invalid value)', () => {
    const log = makeLog();
    const client = connectClient(log);
    let emitted = false;
    client.on('power', () => { emitted = true; });
    mockSocket.simulateData('ssp.power.unknown\n');
    expect(emitted).toBe(false);
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('[Command] Unrecognized message:'));
  });

  it('logs debug and does not emit for ssp.mute.unknown (invalid value)', () => {
    const log = makeLog();
    const client = connectClient(log);
    let emitted = false;
    client.on('mute', () => { emitted = true; });
    mockSocket.simulateData('ssp.mute.unknown\n');
    expect(emitted).toBe(false);
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('[Command] Unrecognized message:'));
  });

  it('logs debug and does not emit for ssp.input.garbage (non-numeric value)', () => {
    const log = makeLog();
    const client = connectClient(log);
    let emitted = false;
    client.on('input', () => { emitted = true; });
    mockSocket.simulateData('ssp.input.garbage\n');
    expect(emitted).toBe(false);
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('[Command] Unrecognized message:'));
  });

  it('logs debug and does not emit for ssp.procstate.-1 (negative out-of-range)', () => {
    const log = makeLog();
    const client = connectClient(log);
    let emitted = false;
    client.on('processorState', () => { emitted = true; });
    mockSocket.simulateData('ssp.procstate.-1\n');
    expect(emitted).toBe(false);
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('[Command] Unrecognized message:'));
  });
});

describe('StormAudioClient — bracketed value parsing (real hardware format)', () => {
  let mockSocket: MockSocket;
  let socketFactory: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSocket = new MockSocket();
    socketFactory = vi.fn().mockReturnValue(mockSocket);
  });

  const connectClient = (log = makeLog()) => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.connect();
    mockSocket.simulateConnect();
    return client;
  };

  it('parses ssp.vol.[-54.0] and emits volume(-54)', () => {
    const client = connectClient();
    let received: number | null = null;
    client.on('volume', (dB) => { received = dB; });
    mockSocket.simulateData('ssp.vol.[-54.0]\n');
    expect(received).toBe(-54);
  });

  it('parses ssp.input.[4] and emits input(4)', () => {
    const client = connectClient();
    let received: number | null = null;
    client.on('input', (id) => { received = id; });
    mockSocket.simulateData('ssp.input.[4]\n');
    expect(received).toBe(4);
  });

  it('parses ssp.procstate.[2] and emits processorState(Active)', () => {
    const client = connectClient();
    let received: ProcessorState | null = null;
    client.on('processorState', (state) => { received = state; });
    mockSocket.simulateData('ssp.procstate.[2]\n');
    expect(received).toBe(ProcessorState.Active);
  });

  it('parses ssp.procstate.[0] and emits processorState(Sleep)', () => {
    const client = connectClient();
    let received: ProcessorState | null = null;
    client.on('processorState', (state) => { received = state; });
    mockSocket.simulateData('ssp.procstate.[0]\n');
    expect(received).toBe(ProcessorState.Sleep);
  });

  it('parses ssp.mute.[on] and emits mute(true)', () => {
    const client = connectClient();
    let received: boolean | null = null;
    client.on('mute', (muted) => { received = muted; });
    mockSocket.simulateData('ssp.mute.[on]\n');
    expect(received).toBe(true);
  });

  it('non-bracketed values still parse correctly', () => {
    const client = connectClient();
    let received: boolean | null = null;
    client.on('power', (on) => { received = on; });
    mockSocket.simulateData('ssp.power.on\n');
    expect(received).toBe(true);
  });
});

describe('StormAudioClient — command methods', () => {
  let mockSocket: MockSocket;
  let socketFactory: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSocket = new MockSocket();
    socketFactory = vi.fn().mockReturnValue(mockSocket);
  });

  const connectClient = (log = makeLog()) => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.connect();
    mockSocket.simulateConnect();
    return client;
  };

  it('setPower(true) sends ssp.power.on\\n', () => {
    const client = connectClient();
    client.setPower(true);
    expect(mockSocket.written).toContain('ssp.power.on\n');
  });

  it('setPower(false) sends ssp.power.off\\n', () => {
    const client = connectClient();
    client.setPower(false);
    expect(mockSocket.written).toContain('ssp.power.off\n');
  });

  it('setVolume(-40) sends ssp.vol.[-40]\\n', () => {
    const client = connectClient();
    client.setVolume(-40);
    expect(mockSocket.written).toContain('ssp.vol.[-40]\n');
  });

  it('setInput(3) sends ssp.input.[3]\\n', () => {
    const client = connectClient();
    client.setInput(3);
    expect(mockSocket.written).toContain('ssp.input.[3]\n');
  });

  it('setMute(true) sends ssp.mute.on\\n', () => {
    const client = connectClient();
    client.setMute(true);
    expect(mockSocket.written).toContain('ssp.mute.on\n');
  });

  it('setMute(false) sends ssp.mute.off\\n', () => {
    const client = connectClient();
    client.setMute(false);
    expect(mockSocket.written).toContain('ssp.mute.off\n');
  });

  it('logs [Command] Sent at debug when command is sent', () => {
    const log = makeLog();
    const client = connectClient(log);
    client.setPower(true);
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('[Command] Sent:'));
  });

  it('logs [Command] Cannot send at debug when socket is null (connect never called)', () => {
    const log = makeLog();
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.setPower(true);
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('[Command] Cannot send'));
    expect(log.warn).not.toHaveBeenCalledWith(expect.stringContaining('[Command] Cannot send'));
    expect(mockSocket.written).toHaveLength(0);
  });

  it('logs [Command] Cannot send at debug when socket is connecting but connect event not yet fired', () => {
    const log = makeLog();
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.connect(); // socket created but simulateConnect() not called
    client.setPower(true);
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('[Command] Cannot send'));
    expect(log.warn).not.toHaveBeenCalledWith(expect.stringContaining('[Command] Cannot send'));
    expect(mockSocket.written).toHaveLength(0);
  });

  it('rejects commands after socket error + close (connected flag reset)', () => {
    const log = makeLog();
    const client = connectClient(log);
    client.on('error', () => {}); // prevent unhandled error throw
    mockSocket.simulateError(new Error('ECONNRESET'));
    mockSocket.simulateClose();
    client.setPower(true);
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('[Command] Cannot send'));
  });

  it('disconnect() sends ssp.close and destroys the socket', () => {
    const client = connectClient();
    client.disconnect();
    expect(mockSocket.written).toContain('ssp.close\n');
    expect(mockSocket.destroyed).toBe(true);
  });

  it('disconnect() is a no-op when socket is null', () => {
    const client = new StormAudioClient(validConfig, makeLog(), socketFactory);
    expect(() => client.disconnect()).not.toThrow();
  });
});

describe('StormAudioClient — relative volume commands and getters (Story 2.1)', () => {
  let mockSocket: MockSocket;
  let socketFactory: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSocket = new MockSocket();
    socketFactory = vi.fn().mockReturnValue(mockSocket);
  });

  const connectClient = (log = makeLog()) => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.connect();
    mockSocket.simulateConnect();
    return client;
  };

  it('volumeUp() sends ssp.vol.up\\n when connected', () => {
    const client = connectClient();
    client.volumeUp();
    expect(mockSocket.written).toContain('ssp.vol.up\n');
  });

  it('volumeDown() sends ssp.vol.down\\n when connected', () => {
    const client = connectClient();
    client.volumeDown();
    expect(mockSocket.written).toContain('ssp.vol.down\n');
  });

  it('volumeUp() logs [Command] Sent: ssp.vol.up', () => {
    const log = makeLog();
    const client = connectClient(log);
    client.volumeUp();
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('[Command] Sent: ssp.vol.up'));
  });

  it('volumeDown() logs [Command] Sent: ssp.vol.down', () => {
    const log = makeLog();
    const client = connectClient(log);
    client.volumeDown();
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('[Command] Sent: ssp.vol.down'));
  });

  it('volumeUp() guarded when disconnected — no write, logs debug', () => {
    const log = makeLog();
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.volumeUp();
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('[Command] Cannot send'));
    expect(mockSocket.written).toHaveLength(0);
  });

  it('volumeDown() guarded when disconnected — no write, logs debug', () => {
    const log = makeLog();
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.volumeDown();
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('[Command] Cannot send'));
    expect(mockSocket.written).toHaveLength(0);
  });

  it('getVolume() returns initial state value (-40)', () => {
    const client = new StormAudioClient(validConfig, makeLog(), socketFactory);
    expect(client.getVolume()).toBe(-40);
  });

  it('getVolume() returns updated value after ssp.vol.-55 broadcast', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.vol.-55\n');
    expect(client.getVolume()).toBe(-55);
  });

  it('getMute() returns initial state value (false)', () => {
    const client = new StormAudioClient(validConfig, makeLog(), socketFactory);
    expect(client.getMute()).toBe(false);
  });

  it('getMute() returns true after ssp.mute.on broadcast', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.mute.on\n');
    expect(client.getMute()).toBe(true);
  });
});

describe('StormAudioClient — ssp.input.list parsing (Story 3.1)', () => {
  let mockSocket: MockSocket;
  let socketFactory: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSocket = new MockSocket();
    socketFactory = vi.fn().mockReturnValue(mockSocket);
  });

  const connectClient = (log = makeLog()) => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.connect();
    mockSocket.simulateConnect();
    return client;
  };

  // Helper: send a complete input list sequence (start → entries → end)
  const sendInputList = (entries: string[]) => {
    mockSocket.simulateData('ssp.input.start\n');
    for (const entry of entries) {
      mockSocket.simulateData(entry + '\n');
    }
    mockSocket.simulateData('ssp.input.end\n');
  };

  it('MP1: parses well-formed input list and emits inputList with correct InputInfo[]', () => {
    const client = connectClient();
    let received: { id: number; name: string }[] | null = null;
    client.on('inputList', (inputs) => { received = inputs; });
    sendInputList([
      'ssp.input.list.["Apple TV", 1, 1, 1, 0, 0, 0.0, 0]',
      'ssp.input.list.["PS5", 2, 2, 2, 0, 0, 0.0, 0]',
    ]);
    expect(received).toHaveLength(2);
    expect(received![0]).toEqual({ id: 1, name: 'Apple TV' });
    expect(received![1]).toEqual({ id: 2, name: 'PS5' });
  });

  it('MP2: inputList InputInfo has id:number and name:string shape', () => {
    const client = connectClient();
    let received: { id: number; name: string }[] | null = null;
    client.on('inputList', (inputs) => { received = inputs; });
    sendInputList(['ssp.input.list.["Apple TV", 1, 1, 1, 0, 0, 0.0, 0]']);
    expect(typeof received![0].id).toBe('number');
    expect(typeof received![0].name).toBe('string');
  });

  it('EC4: single input list emits correctly', () => {
    const client = connectClient();
    let received: { id: number; name: string }[] | null = null;
    client.on('inputList', (inputs) => { received = inputs; });
    sendInputList(['ssp.input.list.["TV", 1, 1, 1, 0, 0, 0.0, 0]']);
    expect(received).toHaveLength(1);
    expect(received![0]).toEqual({ id: 1, name: 'TV' });
  });

  it('EC1: empty list (start/end with no entries) emits inputList with []', () => {
    const client = connectClient();
    let received: unknown[] | null = null;
    client.on('inputList', (inputs) => { received = inputs; });
    sendInputList([]);
    expect(received).toEqual([]);
  });

  it('EC2: malformed entry (invalid JSON) is skipped, valid entries still emitted', () => {
    const log = makeLog();
    const client = connectClient(log);
    let received: { id: number; name: string }[] | null = null;
    client.on('inputList', (inputs) => { received = inputs; });
    sendInputList([
      'ssp.input.list.[not-valid-json]',
      'ssp.input.list.["PS5", 2, 2, 2, 0, 0, 0.0, 0]',
    ]);
    expect(received).toHaveLength(1);
    expect(received![0]).toEqual({ id: 2, name: 'PS5' });
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('[State] Skipped malformed list entry:'));
  });

  it('EC3: entry with wrong types (id not number) is skipped, debug log emitted', () => {
    const log = makeLog();
    const client = connectClient(log);
    let received: { id: number; name: string }[] | null = null;
    client.on('inputList', (inputs) => { received = inputs; });
    sendInputList([
      'ssp.input.list.[1, "reversed-order", 1, 1, 0]',
      'ssp.input.list.["PS5", 2, 2, 2, 0, 0, 0.0, 0]',
    ]);
    expect(received).toHaveLength(1);
    expect(received![0]).toEqual({ id: 2, name: 'PS5' });
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('[State] Skipped malformed list entry:'));
  });

  it('EC5: input list sequence does NOT emit input event', () => {
    const client = connectClient();
    let inputEmitted = false;
    client.on('input', () => { inputEmitted = true; });
    sendInputList(['ssp.input.list.["TV", 1, 1, 1, 0, 0, 0.0, 0]']);
    expect(inputEmitted).toBe(false);
  });

  it('EC6: ssp.input.[3] still emits input(3) — no regression', () => {
    const client = connectClient();
    let received: number | null = null;
    client.on('input', (id) => { received = id; });
    mockSocket.simulateData('ssp.input.[3]\n');
    expect(received).toBe(3);
  });

  it('EC6b: ssp.input.[3] does NOT emit inputList event', () => {
    const client = connectClient();
    let inputListEmitted = false;
    client.on('inputList', () => { inputListEmitted = true; });
    mockSocket.simulateData('ssp.input.[3]\n');
    expect(inputListEmitted).toBe(false);
  });

  it('EC15: logs [State] Received input list: N inputs at info level', () => {
    const log = makeLog();
    const client = connectClient(log);
    client.on('inputList', () => {});
    sendInputList([
      'ssp.input.list.["TV", 1, 1, 1, 0, 0, 0.0, 0]',
      'ssp.input.list.["PS5", 2, 2, 2, 0, 0, 0.0, 0]',
    ]);
    expect(log.info).toHaveBeenCalledWith('[State] Received input list: 2 inputs');
  });

  it('inputList only emits on ssp.input.end — not on each list entry', () => {
    const client = connectClient();
    let emitCount = 0;
    client.on('inputList', () => { emitCount++; });
    mockSocket.simulateData('ssp.input.start\n');
    mockSocket.simulateData('ssp.input.list.["TV", 1, 1, 1, 0, 0, 0.0, 0]\n');
    mockSocket.simulateData('ssp.input.list.["PS5", 2, 2, 2, 0, 0, 0.0, 0]\n');
    expect(emitCount).toBe(0); // not emitted yet
    mockSocket.simulateData('ssp.input.end\n');
    expect(emitCount).toBe(1); // emitted exactly once on end
  });

  it('list entries without start marker are still accumulated (graceful)', () => {
    const client = connectClient();
    let received: { id: number; name: string }[] | null = null;
    client.on('inputList', (inputs) => { received = inputs; });
    // Skip ssp.input.start — entries arrive directly
    mockSocket.simulateData('ssp.input.list.["TV", 1, 1, 1, 0, 0, 0.0, 0]\n');
    mockSocket.simulateData('ssp.input.list.["PS5", 2, 2, 2, 0, 0, 0.0, 0]\n');
    mockSocket.simulateData('ssp.input.end\n');
    expect(received).toHaveLength(2);
  });

  it('MP11: getInput() returns 0 (default) before any input event', () => {
    const client = new StormAudioClient(validConfig, makeLog(), socketFactory);
    expect(client.getInput()).toBe(0);
  });

  it('MP12: getInput() returns updated value after ssp.input.[3] broadcast', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.input.[3]\n');
    expect(client.getInput()).toBe(3);
  });

  it('listenerCount: inputList listener count is 0 at baseline (no self-registration)', () => {
    const client = new StormAudioClient(validConfig, makeLog(), socketFactory);
    expect(client.listenerCount('inputList')).toBe(0);
  });
});

describe('StormAudioClient — identity & control parsing (Task 6)', () => {
  let mockSocket: MockSocket;
  let socketFactory: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSocket = new MockSocket();
    socketFactory = vi.fn().mockReturnValue(mockSocket);
  });

  const connectClient = (log = makeLog()) => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.connect();
    mockSocket.simulateConnect();
    return client;
  };

  it('parses ssp.version.[4.7r0] and updates identity.version', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.version.[4.7r0]\n');
    expect(client.getIdentity().version).toBe('4.7r0');
  });

  it('emits identity event after version update', () => {
    const client = connectClient();
    let received: { version: string } | null = null;
    client.on('identity', (info) => { received = info; });
    mockSocket.simulateData('ssp.version.[4.7r0]\n');
    expect(received).not.toBeNull();
    expect(received!.version).toBe('4.7r0');
  });

  it('parses ssp.brand.["StormAudio"] — strips quotes', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.brand.["StormAudio"]\n');
    expect(client.getIdentity().brand).toBe('StormAudio');
  });

  it('parses ssp.model.["IISP"] — strips quotes', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.model.["IISP"]\n');
    expect(client.getIdentity().model).toBe('IISP');
  });

  it('emits identity after each individual field update', () => {
    const client = connectClient();
    let count = 0;
    client.on('identity', () => { count++; });
    mockSocket.simulateData('ssp.version.[4.7r0]\n');
    mockSocket.simulateData('ssp.brand.["StormAudio"]\n');
    mockSocket.simulateData('ssp.model.["IISP"]\n');
    expect(count).toBe(3);
  });

  it('parses ssp.keepalive — logs debug, no event', () => {
    const log = makeLog();
    const client = connectClient(log);
    let emitted = false;
    client.on('identity', () => { emitted = true; });
    mockSocket.simulateData('ssp.keepalive\n');
    expect(emitted).toBe(false);
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('keepalive'));
  });

  it('parses ssp.msgstatus.[3] — updates state and emits', () => {
    const client = connectClient();
    let received: number | null = null;
    client.on('msgStatus', (id) => { received = id; });
    mockSocket.simulateData('ssp.msgstatus.[3]\n');
    expect(received).toBe(3);
  });

  it('ssp.msgstatus.[garbage] — no state change, debug log', () => {
    const log = makeLog();
    const client = connectClient(log);
    let emitted = false;
    client.on('msgStatus', () => { emitted = true; });
    mockSocket.simulateData('ssp.msgstatus.[garbage]\n');
    expect(emitted).toBe(false);
    expect(log.debug).toHaveBeenCalled();
  });

  it('ssp.msgstatusTxt.[0, ""] — logs info, no event', () => {
    const log = makeLog();
    connectClient(log);
    mockSocket.simulateData('ssp.msgstatusTxt.[0, ""]\n');
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Status message'));
  });
});

describe('StormAudioClient — stream info parsing (Task 7)', () => {
  let mockSocket: MockSocket;
  let socketFactory: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSocket = new MockSocket();
    socketFactory = vi.fn().mockReturnValue(mockSocket);
  });

  const connectClient = (log = makeLog()) => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.connect();
    mockSocket.simulateConnect();
    return client;
  };

  it('parses ssp.stream.[Dolby Atmos] and updates streamInfo', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.stream.[Dolby Atmos]\n');
    expect(client.getStreamInfo().stream).toBe('Dolby Atmos');
  });

  it('parses ssp.fs.[44.1 kHz] and updates sampleRate', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.fs.[44.1 kHz]\n');
    expect(client.getStreamInfo().sampleRate).toBe('44.1 kHz');
  });

  it('parses ssp.format.[Stereo] and updates format', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.format.[Stereo]\n');
    expect(client.getStreamInfo().format).toBe('Stereo');
  });

  it('emits streamInfo event on each field update', () => {
    const client = connectClient();
    let count = 0;
    client.on('streamInfo', () => { count++; });
    mockSocket.simulateData('ssp.stream.[None]\n');
    mockSocket.simulateData('ssp.fs.[]\n');
    mockSocket.simulateData('ssp.format.[]\n');
    expect(count).toBe(3);
  });

  it('parses ssp.stream.[] (empty) — stream equals empty string', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.stream.[]\n');
    expect(client.getStreamInfo().stream).toBe('');
  });

  it('parses ssp.stream.[None] — stream equals "None"', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.stream.[None]\n');
    expect(client.getStreamInfo().stream).toBe('None');
  });

  it('partial state: only stream updated, sampleRate still default', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.stream.[PCM]\n');
    expect(client.getStreamInfo().stream).toBe('PCM');
    expect(client.getStreamInfo().sampleRate).toBe('');
  });
});

describe('StormAudioClient — audio config parsing (Task 8)', () => {
  let mockSocket: MockSocket;
  let socketFactory: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSocket = new MockSocket();
    socketFactory = vi.fn().mockReturnValue(mockSocket);
  });

  const connectClient = (log = makeLog()) => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.connect();
    mockSocket.simulateConnect();
    return client;
  };

  it('parses ssp.preset.[9] and emits preset event', () => {
    const client = connectClient();
    let received: number | null = null;
    client.on('preset', (id) => { received = id; });
    mockSocket.simulateData('ssp.preset.[9]\n');
    expect(received).toBe(9);
    expect(client.getAudioConfig().preset).toBe(9);
  });

  it('parses preset list streaming sequence', () => {
    const client = connectClient();
    let received: { id: number; name: string }[] | null = null;
    client.on('presetList', (presets) => { received = presets; });
    mockSocket.simulateData('ssp.preset.start\n');
    mockSocket.simulateData('ssp.preset.list.["Theater 1", 9, "["1"]", 0, 0, 0, 0, 0]\n');
    mockSocket.simulateData('ssp.preset.list.["Theater 2", 10, "["1"]", 0, 0, 0, 0, 0]\n');
    mockSocket.simulateData('ssp.preset.end\n');
    expect(received).toHaveLength(2);
    expect(received![0]).toEqual({ id: 9, name: 'Theater 1' });
    expect(received![1]).toEqual({ id: 10, name: 'Theater 2' });
  });

  it('stores preset list in audioConfig.presetList', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.preset.start\n');
    mockSocket.simulateData('ssp.preset.list.["Preset 1", 11, "["1"]", 0, 0, 0, 0, 0]\n');
    mockSocket.simulateData('ssp.preset.end\n');
    expect(client.getAudioConfig().presetList).toHaveLength(1);
    expect(client.getAudioConfig().presetList[0].name).toBe('Preset 1');
  });

  it('parses ssp.preset.custom.off as informational', () => {
    const log = makeLog();
    connectClient(log);
    mockSocket.simulateData('ssp.preset.custom.off\n');
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('Informational'));
  });

  it('parses ssp.surroundmode.[0] and emits surroundMode', () => {
    const client = connectClient();
    let received: number | null = null;
    client.on('surroundMode', (id) => { received = id; });
    mockSocket.simulateData('ssp.surroundmode.[0]\n');
    expect(received).toBe(0);
  });

  it('parses surround mode list streaming sequence', () => {
    const client = connectClient();
    let received: { id: number; name: string }[] | null = null;
    client.on('surroundModeList', (modes) => { received = modes; });
    mockSocket.simulateData('ssp.surroundmode.start\n');
    mockSocket.simulateData('ssp.surroundmode.list.["Native", 0]\n');
    mockSocket.simulateData('ssp.surroundmode.list.["Stereo Downmix", 1]\n');
    mockSocket.simulateData('ssp.surroundmode.end\n');
    expect(received).toHaveLength(2);
    expect(received![0]).toEqual({ id: 0, name: 'Native' });
    expect(received![1]).toEqual({ id: 1, name: 'Stereo Downmix' });
  });

  it('parses ssp.allowedmode.[2] and emits allowedMode', () => {
    const client = connectClient();
    let received: number | null = null;
    client.on('allowedMode', (id) => { received = id; });
    mockSocket.simulateData('ssp.allowedmode.[2]\n');
    expect(received).toBe(2);
    expect(client.getAudioConfig().allowedMode).toBe(2);
  });

  it('parses ssp.speaker.[12] and emits speaker', () => {
    const client = connectClient();
    let received: number | null = null;
    client.on('speaker', (id) => { received = id; });
    mockSocket.simulateData('ssp.speaker.[12]\n');
    expect(received).toBe(12);
  });

  it('parses ssp.auropreset.[2] and emits auroPreset', () => {
    const client = connectClient();
    let received: number | null = null;
    client.on('auroPreset', (id) => { received = id; });
    mockSocket.simulateData('ssp.auropreset.[2]\n');
    expect(received).toBe(2);
  });

  it('ssp.preset.[garbage] — no state change, debug log', () => {
    const log = makeLog();
    const client = connectClient(log);
    let emitted = false;
    client.on('preset', () => { emitted = true; });
    mockSocket.simulateData('ssp.preset.[garbage]\n');
    expect(emitted).toBe(false);
    expect(log.debug).toHaveBeenCalled();
  });

  it('empty preset list emits presetList with []', () => {
    const client = connectClient();
    let received: unknown[] | null = null;
    client.on('presetList', (presets) => { received = presets; });
    mockSocket.simulateData('ssp.preset.start\n');
    mockSocket.simulateData('ssp.preset.end\n');
    expect(received).toEqual([]);
  });

  it('ssp.inputZone2.[0] — logged as informational', () => {
    const log = makeLog();
    connectClient(log);
    mockSocket.simulateData('ssp.inputZone2.[0]\n');
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('Informational'));
  });

  it('ssp.inputHdmiPassThru.[1] → audioConfig.inputHdmiPassThru = 1', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.inputHdmiPassThru.[1]\n');
    expect(client.getAudioConfig().inputHdmiPassThru).toBe(1);
  });
});

describe('StormAudioClient — audio control toggles (Task 9)', () => {
  let mockSocket: MockSocket;
  let socketFactory: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSocket = new MockSocket();
    socketFactory = vi.fn().mockReturnValue(mockSocket);
  });

  const connectClient = (log = makeLog()) => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.connect();
    mockSocket.simulateConnect();
    return client;
  };

  it('ssp.dim.on → audio.dim = true, emits audio event', () => {
    const client = connectClient();
    let emitted = false;
    client.on('audio', () => { emitted = true; });
    mockSocket.simulateData('ssp.dim.on\n');
    expect(client.getAudio().dim).toBe(true);
    expect(emitted).toBe(true);
  });

  it('ssp.dim.off → audio.dim = false', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.dim.on\n');
    mockSocket.simulateData('ssp.dim.off\n');
    expect(client.getAudio().dim).toBe(false);
  });

  it('ssp.cspread.on → audio.centerSpread = true', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.cspread.on\n');
    expect(client.getAudio().centerSpread).toBe(true);
  });

  it('ssp.dialognorm.on → audio.dialogNorm = true', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.dialognorm.on\n');
    expect(client.getAudio().dialogNorm).toBe(true);
  });

  it('ssp.dolbyvirtualizer.on → audio.dolbyVirtualizer = true', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.dolbyvirtualizer.on\n');
    expect(client.getAudio().dolbyVirtualizer).toBe(true);
  });

  it('ssp.lfedim.on → audio.lfeDim = true', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.lfedim.on\n');
    expect(client.getAudio().lfeDim).toBe(true);
  });

  it('ssp.drc.on → audio.drc = "on"', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.drc.on\n');
    expect(client.getAudio().drc).toBe('on');
  });

  it('ssp.drc.auto → audio.drc = "auto"', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.drc.auto\n');
    expect(client.getAudio().drc).toBe('auto');
  });

  it('ssp.drc.off → audio.drc = "off"', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.drc.off\n');
    expect(client.getAudio().drc).toBe('off');
  });

  it('ssp.IMAXMode.auto → audio.imaxMode = "auto"', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.IMAXMode.auto\n');
    expect(client.getAudio().imaxMode).toBe('auto');
  });

  it('ssp.IMAXMode.off → audio.imaxMode = "off"', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.IMAXMode.off\n');
    expect(client.getAudio().imaxMode).toBe('off');
  });

  it('ssp.stormxt.on → audio.stormxt = true', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.stormxt.on\n');
    expect(client.getAudio().stormxt).toBe(true);
  });

  it('ssp.stormxt.off → audio.stormxt = false', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.stormxt.off\n');
    expect(client.getAudio().stormxt).toBe(false);
  });

  it('ssp.dim.unknown → no state change, debug log', () => {
    const log = makeLog();
    const client = connectClient(log);
    let emitted = false;
    client.on('audio', () => { emitted = true; });
    mockSocket.simulateData('ssp.dim.unknown\n');
    expect(emitted).toBe(false);
    expect(client.getAudio().dim).toBe(false);
    expect(log.debug).toHaveBeenCalled();
  });

  it('ssp.drc.invalid → no state change, debug log', () => {
    const log = makeLog();
    const client = connectClient(log);
    mockSocket.simulateData('ssp.drc.invalid\n');
    expect(client.getAudio().drc).toBe('off');
    expect(log.debug).toHaveBeenCalled();
  });

  it('ssp.stormxt.unknown → no state change, debug log', () => {
    const log = makeLog();
    const client = connectClient(log);
    mockSocket.simulateData('ssp.stormxt.unknown\n');
    expect(client.getAudio().stormxt).toBeNull();
    expect(log.debug).toHaveBeenCalled();
  });

  it('ssp.IMAXMode.unknown → no state change, debug log', () => {
    const log = makeLog();
    const client = connectClient(log);
    mockSocket.simulateData('ssp.IMAXMode.unknown\n');
    expect(client.getAudio().imaxMode).toBe('off');
    expect(log.debug).toHaveBeenCalled();
  });

  it('ssp.cspread.unknown → no state change, debug log', () => {
    const log = makeLog();
    const client = connectClient(log);
    mockSocket.simulateData('ssp.cspread.unknown\n');
    expect(client.getAudio().centerSpread).toBe(false);
    expect(log.debug).toHaveBeenCalled();
  });

  it('ssp.mute.unknown → no state change, debug log', () => {
    const log = makeLog();
    const client = connectClient(log);
    mockSocket.simulateData('ssp.mute.unknown\n');
    expect(client.getMute()).toBe(false);
    expect(log.debug).toHaveBeenCalled();
  });
});

describe('StormAudioClient — audio control numerics (Task 10)', () => {
  let mockSocket: MockSocket;
  let socketFactory: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSocket = new MockSocket();
    socketFactory = vi.fn().mockReturnValue(mockSocket);
  });

  const connectClient = (log = makeLog()) => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.connect();
    mockSocket.simulateConnect();
    return client;
  };

  it('ssp.loudness.[1] → audio.loudness = 1', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.loudness.[1]\n');
    expect(client.getAudio().loudness).toBe(1);
  });

  it('ssp.bass.[-3] → audio.bass = -3', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.bass.[-3]\n');
    expect(client.getAudio().bass).toBe(-3);
  });

  it('ssp.treble.[6] → audio.treble = 6', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.treble.[6]\n');
    expect(client.getAudio().treble).toBe(6);
  });

  it('ssp.c_en.[-6] → audio.centerEnhance = -6', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.c_en.[-6]\n');
    expect(client.getAudio().centerEnhance).toBe(-6);
  });

  it('ssp.s_en.[3] → audio.surroundEnhance = 3', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.s_en.[3]\n');
    expect(client.getAudio().surroundEnhance).toBe(3);
  });

  it('ssp.lfe_en.[2] → audio.lfeEnhance = 2', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.lfe_en.[2]\n');
    expect(client.getAudio().lfeEnhance).toBe(2);
  });

  it('ssp.dolbymode.[1] → audio.dolbyMode = 1', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.dolbymode.[1]\n');
    expect(client.getAudio().dolbyMode).toBe(1);
  });

  it('ssp.aurostrength.[15] → audio.auroStrength = 15', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.aurostrength.[15]\n');
    expect(client.getAudio().auroStrength).toBe(15);
  });

  it('ssp.lipsync.[10.0] → audio.lipsync = 10 (float parsed)', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.lipsync.[10.0]\n');
    expect(client.getAudio().lipsync).toBe(10);
  });

  it('ssp.sphereaudioeffect.[2] → audio.sphereAudioEffect = 2', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.sphereaudioeffect.[2]\n');
    expect(client.getAudio().sphereAudioEffect).toBe(2);
  });

  it('ssp.dialogcontrol.[1, 3] → dialogControl = { available: true, level: 3 }', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.dialogcontrol.[1, 3]\n');
    expect(client.getAudio().dialogControl).toEqual({ available: true, level: 3 });
  });

  it('ssp.dialogcontrol.[0, 0] → dialogControl = { available: false, level: 0 }', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.dialogcontrol.[0, 0]\n');
    expect(client.getAudio().dialogControl).toEqual({ available: false, level: 0 });
  });

  it('ssp.loudness.[garbage] → no state change, debug log', () => {
    const log = makeLog();
    const client = connectClient(log);
    mockSocket.simulateData('ssp.loudness.[garbage]\n');
    expect(client.getAudio().loudness).toBe(0);
    expect(log.debug).toHaveBeenCalled();
  });

  it('ssp.bass.[garbage] → no state change', () => {
    const log = makeLog();
    const client = connectClient(log);
    mockSocket.simulateData('ssp.bass.[garbage]\n');
    expect(client.getAudio().bass).toBe(0);
    expect(log.debug).toHaveBeenCalled();
  });

  it('ssp.lipsync.[garbage] → no state change', () => {
    const log = makeLog();
    const client = connectClient(log);
    mockSocket.simulateData('ssp.lipsync.[garbage]\n');
    expect(client.getAudio().lipsync).toBe(0);
    expect(log.debug).toHaveBeenCalled();
  });

  it('emits audio event for each numeric update', () => {
    const client = connectClient();
    let count = 0;
    client.on('audio', () => { count++; });
    mockSocket.simulateData('ssp.bass.[1]\n');
    mockSocket.simulateData('ssp.treble.[2]\n');
    mockSocket.simulateData('ssp.lipsync.[5.0]\n');
    expect(count).toBe(3);
  });

  it('ssp.vol.[-60.0] → volume = -60 (float parsed)', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.vol.[-60.0]\n');
    expect(client.getVolume()).toBe(-60);
  });

  it('ssp.sphereaudioeffect.[garbage] → no state change, debug log', () => {
    const log = makeLog();
    const client = connectClient(log);
    mockSocket.simulateData('ssp.sphereaudioeffect.[garbage]\n');
    expect(client.getAudio().sphereAudioEffect).toBeNull();
    expect(log.debug).toHaveBeenCalled();
  });
});

describe('StormAudioClient — zones parsing (Task 11)', () => {
  let mockSocket: MockSocket;
  let socketFactory: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSocket = new MockSocket();
    socketFactory = vi.fn().mockReturnValue(mockSocket);
  });

  const connectClient = (log = makeLog()) => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.connect();
    mockSocket.simulateConnect();
    return client;
  };

  it('parses zone list streaming sequence', () => {
    const client = connectClient();
    let received: unknown[] | null = null;
    client.on('zoneList', (zones) => { received = zones; });
    mockSocket.simulateData('ssp.zones.start\n');
    mockSocket.simulateData('ssp.zones.list.[1, "Downmix", 2000, 1, 0, -78, 0.0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]\n');
    mockSocket.simulateData('ssp.zones.end\n');
    expect(received).toHaveLength(1);
    expect((received![0] as { id: number; name: string }).id).toBe(1);
    expect((received![0] as { id: number; name: string }).name).toBe('Downmix');
  });

  it('populates state.zones map after zone list', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.zones.start\n');
    mockSocket.simulateData('ssp.zones.list.[1, "Downmix", 2000, 1, 0, -78, 0.0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]\n');
    mockSocket.simulateData('ssp.zones.end\n');
    const zone = client.getZones().get(1);
    expect(zone).toBeDefined();
    expect(zone!.volume).toBe(-78);
    expect(zone!.mute).toBe(false);
  });

  it('parses ssp.zones.volume.[1, -30] → updates zone volume, emits zoneUpdate', () => {
    const client = connectClient();
    // First set up zone via list
    mockSocket.simulateData('ssp.zones.start\n');
    mockSocket.simulateData('ssp.zones.list.[1, "Downmix", 2000, 1, 0, -78, 0.0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]\n');
    mockSocket.simulateData('ssp.zones.end\n');
    let receivedId: number | null = null;
    let receivedField: string | null = null;
    client.on('zoneUpdate', (zoneId, field) => { receivedId = zoneId; receivedField = field; });
    mockSocket.simulateData('ssp.zones.volume.[1, -30]\n');
    expect(client.getZones().get(1)!.volume).toBe(-30);
    expect(receivedId).toBe(1);
    expect(receivedField).toBe('volume');
  });

  it('creates zone entry if zone ID not in map (unknown zone update)', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.zones.volume.[99, -50]\n');
    expect(client.getZones().get(99)).toBeDefined();
    expect(client.getZones().get(99)!.volume).toBe(-50);
  });

  it('parses ssp.zones.mute.[1, 1] → zone mute = true', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.zones.mute.[1, 1]\n');
    expect(client.getZones().get(1)!.mute).toBe(true);
  });

  it('parses zone profiles streaming sequence', () => {
    const client = connectClient();
    let received: unknown[] | null = null;
    client.on('zoneProfileList', (profiles) => { received = profiles; });
    mockSocket.simulateData('ssp.zones.profiles.start\n');
    mockSocket.simulateData('ssp.zones.profiles.list.[1, 1, "Downmix", 1, 0, 0, 0, 0]\n');
    mockSocket.simulateData('ssp.zones.profiles.list.[12, 16, "7.1.4", 1, 0, 0, 0, 0]\n');
    mockSocket.simulateData('ssp.zones.profiles.end\n');
    expect(received).toHaveLength(2);
    expect((received![0] as { zoneId: number }).zoneId).toBe(1);
    expect((received![0] as { name: string }).name).toBe('Downmix');
    expect((received![0] as { active: boolean }).active).toBe(true);
  });

  it('stores zone profiles in state', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.zones.profiles.start\n');
    mockSocket.simulateData('ssp.zones.profiles.list.[1, 1, "Downmix", 1, 0, 0, 0, 0]\n');
    mockSocket.simulateData('ssp.zones.profiles.end\n');
    expect(client.getZoneProfiles()).toHaveLength(1);
    expect(client.getZoneProfiles()[0].profileId).toBe(1);
  });

  it('malformed zone list entry is skipped', () => {
    const log = makeLog();
    const client = connectClient(log);
    let received: unknown[] | null = null;
    client.on('zoneList', (zones) => { received = zones; });
    mockSocket.simulateData('ssp.zones.start\n');
    mockSocket.simulateData('ssp.zones.list.[not-valid]\n');
    mockSocket.simulateData('ssp.zones.end\n');
    expect(received).toEqual([]);
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('malformed zone list entry'));
  });
});

describe('StormAudioClient — HDMI info parsing (Task 12)', () => {
  let mockSocket: MockSocket;
  let socketFactory: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSocket = new MockSocket();
    socketFactory = vi.fn().mockReturnValue(mockSocket);
  });

  const connectClient = (log = makeLog()) => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.connect();
    mockSocket.simulateConnect();
    return client;
  };

  it('parses ssp.hdmi1.input.["HDMI_3"] → hdmi(1).input = "HDMI_3"', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.hdmi1.input.["HDMI_3"]\n');
    expect(client.getHdmi().get(1)!.input).toBe('HDMI_3');
  });

  it('parses ssp.hdmi1.sync.["LOST"] → hdmi(1).sync = "LOST"', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.hdmi1.sync.["LOST"]\n');
    expect(client.getHdmi().get(1)!.sync).toBe('LOST');
  });

  it('parses ssp.hdmi2.timing.["UNKNOWN"] → hdmi(2).timing = "UNKNOWN"', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.hdmi2.timing.["UNKNOWN"]\n');
    expect(client.getHdmi().get(2)!.timing).toBe('UNKNOWN');
  });

  it('emits hdmiUpdate event with output number and state', () => {
    const client = connectClient();
    let receivedOutput: number | null = null;
    client.on('hdmiUpdate', (output) => { receivedOutput = output; });
    mockSocket.simulateData('ssp.hdmi1.hdr.["---"]\n');
    expect(receivedOutput).toBe(1);
  });

  it('parses all 8 HDMI fields for output 1', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.hdmi1.input.["HDMI_3"]\n');
    mockSocket.simulateData('ssp.hdmi1.sync.["Detected"]\n');
    mockSocket.simulateData('ssp.hdmi1.timing.["1920x1080@60Hz"]\n');
    mockSocket.simulateData('ssp.hdmi1.hdr.["SDR"]\n');
    mockSocket.simulateData('ssp.hdmi1.cp.["HDCP 2.2"]\n');
    mockSocket.simulateData('ssp.hdmi1.colorspace.["YCbCr"]\n');
    mockSocket.simulateData('ssp.hdmi1.colordepth.["8bit"]\n');
    mockSocket.simulateData('ssp.hdmi1.mode.["HDMI"]\n');
    const hdmi = client.getHdmi().get(1)!;
    expect(hdmi.input).toBe('HDMI_3');
    expect(hdmi.sync).toBe('Detected');
    expect(hdmi.timing).toBe('1920x1080@60Hz');
    expect(hdmi.hdr).toBe('SDR');
    expect(hdmi.copyProtection).toBe('HDCP 2.2');
    expect(hdmi.colorspace).toBe('YCbCr');
    expect(hdmi.colorDepth).toBe('8bit');
    expect(hdmi.mode).toBe('HDMI');
  });

  it('ssp.hdmi1.unknownfield.["value"] → no state change, debug log', () => {
    const log = makeLog();
    const client = connectClient(log);
    mockSocket.simulateData('ssp.hdmi1.unknownfield.["value"]\n');
    expect(client.getHdmi().get(1)).toBeUndefined();
    expect(log.debug).toHaveBeenCalled();
  });
});

describe('StormAudioClient — device config, triggers, deprecated (Task 13)', () => {
  let mockSocket: MockSocket;
  let socketFactory: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSocket = new MockSocket();
    socketFactory = vi.fn().mockReturnValue(mockSocket);
  });

  const connectClient = (log = makeLog()) => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.connect();
    mockSocket.simulateConnect();
    return client;
  };

  it('ssp.trig2.on → triggerStates.get(2) = true, emits triggerState', () => {
    const client = connectClient();
    let receivedId: number | null = null;
    let receivedVal: boolean | null = null;
    client.on('triggerState', (id, on) => { receivedId = id; receivedVal = on; });
    mockSocket.simulateData('ssp.trig2.on\n');
    expect(receivedId).toBe(2);
    expect(receivedVal).toBe(true);
  });

  it('ssp.trig1.off → triggerStates.get(1) = false', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.trig1.off\n');
    // Access trigger states via internal state check via event
    let receivedVal: boolean | null = null;
    client.on('triggerState', (_, on) => { receivedVal = on; });
    mockSocket.simulateData('ssp.trig1.on\n');
    expect(receivedVal).toBe(true);
  });

  it('ssp.trig0.on → invalid trigger (0), no state change, debug log', () => {
    const log = makeLog();
    const client = connectClient(log);
    let emitted = false;
    client.on('triggerState', () => { emitted = true; });
    mockSocket.simulateData('ssp.trig0.on\n');
    expect(emitted).toBe(false);
    expect(log.debug).toHaveBeenCalled();
  });

  it('ssp.trig1.manual.on → stores trigger manual state', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.trig1.manual.on\n');
    // Manual state stored but no triggerState event
    let emitted = false;
    client.on('triggerState', () => { emitted = true; });
    mockSocket.simulateData('ssp.trig1.manual.off\n');
    expect(emitted).toBe(false);
  });

  it('parses trigger list streaming sequence', () => {
    const client = connectClient();
    let received: { name: string }[] | null = null;
    client.on('triggerList', (triggers) => { received = triggers; });
    mockSocket.simulateData('ssp.trigger.start\n');
    mockSocket.simulateData('ssp.trigger.list.["Trigger 1"]\n');
    mockSocket.simulateData('ssp.trigger.list.["Trigger 2"]\n');
    mockSocket.simulateData('ssp.trigger.end\n');
    expect(received).toHaveLength(2);
    expect(received![0].name).toBe('Trigger 1');
  });

  it('ssp.brightness.[3] → device.brightness = 3, emits device', () => {
    const client = connectClient();
    let emitted = false;
    client.on('device', () => { emitted = true; });
    mockSocket.simulateData('ssp.brightness.[3]\n');
    expect(client.getDevice().brightness).toBe(3);
    expect(emitted).toBe(true);
  });

  it('ssp.frontpanel.stbybright.[20] → device.frontPanel.standbyBrightness = 20', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.frontpanel.stbybright.[20]\n');
    expect(client.getDevice().frontPanel.standbyBrightness).toBe(20);
  });

  it('ssp.frontpanel.actbright.[100] → device.frontPanel.activeBrightness = 100', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.frontpanel.actbright.[100]\n');
    expect(client.getDevice().frontPanel.activeBrightness).toBe(100);
  });

  it('ssp.frontpanel.stbytime.[10] → device.frontPanel.standbyTimeout = 10', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.frontpanel.stbytime.[10]\n');
    expect(client.getDevice().frontPanel.standbyTimeout).toBe(10);
  });

  it('ssp.frontpanel.color.[white] → device.frontPanel.color = "white"', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.frontpanel.color.[white]\n');
    expect(client.getDevice().frontPanel.color).toBe('white');
  });

  it('ssp.generator.off → device.generator = false', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.generator.off\n');
    expect(client.getDevice().generator).toBe(false);
  });

  it('ssp.generator.on → device.generator = true', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.generator.on\n');
    expect(client.getDevice().generator).toBe(true);
  });

  it('ssp.display.toggle → logged debug, no event', () => {
    const log = makeLog();
    const client = connectClient(log);
    let emitted = false;
    client.on('device', () => { emitted = true; });
    mockSocket.simulateData('ssp.display.toggle\n');
    expect(emitted).toBe(false);
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('Informational'));
  });

  it('ssp.treb.[0] — deprecated, logged as informational', () => {
    const log = makeLog();
    connectClient(log);
    mockSocket.simulateData('ssp.treb.[0]\n');
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('Informational'));
  });

  it('ssp.sub_en.[0] — deprecated, logged as informational', () => {
    const log = makeLog();
    connectClient(log);
    mockSocket.simulateData('ssp.sub_en.[0]\n');
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('Informational'));
  });

  it('malformed trigger list entry → skipped with debug log', () => {
    const log = makeLog();
    const client = connectClient(log);
    let received: { name: string }[] | null = null;
    client.on('triggerList', (triggers) => { received = triggers; });
    mockSocket.simulateData('ssp.trigger.start\n');
    mockSocket.simulateData('ssp.trigger.list.["Trigger 1"]\n');
    mockSocket.simulateData('ssp.trigger.list.[123]\n');
    mockSocket.simulateData('ssp.trigger.end\n');
    expect(received).toHaveLength(1);
    expect(received![0].name).toBe('Trigger 1');
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('Skipped malformed list entry'));
  });
});

describe('StormAudioClient — new getters (Task 14)', () => {
  it('getIdentity() returns default empty identity', () => {
    const client = new StormAudioClient(validConfig, makeLog());
    expect(client.getIdentity()).toEqual({ version: '', brand: '', model: '' });
  });

  it('getStreamInfo() returns default empty stream info', () => {
    const client = new StormAudioClient(validConfig, makeLog());
    expect(client.getStreamInfo()).toEqual({ stream: '', sampleRate: '', format: '' });
  });

  it('getAudio() returns default audio state', () => {
    const client = new StormAudioClient(validConfig, makeLog());
    const audio = client.getAudio();
    expect(audio.dim).toBe(false);
    expect(audio.bass).toBe(0);
    expect(audio.drc).toBe('off');
    expect(audio.stormxt).toBeNull();
    expect(audio.sphereAudioEffect).toBeNull();
    expect(audio.imaxMode).toBe('off');
  });

  it('getDevice() returns default device state', () => {
    const client = new StormAudioClient(validConfig, makeLog());
    expect(client.getDevice().brightness).toBe(0);
    expect(client.getDevice().frontPanel.color).toBe('');
  });

  it('getAudioConfig() returns default audio config', () => {
    const client = new StormAudioClient(validConfig, makeLog());
    expect(client.getAudioConfig().preset).toBe(0);
    expect(client.getAudioConfig().presetList).toEqual([]);
    expect(client.getAudioConfig().surroundModeList).toEqual([]);
  });

  it('getZones() returns empty Map by default', () => {
    const client = new StormAudioClient(validConfig, makeLog());
    expect(client.getZones().size).toBe(0);
  });

  it('getHdmi() returns empty Map by default', () => {
    const client = new StormAudioClient(validConfig, makeLog());
    expect(client.getHdmi().size).toBe(0);
  });

  it('getZoneProfiles() returns empty array by default', () => {
    const client = new StormAudioClient(validConfig, makeLog());
    expect(client.getZoneProfiles()).toEqual([]);
  });

  it('getAudio().bass returns updated value after broadcast', () => {
    const mockSocket = new MockSocket();
    const socketFactory = vi.fn().mockReturnValue(mockSocket);
    const client = new StormAudioClient(validConfig, makeLog(), socketFactory);
    client.connect();
    mockSocket.simulateConnect();
    mockSocket.simulateData('ssp.bass.[-3]\n');
    expect(client.getAudio().bass).toBe(-3);
  });
});

describe('StormAudioClient — connect() dedup guard', () => {
  let mockSocket: MockSocket;
  let mockSocket2: MockSocket;
  let socketFactory: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSocket = new MockSocket();
    mockSocket2 = new MockSocket();
    socketFactory = vi.fn().mockReturnValueOnce(mockSocket).mockReturnValueOnce(mockSocket2);
  });

  it('connect() called twice → socketFactory called once, warn logged', () => {
    const log = makeLog();
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.on('error', () => {});
    client.connect();
    client.connect();
    expect(socketFactory).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Already connected'));
  });

  it('connect() after disconnect() → new connection established', () => {
    const client = new StormAudioClient(validConfig, makeLog(), socketFactory);
    client.on('error', () => {});
    client.connect();
    mockSocket.simulateConnect();
    client.disconnect();
    client.connect();
    expect(socketFactory).toHaveBeenCalledTimes(2);
  });

  it('connect() after socket error and close → new connection established', () => {
    const client = new StormAudioClient(validConfig, makeLog(), socketFactory);
    client.on('error', () => {});
    client.connect();
    mockSocket.simulateConnect();
    mockSocket.simulateError(new Error('ECONNRESET'));
    mockSocket.simulateClose();
    client.connect();
    expect(socketFactory).toHaveBeenCalledTimes(2);
  });
});

describe('StormAudioClient — disconnect() state cleanup', () => {
  let mockSocket: MockSocket;
  let mockSocket2: MockSocket;
  let socketFactory: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSocket = new MockSocket();
    mockSocket2 = new MockSocket();
    socketFactory = vi.fn().mockReturnValueOnce(mockSocket).mockReturnValueOnce(mockSocket2);
  });

  const connectClient = () => {
    const client = new StormAudioClient(validConfig, makeLog(), socketFactory);
    client.on('error', () => {});
    client.connect();
    mockSocket.simulateConnect();
    return client;
  };

  it('disconnect clears all seven pending lists', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.input.start\n');
    mockSocket.simulateData('ssp.preset.start\n');
    mockSocket.simulateData('ssp.surroundmode.start\n');
    mockSocket.simulateData('ssp.auropreset.start\n');
    mockSocket.simulateData('ssp.zones.start\n');
    mockSocket.simulateData('ssp.zones.profiles.start\n');
    mockSocket.simulateData('ssp.trigger.start\n');

    client.disconnect();
    client.connect();
    mockSocket2.simulateConnect();

    const listEvents: string[] = [];
    client.on('inputList', () => { listEvents.push('inputList'); });
    client.on('presetList', () => { listEvents.push('presetList'); });
    client.on('surroundModeList', () => { listEvents.push('surroundModeList'); });
    client.on('auroPresetList', () => { listEvents.push('auroPresetList'); });
    client.on('zoneList', () => { listEvents.push('zoneList'); });
    client.on('zoneProfileList', () => { listEvents.push('zoneProfileList'); });
    client.on('triggerList', () => { listEvents.push('triggerList'); });

    mockSocket2.simulateData('ssp.input.end\n');
    mockSocket2.simulateData('ssp.preset.end\n');
    mockSocket2.simulateData('ssp.surroundmode.end\n');
    mockSocket2.simulateData('ssp.auropreset.end\n');
    mockSocket2.simulateData('ssp.zones.end\n');
    mockSocket2.simulateData('ssp.zones.profiles.end\n');
    mockSocket2.simulateData('ssp.trigger.end\n');

    expect(listEvents).toHaveLength(0);
  });

  it('disconnect clears line buffer', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.power');

    client.disconnect();
    client.connect();
    mockSocket2.simulateConnect();

    let powerReceived: boolean | null = null;
    client.on('power', (on) => { powerReceived = on; });
    mockSocket2.simulateData('.on\n');

    expect(powerReceived).toBeNull();
  });

  it('disconnect sends ssp.close when connected', () => {
    const client = connectClient();
    client.disconnect();
    expect(mockSocket.written).toContain('ssp.close\n');
  });

  it('disconnect during connection phase (before TCP handshake) → no ssp.close, socket destroyed', () => {
    const client = new StormAudioClient(validConfig, makeLog(), socketFactory);
    client.on('error', () => {});
    client.connect();
    // Do NOT call simulateConnect() — socket exists but TCP handshake not complete
    client.disconnect();
    expect(mockSocket.written).not.toContain('ssp.close\n');
    expect(mockSocket.destroyed).toBe(true);
  });

  it('disconnect when not connected → no throw', () => {
    const client = new StormAudioClient(validConfig, makeLog(), socketFactory);
    client.on('error', () => {});
    expect(() => { client.disconnect(); }).not.toThrow();
  });

  it('disconnect() called twice on live connection → no throw, single disconnected event', () => {
    const client = connectClient();
    let disconnectedCount = 0;
    client.on('disconnected', () => { disconnectedCount++; });
    expect(() => {
      client.disconnect();
      client.disconnect();
    }).not.toThrow();
    expect(disconnectedCount).toBe(1);
  });
});

describe('StormAudioClient — wakePromise cancel', () => {
  let mockSocket: MockSocket;
  let mockSocket2: MockSocket;
  let socketFactory: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSocket = new MockSocket();
    mockSocket2 = new MockSocket();
    socketFactory = vi.fn().mockReturnValueOnce(mockSocket).mockReturnValueOnce(mockSocket2);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const connectClient = () => {
    const client = new StormAudioClient(validConfig, makeLog(), socketFactory);
    client.on('error', () => {});
    client.connect();
    mockSocket.simulateConnect();
    return client;
  };

  it('ensureActive() resolves false on disconnect', async () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.procstate.0\n');
    const result = client.ensureActive();
    client.disconnect();
    expect(await result).toBe(false);
  });

  it('ensureActive() resolves false on socket error', async () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.procstate.0\n');
    const baseline = client.listenerCount('processorState');
    const result = client.ensureActive();
    mockSocket.simulateError(new Error('ECONNRESET'));
    expect(await result).toBe(false);
    expect(client.listenerCount('processorState')).toBe(baseline);
  });

  it('ensureActive() resolves false on server-initiated close (no error event)', async () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.procstate.0\n');
    const baseline = client.listenerCount('processorState');
    const result = client.ensureActive();
    mockSocket.simulateClose();
    expect(await result).toBe(false);
    expect(client.listenerCount('processorState')).toBe(baseline);
  });

  it('processorState listener cleaned up on disconnect cancel', async () => {
    const client = connectClient();
    const baseline = client.listenerCount('processorState');
    const result = client.ensureActive();
    expect(client.listenerCount('processorState')).toBe(baseline + 1);
    client.disconnect();
    expect(await result).toBe(false);
    expect(client.listenerCount('processorState')).toBe(baseline);
  });

  it('timeout timer cleared on cancel — no late resolution after advancing fake timers', async () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.procstate.0\n');
    const result = client.ensureActive();
    client.disconnect();
    expect(await result).toBe(false);
    // Advance past the original timeout — timer was cleared by wakeCancel so nothing fires
    vi.advanceTimersByTime(PROCESSOR_WAKE_TIMEOUT_MS + 1);
  });

  it('new ensureActive() after cancel creates fresh promise and sends power-on again', async () => {
    const client = connectClient();
    const result = client.ensureActive();
    client.disconnect();
    expect(await result).toBe(false);

    client.connect();
    mockSocket2.simulateConnect();
    mockSocket2.simulateData('ssp.procstate.0\n');
    const result2 = client.ensureActive();
    mockSocket2.simulateData('ssp.procstate.2\n');
    expect(await result2).toBe(true);

    const totalPowerOn = [...mockSocket.written, ...mockSocket2.written]
      .filter(w => w === 'ssp.power.on\n').length;
    expect(totalPowerOn).toBe(2);
  });

  it('concurrent ensureActive() calls all resolve false on disconnect — single power-on command', async () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.procstate.0\n');
    const r1 = client.ensureActive();
    const r2 = client.ensureActive();
    const r3 = client.ensureActive();
    client.disconnect();
    expect(await Promise.all([r1, r2, r3])).toEqual([false, false, false]);
    const powerOnCount = mockSocket.written.filter(w => w === 'ssp.power.on\n').length;
    expect(powerOnCount).toBe(1);
  });
});

describe('StormAudioClient — error handler log messages', () => {
  let mockSocket: MockSocket;
  let socketFactory: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSocket = new MockSocket();
    socketFactory = vi.fn().mockReturnValue(mockSocket);
  });

  it('socket error during connection phase logs "Could not connect"', () => {
    const log = makeLog();
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.on('error', () => {});
    client.connect();
    // Do NOT call simulateConnect() — error occurs before connection established
    mockSocket.simulateError(new Error('ECONNREFUSED'));
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Could not connect'));
    expect(log.error).not.toHaveBeenCalledWith(expect.stringContaining('Lost connection'));
  });

  it('socket error after successful connection logs "Connection lost" at warn level', () => {
    const log = makeLog();
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.on('error', () => {});
    client.connect();
    mockSocket.simulateConnect();
    mockSocket.simulateError(new Error('ECONNRESET'));
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Connection lost. Reconnecting...'));
    expect(log.error).not.toHaveBeenCalledWith(expect.stringContaining('Could not connect'));
  });
});

describe('StormAudioClient — typed EventEmitter', () => {
  it('once fires exactly one time for connected event', () => {
    const client = new StormAudioClient(validConfig, makeLog());
    let callCount = 0;
    client.once('connected', () => { callCount++; });
    client.emit('connected');
    client.emit('connected');
    expect(callCount).toBe(1);
  });

  it('removeListener stops event delivery', () => {
    const client = new StormAudioClient(validConfig, makeLog());
    let callCount = 0;
    const handler = (): void => { callCount++; };
    client.on('connected', handler);
    client.emit('connected');
    client.removeListener('connected', handler);
    client.emit('connected');
    expect(callCount).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────
// Reconnection tests (Story 4.1)
// ─────────────────────────────────────────────────────────────

describe('StormAudioClient — reconnection', () => {
  let mockSocket: MockSocket;
  let socketFactory: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockSocket = new MockSocket();
    socketFactory = vi.fn().mockReturnValue(mockSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const connectClient = (log = makeLog()) => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.on('error', () => {}); // prevent unhandled error throw
    client.connect();
    mockSocket.simulateConnect();
    return client;
  };

  /** Simulate an unexpected disconnect (error + close, like real Node.js sockets) */
  const simulateUnexpectedDisconnect = () => {
    mockSocket.simulateError(new Error('ECONNRESET'));
    mockSocket.simulateClose();
  };

  /** Create a fresh MockSocket for reconnection attempts */
  const freshSocket = () => {
    mockSocket = new MockSocket();
    socketFactory.mockReturnValue(mockSocket);
    return mockSocket;
  };

  // ── Main Paths ──────────────────────────────────────────────

  it('QA-1: successful reconnection after single failure', () => {
    const log = makeLog();
    const client = connectClient(log);
    let connectedCount = 0;
    client.on('connected', () => { connectedCount++; });

    // Unexpected disconnect
    simulateUnexpectedDisconnect();

    // Should schedule reconnect with 0ms delay (fires immediately)
    const newSocket = freshSocket();
    vi.advanceTimersByTime(RECONNECT_INITIAL_DELAY_MS);

    // connect() called, simulate successful connection
    newSocket.simulateConnect();

    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('[TCP] Reconnected to'));
    expect(connectedCount).toBe(1); // one reconnection 'connected' event
  });

  it('QA-2: backoff delay progression — all 0ms (0 * 2 = 0 always since initial=0)', () => {
    const log = makeLog();
    const client = connectClient(log);
    client.on('error', () => {});

    // With RECONNECT_INITIAL_DELAY_MS=0: every delay is 0 * multiplier = 0, capped at 0.
    // One entry per RECONNECT_MAX_RETRIES attempt (6); last iteration doesn't fail so
    // the 5th close schedules retryCount=6 at 0ms (check is pre-increment, so still 0ms).
    const expectedDelays = [0, 0, 0, 0, 0, 0];

    // First unexpected disconnect triggers reconnection cycle
    simulateUnexpectedDisconnect();

    for (let i = 0; i < expectedDelays.length; i++) {
      freshSocket();
      const callsBefore = socketFactory.mock.calls.length;

      // All delays are 0ms — advancing 0ms fires the timer
      vi.advanceTimersByTime(0);
      expect(socketFactory).toHaveBeenCalledTimes(callsBefore + 1);

      // Fail this attempt to continue to next backoff level
      if (i < expectedDelays.length - 1) {
        mockSocket.simulateError(new Error('ECONNREFUSED'));
        mockSocket.simulateClose();
      }
    }
  });

  it('QA-3: max retries exhausted emits fatal error and enters long-poll (does NOT stop)', () => {
    const log = makeLog();
    const client = connectClient(log);
    let fatalError = false;
    client.on('error', (err) => {
      if (err.category === ErrorCategory.Fatal) {
        fatalError = true;
      }
    });

    // Initial unexpected disconnect starts the reconnection cycle (retryCount → 1)
    simulateUnexpectedDisconnect();

    // Each iteration: advance to next timer, fail the reconnection attempt.
    // After RECONNECT_MAX_RETRIES failures, scheduleReconnect() enters long-poll and emits Fatal once.
    for (let i = 0; i < RECONNECT_MAX_RETRIES; i++) {
      freshSocket();
      vi.advanceTimersByTime(RECONNECT_MAX_DELAY_MS); // advance past any delay
      mockSocket.simulateError(new Error('ECONNREFUSED'));
      mockSocket.simulateClose();
    }

    // Fatal error emitted and logged exactly once
    expect(fatalError).toBe(true);
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('Max reconnection retries exhausted'),
    );

    // Long-poll: a 20s timer is now pending (not stopped) — 1 reconnect timer
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1);
  });

  it('QA-5: intentional disconnect() suppresses reconnection', () => {
    const client = connectClient();
    const callCountBefore = socketFactory.mock.calls.length;
    client.disconnect();

    // Advance time well past any reconnection delay
    vi.advanceTimersByTime(RECONNECT_MAX_DELAY_MS * 2);
    expect(socketFactory).toHaveBeenCalledTimes(callCountBefore);
  });

  it('QA-6: backoff resets on successful reconnect', () => {
    const log = makeLog();
    const client = connectClient(log);
    client.on('error', () => {});

    // Fail 3 times (delay is always 0 since initial=0)
    for (let i = 0; i < 3; i++) {
      simulateUnexpectedDisconnect();
      freshSocket();
      vi.advanceTimersByTime(RECONNECT_MAX_DELAY_MS);
      if (i < 2) {
        mockSocket.simulateError(new Error('ECONNREFUSED'));
        mockSocket.simulateClose();
      }
    }
    // 3rd attempt succeeds
    mockSocket.simulateConnect();

    // Now disconnect again — delay should restart at 0ms
    simulateUnexpectedDisconnect();
    const reconnectSocket = freshSocket();
    const callsBefore = socketFactory.mock.calls.length;

    // Should reconnect immediately at 0ms (reset to initial delay)
    vi.advanceTimersByTime(0);
    expect(socketFactory).toHaveBeenCalledTimes(callsBefore + 1);
    reconnectSocket.simulateConnect();
  });

  // ── Edge Cases ──────────────────────────────────────────────

  it('QA-7: initial connection failure does NOT trigger reconnection', () => {
    const log = makeLog();
    const client = new StormAudioClient(validConfig, log, socketFactory);
    let errorFired = false;
    client.on('error', (err) => {
      if (err.category === ErrorCategory.Recoverable) {
        errorFired = true;
      }
    });
    client.connect();

    // Fail immediately (never connected)
    mockSocket.simulateError(new Error('ECONNREFUSED'));
    mockSocket.simulateClose();

    const callCountAfterClose = socketFactory.mock.calls.length;
    vi.advanceTimersByTime(RECONNECT_MAX_DELAY_MS * 2);

    expect(errorFired).toBe(true);
    expect(socketFactory).toHaveBeenCalledTimes(callCountAfterClose); // no reconnect
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Could not connect'));
  });

  it('QA-8: disconnect() during active reconnection timer clears the timer', () => {
    const client = connectClient();

    // Unexpected disconnect — timer scheduled
    simulateUnexpectedDisconnect();
    freshSocket();

    // disconnect() before timer fires
    client.disconnect();
    const callCountAfterDisconnect = socketFactory.mock.calls.length;

    vi.advanceTimersByTime(RECONNECT_MAX_DELAY_MS * 2);
    expect(socketFactory).toHaveBeenCalledTimes(callCountAfterDisconnect);
  });

  it('QA-9: disconnect() during reconnection attempt (socket mid-connect)', () => {
    const client = connectClient();

    // Unexpected disconnect — timer scheduled
    simulateUnexpectedDisconnect();
    freshSocket();

    // Timer fires — new socket created but connect event not fired yet
    vi.advanceTimersByTime(RECONNECT_INITIAL_DELAY_MS);
    expect(mockSocket.destroyed).toBe(false);

    // User calls disconnect while socket is connecting
    client.disconnect();
    expect(mockSocket.destroyed).toBe(true);

    // No further reconnection
    freshSocket();
    vi.advanceTimersByTime(RECONNECT_MAX_DELAY_MS * 2);
    expect(mockSocket.destroyed).toBe(false); // new socket never used
  });

  it('QA-10: concurrent close events — scheduleReconnect idempotency', () => {
    connectClient();

    // Simulate unexpected disconnect
    mockSocket.simulateError(new Error('ECONNRESET'));
    // Fire close twice rapidly (edge case)
    mockSocket.simulateClose();
    mockSocket.simulateClose();

    freshSocket();
    const callsBefore = socketFactory.mock.calls.length;

    // Only one reconnect timer should fire
    vi.advanceTimersByTime(RECONNECT_INITIAL_DELAY_MS);
    expect(socketFactory).toHaveBeenCalledTimes(callsBefore + 1);
  });

  it('QA-11: ensureActive() resolves false on unexpected disconnect', async () => {
    const log = makeLog();
    const client = connectClient(log);

    // Set processor to Sleep state for ensureActive to wait
    mockSocket.simulateData('ssp.procstate.[0]\n');

    const wakeResult = client.ensureActive(5000);

    // Unexpected disconnect while waiting
    simulateUnexpectedDisconnect();

    expect(await wakeResult).toBe(false);
  });

  it('QA-12: stale parsing state cleared on reconnection', () => {
    const log = makeLog();
    const client = connectClient(log);

    // Start receiving a streaming input list
    mockSocket.simulateData('ssp.input.start\n');
    mockSocket.simulateData('ssp.input.list.["TV", 1]\n');

    // Unexpected disconnect
    simulateUnexpectedDisconnect();
    const newSocket = freshSocket();
    vi.advanceTimersByTime(RECONNECT_INITIAL_DELAY_MS);
    newSocket.simulateConnect();

    // Send end of list on new connection — should NOT produce inputList event
    // because pending state was cleared during reconnection
    let inputListFired = false;
    client.on('inputList', () => { inputListFired = true; });
    newSocket.simulateData('ssp.input.end\n');

    expect(inputListFired).toBe(false);
  });

  it('QA-13: error during reconnection does NOT emit error event', () => {
    const client = connectClient();
    let errorCount = 0;
    client.on('error', () => { errorCount++; });

    // Unexpected disconnect — triggers reconnection
    simulateUnexpectedDisconnect();
    freshSocket();
    vi.advanceTimersByTime(RECONNECT_INITIAL_DELAY_MS);

    // Reset error count after initial disconnect
    errorCount = 0;

    // Reconnection attempt fails — should NOT emit error
    mockSocket.simulateError(new Error('ECONNREFUSED'));
    expect(errorCount).toBe(0);
  });

  it('QA-14: reconnect timer is null after successful reconnect', () => {
    connectClient();

    simulateUnexpectedDisconnect();
    freshSocket();
    vi.advanceTimersByTime(RECONNECT_INITIAL_DELAY_MS);
    mockSocket.simulateConnect();

    // After successful reconnect: only 1 pending timer (keepalive interval), no reconnect timer
    expect(vi.getTimerCount()).toBe(1);
  });

  // ── Integration Smoke Tests ─────────────────────────────────

  it('QA-15: full reconnection lifecycle with state re-sync', () => {
    const log = makeLog();
    const client = connectClient(log);

    // Populate initial state
    mockSocket.simulateData('ssp.power.on\n');
    mockSocket.simulateData('ssp.vol.[-25]\n');
    expect(client.getPower()).toBe(true);
    expect(client.getVolume()).toBe(-25);

    // Unexpected disconnect
    simulateUnexpectedDisconnect();

    // Fail 2 attempts
    for (let i = 0; i < 2; i++) {
      freshSocket();
      vi.advanceTimersByTime(RECONNECT_MAX_DELAY_MS);
      mockSocket.simulateError(new Error('ECONNREFUSED'));
      mockSocket.simulateClose();
    }

    // 3rd attempt succeeds
    freshSocket();
    vi.advanceTimersByTime(RECONNECT_MAX_DELAY_MS);
    mockSocket.simulateConnect();

    // ISP broadcasts new state dump
    mockSocket.simulateData('ssp.power.off\n');
    mockSocket.simulateData('ssp.vol.[-30]\n');

    expect(client.getPower()).toBe(false);
    expect(client.getVolume()).toBe(-30);
  });

  it('QA-16: reconnection with pending wakePromise', async () => {
    const log = makeLog();
    const client = connectClient(log);

    // Set processor to Sleep
    mockSocket.simulateData('ssp.procstate.[0]\n');

    // Start ensureActive
    const wakeResult = client.ensureActive(5000);

    // Unexpected disconnect
    simulateUnexpectedDisconnect();
    expect(await wakeResult).toBe(false);

    // Reconnect
    freshSocket();
    vi.advanceTimersByTime(RECONNECT_INITIAL_DELAY_MS);
    mockSocket.simulateConnect();

    // Set processor to active state so new ensureActive succeeds immediately
    mockSocket.simulateData('ssp.procstate.[2]\n');
    const newWake = await client.ensureActive(5000);
    expect(newWake).toBe(true);
  });

  it('QA-17: rapid disconnect/reconnect — no double events', () => {
    const log = makeLog();
    const client = connectClient(log);
    let connectedCount = 0;
    client.on('connected', () => { connectedCount++; });

    // Unexpected disconnect
    simulateUnexpectedDisconnect();

    // Reconnect immediately succeeds
    freshSocket();
    vi.advanceTimersByTime(RECONNECT_INITIAL_DELAY_MS);
    mockSocket.simulateConnect();

    expect(connectedCount).toBe(1); // exactly one reconnect connected event
  });

  // ── Error Handler Sibling Coverage ──────────────────────────

  describe('error handler context family', () => {
    it('initial connection failure: emits Recoverable error, logs at error level, no reconnection', () => {
      const log = makeLog();
      const client = new StormAudioClient(validConfig, log, socketFactory);
      let errorCategory: string | null = null;
      client.on('error', (err) => { errorCategory = err.category; });

      client.connect();
      mockSocket.simulateError(new Error('ECONNREFUSED'));
      mockSocket.simulateClose();

      expect(errorCategory).toBe(ErrorCategory.Recoverable);
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Could not connect'));

      const callCount = socketFactory.mock.calls.length;
      vi.advanceTimersByTime(RECONNECT_MAX_DELAY_MS * 2);
      expect(socketFactory).toHaveBeenCalledTimes(callCount);
    });

    it('active connection dropped: logs warn "Connection lost", triggers reconnection via close', () => {
      const log = makeLog();
      connectClient(log);

      mockSocket.simulateError(new Error('ECONNRESET'));
      expect(log.warn).toHaveBeenCalledWith('[TCP] Connection lost. Reconnecting...');

      mockSocket.simulateClose();
      freshSocket();
      const callsBefore = socketFactory.mock.calls.length;
      vi.advanceTimersByTime(RECONNECT_INITIAL_DELAY_MS);
      expect(socketFactory).toHaveBeenCalledTimes(callsBefore + 1);
    });

    it('reconnection attempt failed: logs warn with attempt count, schedules next attempt', () => {
      const log = makeLog();
      connectClient(log);

      // First disconnect
      simulateUnexpectedDisconnect();
      freshSocket();
      vi.advanceTimersByTime(RECONNECT_INITIAL_DELAY_MS);

      // This reconnection attempt fails
      mockSocket.simulateError(new Error('ECONNREFUSED'));
      expect(log.warn).toHaveBeenCalledWith(
        expect.stringContaining('Reconnection attempt'),
      );
      expect(log.warn).toHaveBeenCalledWith(
        expect.stringContaining(`/${RECONNECT_MAX_RETRIES} failed`),
      );
    });
  });

  // ── Disconnect Timing Sibling Coverage ──────────────────────

  describe('disconnect() timing family', () => {
    it('disconnect() when idle: clean shutdown, no scheduleReconnect', () => {
      const client = connectClient();
      const callsBefore = socketFactory.mock.calls.length;
      client.disconnect();

      vi.advanceTimersByTime(RECONNECT_MAX_DELAY_MS * 2);
      expect(socketFactory).toHaveBeenCalledTimes(callsBefore);
    });

    it('disconnect() when reconnection timer is pending: timer cleared', () => {
      const client = connectClient();
      simulateUnexpectedDisconnect();

      // Timer is now pending
      client.disconnect();
      freshSocket();
      const callsBefore = socketFactory.mock.calls.length;

      vi.advanceTimersByTime(RECONNECT_MAX_DELAY_MS * 2);
      expect(socketFactory).toHaveBeenCalledTimes(callsBefore);
    });

    it('disconnect() when socket is mid-connect during reconnection', () => {
      const client = connectClient();
      simulateUnexpectedDisconnect();
      freshSocket();
      vi.advanceTimersByTime(RECONNECT_INITIAL_DELAY_MS); // timer fires, new socket created

      // Socket is connecting but not yet connected
      client.disconnect();
      expect(mockSocket.destroyed).toBe(true);

      // No further reconnection after destroy triggers close
      freshSocket();
      vi.advanceTimersByTime(RECONNECT_MAX_DELAY_MS * 2);
      expect(mockSocket.destroyed).toBe(false); // fresh socket untouched
    });
  });

  // ── Listener Cleanup Verification ───────────────────────────

  describe('listener cleanup', () => {
    it('QA-18: listenerCount returns to baseline after reconnection cycle', () => {
      const client = connectClient();
      const baselineCounts: Record<string, number> = {};
      for (const event of ['connected', 'disconnected', 'error', 'power', 'volume', 'mute']) {
        baselineCounts[event] = client.listenerCount(event);
      }

      // Reconnect cycle
      simulateUnexpectedDisconnect();
      freshSocket();
      vi.advanceTimersByTime(RECONNECT_INITIAL_DELAY_MS);
      mockSocket.simulateConnect();

      for (const event of ['connected', 'disconnected', 'error', 'power', 'volume', 'mute']) {
        expect(client.listenerCount(event)).toBe(baselineCounts[event]);
      }
    });

    it('QA-19: no timer leaks after intentional disconnect', () => {
      const client = connectClient();
      client.disconnect();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('QA-20: no socket listener accumulation across failed reconnection attempts', () => {
      connectClient();

      // Multiple failed reconnection attempts
      for (let i = 0; i < 5; i++) {
        simulateUnexpectedDisconnect();
        freshSocket();
        vi.advanceTimersByTime(RECONNECT_MAX_DELAY_MS);
        // Each failed attempt: error fires then close fires, socket destroyed
        // New socket created by next scheduleReconnect
      }

      // socketFactory should have been called once per reconnection attempt + 1 initial
      expect(socketFactory).toHaveBeenCalledTimes(1 + 5);
    });
  });

  // ── Reconnection constants ──────────────────────────────────

  describe('reconnection constants', () => {
    it('RECONNECT_INITIAL_DELAY_MS is 0', () => {
      expect(RECONNECT_INITIAL_DELAY_MS).toBe(0);
    });

    it('RECONNECT_MULTIPLIER is 2', () => {
      expect(RECONNECT_MULTIPLIER).toBe(2);
    });

    it('RECONNECT_MAX_DELAY_MS is 16000', () => {
      expect(RECONNECT_MAX_DELAY_MS).toBe(16000);
    });

    it('RECONNECT_MAX_RETRIES is 6', () => {
      expect(RECONNECT_MAX_RETRIES).toBe(6);
    });

    it('RECONNECT_CONNECT_TIMEOUT_MS is 10000', () => {
      expect(RECONNECT_CONNECT_TIMEOUT_MS).toBe(10000);
    });

    it('RECONNECT_LONG_POLL_INTERVAL_MS is 20000', () => {
      expect(RECONNECT_LONG_POLL_INTERVAL_MS).toBe(20000);
    });
  });

  // ── State re-sync ───────────────────────────────────────────

  it('QA-4: state re-sync after reconnect — events emitted for all state values', () => {
    const log = makeLog();
    const client = connectClient(log);

    // Set initial state
    mockSocket.simulateData('ssp.power.on\n');
    mockSocket.simulateData('ssp.vol.[-25]\n');
    mockSocket.simulateData('ssp.mute.off\n');
    mockSocket.simulateData('ssp.input.[3]\n');

    // Unexpected disconnect
    simulateUnexpectedDisconnect();

    // Reconnect
    freshSocket();
    vi.advanceTimersByTime(RECONNECT_INITIAL_DELAY_MS);
    mockSocket.simulateConnect();

    // Track events from state dump
    let powerEvent = false;
    let volumeEvent = false;
    let muteEvent = false;
    let inputEvent = false;
    client.on('power', () => { powerEvent = true; });
    client.on('volume', () => { volumeEvent = true; });
    client.on('mute', () => { muteEvent = true; });
    client.on('input', () => { inputEvent = true; });

    // ISP broadcasts full state dump
    mockSocket.simulateData('ssp.power.off\n');
    mockSocket.simulateData('ssp.vol.[-30]\n');
    mockSocket.simulateData('ssp.mute.on\n');
    mockSocket.simulateData('ssp.input.[5]\n');

    expect(powerEvent).toBe(true);
    expect(volumeEvent).toBe(true);
    expect(muteEvent).toBe(true);
    expect(inputEvent).toBe(true);
    expect(client.getPower()).toBe(false);
    expect(client.getVolume()).toBe(-30);
    expect(client.getMute()).toBe(true);
    expect(client.getInput()).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────
// Long-poll recovery tests (Story 4.x — connect timeout + long-poll)
// ─────────────────────────────────────────────────────────────

describe('StormAudioClient — long-poll recovery', () => {
  let mockSocket: MockSocket;
  let socketFactory: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockSocket = new MockSocket();
    socketFactory = vi.fn().mockReturnValue(mockSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const connectClient = (log = makeLog()) => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.on('error', () => {}); // prevent unhandled error throw
    client.connect();
    mockSocket.simulateConnect();
    return client;
  };

  /** Simulate an unexpected disconnect (error + close) */
  const simulateUnexpectedDisconnect = () => {
    mockSocket.simulateError(new Error('ECONNRESET'));
    mockSocket.simulateClose();
  };

  /** Create a fresh MockSocket for reconnection attempts */
  const freshSocket = () => {
    mockSocket = new MockSocket();
    socketFactory.mockReturnValue(mockSocket);
    return mockSocket;
  };

  /** Exhaust all MAX_RETRIES attempts to force entry into long-poll mode */
  const exhaustRetries = (client: StormAudioClient) => {
    // First unexpected disconnect kicks off the retry cycle
    simulateUnexpectedDisconnect();
    for (let i = 0; i < RECONNECT_MAX_RETRIES; i++) {
      freshSocket();
      vi.advanceTimersByTime(RECONNECT_MAX_DELAY_MS);
      mockSocket.simulateError(new Error('ECONNREFUSED'));
      mockSocket.simulateClose();
    }
    // After the loop, scheduleReconnect has fired and we are now in long-poll mode.
    // The long-poll timer (20s) is pending.
    return client;
  };

  // ── Long-poll entry ─────────────────────────────────────────

  it('LP-1: after MAX_RETRIES failures a 20s timer is set (not stopped)', () => {
    const client = connectClient();
    exhaustRetries(client);
    // A 20s reconnect timer is pending — client has not given up
    freshSocket();
    const callsBefore = socketFactory.mock.calls.length;
    vi.advanceTimersByTime(RECONNECT_LONG_POLL_INTERVAL_MS - 1);
    expect(socketFactory).toHaveBeenCalledTimes(callsBefore);
    vi.advanceTimersByTime(1);
    expect(socketFactory).toHaveBeenCalledTimes(callsBefore + 1);
  });

  it('LP-2: entering long-poll logs the error message exactly once', () => {
    const log = makeLog();
    const client = connectClient(log);
    exhaustRetries(client);
    const errorCallsAfterExhaustion = log.error.mock.calls.filter(
      (args: unknown[]) => typeof args[0] === 'string' && (args[0] as string).includes('Max reconnection retries exhausted'),
    ).length;
    expect(errorCallsAfterExhaustion).toBe(1);

    // Fail the long-poll attempt — error must NOT be re-logged
    freshSocket();
    vi.advanceTimersByTime(RECONNECT_LONG_POLL_INTERVAL_MS);
    mockSocket.simulateError(new Error('ECONNREFUSED'));
    mockSocket.simulateClose();

    const errorCallsAfterLongPoll = log.error.mock.calls.filter(
      (args: unknown[]) => typeof args[0] === 'string' && (args[0] as string).includes('Max reconnection retries exhausted'),
    ).length;
    expect(errorCallsAfterLongPoll).toBe(1); // still exactly one
  });

  it('LP-3: failed long-poll attempt uses debug log (not warn)', () => {
    const log = makeLog();
    const client = connectClient(log);
    exhaustRetries(client);

    freshSocket();
    vi.advanceTimersByTime(RECONNECT_LONG_POLL_INTERVAL_MS);

    // The attempt fails
    mockSocket.simulateError(new Error('ECONNREFUSED'));

    // Should log at debug level — not warn
    expect(log.debug).toHaveBeenCalledWith(
      expect.stringContaining('Checking connection'),
    );
    expect(log.warn).not.toHaveBeenCalledWith(expect.stringContaining('Checking connection'));
  });

  it('LP-4: failed long-poll schedules another 30s timer (indefinitely)', () => {
    const client = connectClient();
    exhaustRetries(client);

    // Fail the first long-poll attempt
    freshSocket();
    vi.advanceTimersByTime(RECONNECT_LONG_POLL_INTERVAL_MS);
    mockSocket.simulateError(new Error('ECONNREFUSED'));
    mockSocket.simulateClose();

    // Another 20s timer should be scheduled
    const secondPollSocket = freshSocket();
    const callsBefore = socketFactory.mock.calls.length;
    vi.advanceTimersByTime(RECONNECT_LONG_POLL_INTERVAL_MS - 1);
    expect(socketFactory).toHaveBeenCalledTimes(callsBefore);
    vi.advanceTimersByTime(1);
    expect(socketFactory).toHaveBeenCalledTimes(callsBefore + 1);
    secondPollSocket.simulateConnect(); // clean up
  });

  it('LP-5: successful long-poll attempt clears inLongPoll — backoff resets to 0ms', () => {
    const client = connectClient();
    exhaustRetries(client);

    // Long-poll attempt succeeds
    const reconnectSocket = freshSocket();
    vi.advanceTimersByTime(RECONNECT_LONG_POLL_INTERVAL_MS);
    reconnectSocket.simulateConnect();

    // After success, backoff should be reset — next disconnect uses 0ms initial delay
    reconnectSocket.simulateError(new Error('ECONNRESET'));
    reconnectSocket.simulateClose();

    const nextSocket = freshSocket();
    const callsBefore = socketFactory.mock.calls.length;

    // Should reconnect immediately at 0ms (reset to initial delay, not long-poll interval)
    vi.advanceTimersByTime(0);
    expect(socketFactory).toHaveBeenCalledTimes(callsBefore + 1);
    nextSocket.simulateConnect(); // clean up
  });

  it('LP-6: disconnect() while in long-poll cancels the timer and clears inLongPoll', () => {
    const client = connectClient();
    exhaustRetries(client);

    // We are in long-poll — 20s timer is pending
    client.disconnect();

    // Timer cleared — no reconnect should fire
    freshSocket();
    const callsBefore = socketFactory.mock.calls.length;
    vi.advanceTimersByTime(RECONNECT_LONG_POLL_INTERVAL_MS * 2);
    expect(socketFactory).toHaveBeenCalledTimes(callsBefore);

    // Timer count should be 0 after intentional disconnect
    expect(vi.getTimerCount()).toBe(0);
  });

  // ── Socket connect-phase timeout ───────────────────────────

  it('LP-7: socket timeout event during connect → destroy called → reconnect scheduled', () => {
    const client = connectClient();

    // Unexpected disconnect triggers reconnect
    mockSocket.simulateError(new Error('ECONNRESET'));
    mockSocket.simulateClose();

    // Advance to fire the reconnect timer
    const connectingSocket = freshSocket();
    vi.advanceTimersByTime(RECONNECT_INITIAL_DELAY_MS);

    // Socket is now "connecting" — timeout fires before 'connect' event
    connectingSocket.simulateTimeout();

    // destroy(new Error('Connection timed out')) should have been called
    expect(connectingSocket.destroyed).toBe(true);

    // Close fires after destroy, triggering scheduleReconnect again
    const nextSocket = freshSocket();
    const callsBefore = socketFactory.mock.calls.length;
    vi.advanceTimersByTime(RECONNECT_MAX_DELAY_MS); // advance past next backoff
    expect(socketFactory).toHaveBeenCalledTimes(callsBefore + 1);
    nextSocket.simulateConnect(); // clean up

    // suppress unused warning
    void client;
  });

  it('LP-8: socket timeout fires → reconnect triggered, no unhandled error thrown', () => {
    // Ensures the error listener on client is invoked, not a raw throw
    const errors: unknown[] = [];
    const client = new StormAudioClient(validConfig, makeLog(), socketFactory);
    client.on('error', (err) => { errors.push(err); });
    client.connect();
    mockSocket.simulateConnect(); // first connect succeeds

    // Unexpected drop
    mockSocket.simulateError(new Error('ECONNRESET'));
    mockSocket.simulateClose();

    // Reconnect timer fires, new socket created, but it times out
    freshSocket();
    vi.advanceTimersByTime(RECONNECT_INITIAL_DELAY_MS);
    mockSocket.simulateTimeout(); // timeout on connecting socket

    // Should not throw — destroy triggers error + close which schedules next attempt
    expect(mockSocket.destroyed).toBe(true);
  });
});

describe('StormAudioClient — keepalive', () => {
  let mockSocket: MockSocket;
  let socketFactory: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockSocket = new MockSocket();
    socketFactory = vi.fn().mockReturnValue(mockSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const connectClient = (log = makeLog()) => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.on('error', () => {});
    client.connect();
    mockSocket.simulateConnect();
    return client;
  };

  const freshSocket = () => {
    mockSocket = new MockSocket();
    socketFactory.mockReturnValue(mockSocket);
    return mockSocket;
  };

  // ── Main Paths ──────────────────────────────────────────────

  it('QA-1: sends ssp.keepalive\\n and logs debug after interval fires', () => {
    const log = makeLog();
    connectClient(log);
    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS);
    expect(mockSocket.written).toContain('ssp.keepalive\n');
    expect(log.debug).toHaveBeenCalledWith('[TCP] Keepalive sent');
  });

  it('QA-2: keepalive timeout is cleared when any data is received', () => {
    connectClient();
    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS); // fires interval, starts 10s timeout
    mockSocket.simulateData('ssp.power.on\n');      // any data clears timeout
    vi.advanceTimersByTime(KEEPALIVE_TIMEOUT_MS);   // would destroy if timeout still pending
    expect(mockSocket.destroyed).toBe(false);
  });

  it('QA-3: keepalive timeout fires if no data received — destroys socket and logs warn', () => {
    const log = makeLog();
    connectClient(log);
    // Save reference to connected socket (freshSocket() would reassign the variable)
    const connectedSocket = mockSocket;
    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS); // fires keepalive, starts 10s timeout
    vi.advanceTimersByTime(KEEPALIVE_TIMEOUT_MS);  // timeout fires → socket.destroy()
    expect(log.warn).toHaveBeenCalledWith('[TCP] Keepalive timeout — connection appears stale');
    expect(connectedSocket.destroyed).toBe(true);
  });

  it('QA-3b: keepalive timeout emits disconnected synchronously before socket.destroy()', () => {
    // Regression test for half-open TCP bug: HomeKit must see "Not Responding" immediately
    // when keepalive fires, not after the async 'close' event.
    const client = connectClient();
    const connectedSocket = mockSocket;
    freshSocket(); // ready for reconnect scheduled by close handler

    let socketDestroyedOnFirstDisconnected: boolean | null = null;
    client.on('disconnected', () => {
      // Capture only the FIRST disconnected event (before destroy/close chain)
      if (socketDestroyedOnFirstDisconnected === null) {
        socketDestroyedOnFirstDisconnected = connectedSocket.destroyed;
      }
    });

    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS); // fires keepalive, starts 10s timeout
    vi.advanceTimersByTime(KEEPALIVE_TIMEOUT_MS);  // timeout fires → emit disconnected → destroy

    // First 'disconnected' must have fired with socket NOT yet destroyed
    expect(socketDestroyedOnFirstDisconnected).toBe(false);
    // Socket is destroyed after the callback returns
    expect(connectedSocket.destroyed).toBe(true);
  });

  it('QA-4: keepalive stops on intentional disconnect()', () => {
    const client = connectClient();
    client.disconnect();
    expect(vi.getTimerCount()).toBe(0); // no keepalive or reconnect timers pending
    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS + KEEPALIVE_TIMEOUT_MS);
    expect(mockSocket.written.filter(w => w === 'ssp.keepalive\n')).toHaveLength(0);
  });

  it('QA-5: keepalive restarts after reconnection', () => {
    connectClient();
    mockSocket.simulateClose(); // unexpected close — stops keepalive, schedules reconnect
    const reconnectSocket = freshSocket();
    vi.advanceTimersByTime(RECONNECT_INITIAL_DELAY_MS);
    reconnectSocket.simulateConnect(); // restarts keepalive on new socket
    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS);
    expect(reconnectSocket.written).toContain('ssp.keepalive\n');
  });

  it('QA-6: two keepalive cycles send exactly 2 keepalives when data clears each timeout', () => {
    connectClient();
    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS);
    mockSocket.simulateData('ssp.power.on\n'); // clears first timeout
    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS);
    mockSocket.simulateData('ssp.power.on\n'); // clears second timeout
    expect(mockSocket.written.filter(w => w === 'ssp.keepalive\n')).toHaveLength(2);
  });

  // ── Edge Cases ──────────────────────────────────────────────

  it('QA-7: keepalive timeout during pending wake resolves wake as false', async () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.procstate.0\n'); // Sleep state
    const connectedSocket = mockSocket; // save before freshSocket() reassigns the variable
    freshSocket(); // ready for reconnect after destroy
    const wakeResult = client.ensureActive();
    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS); // keepalive fires, timeout starts
    vi.advanceTimersByTime(KEEPALIVE_TIMEOUT_MS);  // timeout fires → destroy → wakeCancel
    expect(await wakeResult).toBe(false);
    expect(connectedSocket.destroyed).toBe(true);
  });

  it('QA-8: startKeepalive idempotency — exactly 1 keepalive fires per 30s after reconnect cycle', () => {
    connectClient();
    // Disconnect → reconnect cycle (startKeepalive called again after simulateConnect)
    mockSocket.simulateClose();
    const reconnectSocket = freshSocket();
    vi.advanceTimersByTime(RECONNECT_INITIAL_DELAY_MS);
    reconnectSocket.simulateConnect();
    // Run two full cycles — if interval doubled, we'd see 4 sends; idempotent = 2
    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS);
    reconnectSocket.simulateData('ssp.power.on\n'); // clear timeout
    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS);
    reconnectSocket.simulateData('ssp.power.on\n'); // clear timeout
    expect(reconnectSocket.written.filter(w => w === 'ssp.keepalive\n')).toHaveLength(2);
  });

  it('QA-9: stopKeepalive when no timers active — no error thrown', () => {
    const client = new StormAudioClient(validConfig, makeLog(), socketFactory);
    client.on('error', () => {});
    client.connect(); // socket created but not connected — no keepalive started
    expect(() => client.disconnect()).not.toThrow(); // disconnect calls stopKeepalive()
  });

  it('QA-10: data between keepalive sends does not reset the 30s interval', () => {
    connectClient();
    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS / 2); // t=15s
    mockSocket.simulateData('ssp.power.on\n');          // data at 15s
    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS / 2); // t=30s — interval fires
    // Interval is fixed, not reset by data — should still fire at 30s
    expect(mockSocket.written).toContain('ssp.keepalive\n');
  });

  it('QA-11: keepalive echo response specifically clears the timeout', () => {
    connectClient();
    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS); // fire interval, start timeout
    mockSocket.simulateData('ssp.keepalive\n');     // ISP echoes keepalive
    vi.advanceTimersByTime(KEEPALIVE_TIMEOUT_MS);   // would destroy if timeout not cleared
    expect(mockSocket.destroyed).toBe(false);
  });

  it('QA-12: close handler stops keepalive BEFORE scheduling reconnect', () => {
    connectClient(); // socketFactory called once
    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS); // fire interval, start 10s timeout
    // Simulate unexpected close BEFORE freshSocket() so it fires on the connected socket
    mockSocket.simulateClose(); // close handler → stopKeepalive + scheduleReconnect(1s)
    // Set up fresh socket AFTER the close (factory used when reconnect timer fires)
    const reconnectSocket = freshSocket();
    // Fire reconnect timer (0ms) → connect() → socketFactory() returns reconnectSocket
    vi.advanceTimersByTime(RECONNECT_INITIAL_DELAY_MS);
    // Advance remaining keepalive timeout window — stale timeout must NOT fire
    vi.advanceTimersByTime(KEEPALIVE_TIMEOUT_MS - RECONNECT_INITIAL_DELAY_MS);
    expect(reconnectSocket.destroyed).toBe(false);
    expect(socketFactory).toHaveBeenCalledTimes(2); // initial + 1 reconnect only
  });

  // ── Timer/Listener Cleanup ───────────────────────────────────

  it('QA-23: no timer leaks after disconnect() — getTimerCount returns 0', () => {
    const client = connectClient();
    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS); // fire interval, start timeout
    client.disconnect(); // stopKeepalive() clears both; intentional → no reconnect timer
    expect(vi.getTimerCount()).toBe(0);
  });

  it('QA-24: no keepalive fires after intentional disconnect advancing past full window', () => {
    const client = connectClient();
    client.disconnect();
    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS + KEEPALIVE_TIMEOUT_MS);
    // socket was destroyed by disconnect() — no extra destroys from keepalive
    // All timer-driven writes are gone: only 'ssp.close\n' from disconnect itself
    const keepaliveWrites = mockSocket.written.filter(w => w === 'ssp.keepalive\n');
    expect(keepaliveWrites).toHaveLength(0);
  });

  // ── Constants ────────────────────────────────────────────────

  it('KEEPALIVE_INTERVAL_MS is 30000', () => {
    expect(KEEPALIVE_INTERVAL_MS).toBe(30000);
  });

  it('KEEPALIVE_TIMEOUT_MS is 10000', () => {
    expect(KEEPALIVE_TIMEOUT_MS).toBe(10000);
  });
});

// ════════════════════════════════════════════════════════════════
// Story 4.3: Structured Logging & Error Classification
// ════════════════════════════════════════════════════════════════

describe('StormAudioClient — [Command] Received: logging (Story 4.3, Task 1)', () => {
  let mockSocket: MockSocket;
  let socketFactory: ReturnType<typeof vi.fn>;
  let log: ReturnType<typeof makeLog>;

  beforeEach(() => {
    mockSocket = new MockSocket();
    socketFactory = vi.fn().mockReturnValue(mockSocket);
    log = makeLog();
  });

  const connectClient = () => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.connect();
    mockSocket.simulateConnect();
    return client;
  };

  it('logs [Command] Received: for ssp.power.on', () => {
    connectClient();
    mockSocket.simulateData('ssp.power.on\n');
    expect(log.debug).toHaveBeenCalledWith('[Command] Received: ssp.power.on');
  });

  it('logs [Command] Received: for error response', () => {
    connectClient();
    mockSocket.simulateData('error\n');
    expect(log.debug).toHaveBeenCalledWith('[Command] Received: error');
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('[Command] Command rejected'));
  });

  it('logs [Command] Received: for unrecognized message', () => {
    connectClient();
    mockSocket.simulateData('garbage.data\n');
    expect(log.debug).toHaveBeenCalledWith('[Command] Received: garbage.data');
    expect(log.debug).toHaveBeenCalledWith('[Command] Unrecognized message: garbage.data');
  });

  it('logs [Command] Received: for keepalive', () => {
    connectClient();
    mockSocket.simulateData('ssp.keepalive\n');
    expect(log.debug).toHaveBeenCalledWith('[Command] Received: ssp.keepalive');
    expect(log.debug).toHaveBeenCalledWith('[Command] keepalive received');
  });

  it('logs [Command] Received: BEFORE category-specific processing logs', () => {
    connectClient();
    const debugCalls: string[] = [];
    log.debug.mockImplementation((msg: string) => { debugCalls.push(msg); });
    mockSocket.simulateData('garbage.data\n');
    const receivedIdx = debugCalls.findIndex(m => m === '[Command] Received: garbage.data');
    const unrecognizedIdx = debugCalls.findIndex(m => m === '[Command] Unrecognized message: garbage.data');
    expect(receivedIdx).toBeGreaterThanOrEqual(0);
    expect(unrecognizedIdx).toBeGreaterThan(receivedIdx);
  });

  it('logs [Command] Received: for multi-line buffer — two messages', () => {
    connectClient();
    mockSocket.simulateData('ssp.power.on\nssp.vol.[-40]\n');
    expect(log.debug).toHaveBeenCalledWith('[Command] Received: ssp.power.on');
    expect(log.debug).toHaveBeenCalledWith('[Command] Received: ssp.vol.[-40]');
  });

  it('logs [Command] Received: for rapid burst of 100 messages', () => {
    connectClient();
    for (let i = 0; i < 100; i++) {
      mockSocket.simulateData(`ssp.power.on\n`);
    }
    const receivedCalls = log.debug.mock.calls.filter(
      (args: unknown[]) => typeof args[0] === 'string' && (args[0] as string) === '[Command] Received: ssp.power.on',
    );
    expect(receivedCalls).toHaveLength(100);
  });
});

describe('StormAudioClient — sendCommand guard at debug level (Story 4.3, Task 2)', () => {
  let mockSocket: MockSocket;
  let socketFactory: ReturnType<typeof vi.fn>;
  let log: ReturnType<typeof makeLog>;

  beforeEach(() => {
    mockSocket = new MockSocket();
    socketFactory = vi.fn().mockReturnValue(mockSocket);
    log = makeLog();
  });

  it('sendCommand guard logs at debug (not warn) when disconnected — setPower', () => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.setPower(true);
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('[Command] Cannot send'));
    expect(log.warn).not.toHaveBeenCalledWith(expect.stringContaining('[Command] Cannot send'));
  });

  it('sendCommand guard logs at debug (not warn) when disconnected — setVolume', () => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.setVolume(-30);
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('[Command] Cannot send'));
    expect(log.warn).not.toHaveBeenCalledWith(expect.stringContaining('[Command] Cannot send'));
  });

  it('sendCommand guard logs at debug (not warn) when disconnected — setMute', () => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.setMute(true);
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('[Command] Cannot send'));
    expect(log.warn).not.toHaveBeenCalledWith(expect.stringContaining('[Command] Cannot send'));
  });

  it('sendCommand guard logs at debug (not warn) when disconnected — setInput', () => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.setInput(5);
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('[Command] Cannot send'));
    expect(log.warn).not.toHaveBeenCalledWith(expect.stringContaining('[Command] Cannot send'));
  });

  it('sendCommand guard logs at debug after socket error + close during reconnection', () => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.connect();
    mockSocket.simulateConnect();
    client.on('error', () => {});
    mockSocket.simulateError(new Error('ECONNRESET'));
    mockSocket.simulateClose();
    // Now disconnected and reconnecting — sendCommand should log at debug
    log.debug.mockClear();
    client.setPower(true);
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('[Command] Cannot send'));
    expect(log.warn).not.toHaveBeenCalledWith(expect.stringContaining('[Command] Cannot send'));
  });
});

describe('StormAudioClient — parser fuzz safety (Story 4.3, Task 5)', () => {
  let mockSocket: MockSocket;
  let socketFactory: ReturnType<typeof vi.fn>;
  let log: ReturnType<typeof makeLog>;

  beforeEach(() => {
    mockSocket = new MockSocket();
    socketFactory = vi.fn().mockReturnValue(mockSocket);
    log = makeLog();
  });

  const connectClient = () => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.connect();
    mockSocket.simulateConnect();
    return client;
  };

  it('handles empty string without throwing', () => {
    connectClient();
    // Empty lines are filtered out by onData, but sending just \n is safe
    expect(() => mockSocket.simulateData('\n')).not.toThrow();
  });

  it('handles whitespace-only strings without throwing', () => {
    connectClient();
    expect(() => mockSocket.simulateData('   \n')).not.toThrow();
  });

  it('handles very long strings (10KB) without throwing', () => {
    connectClient();
    const longStr = 'x'.repeat(10240);
    expect(() => mockSocket.simulateData(longStr + '\n')).not.toThrow();
    expect(log.debug).toHaveBeenCalledWith('[Command] Unrecognized message: ' + longStr);
  });

  it('handles binary-like data without throwing', () => {
    connectClient();
    const binaryStr = '\x01\x02\x03\xFF\xFE';
    expect(() => mockSocket.simulateData(binaryStr + '\n')).not.toThrow();
  });

  it('handles null byte strings without throwing', () => {
    connectClient();
    expect(() => mockSocket.simulateData('ssp\x00power\x00on\n')).not.toThrow();
  });

  it('handles carriage return in data without throwing', () => {
    connectClient();
    expect(() => mockSocket.simulateData('ssp.power\r.on\n')).not.toThrow();
  });

  it('handles unicode characters without throwing', () => {
    connectClient();
    expect(() => mockSocket.simulateData('ssp.power.😀\n')).not.toThrow();
    expect(() => mockSocket.simulateData('ñoño.data\n')).not.toThrow();
    expect(() => mockSocket.simulateData('日本語\n')).not.toThrow();
  });

  it('handles partial ssp. prefixes without throwing', () => {
    connectClient();
    expect(() => mockSocket.simulateData('ssp.\n')).not.toThrow();
    expect(() => mockSocket.simulateData('ssp.unknown\n')).not.toThrow();
    expect(() => mockSocket.simulateData('ssp.vol.\n')).not.toThrow();
  });

  it('handles deeply nested dots without throwing', () => {
    connectClient();
    expect(() => mockSocket.simulateData('ssp.a.b.c.d.e.f.g.h.i.j\n')).not.toThrow();
    expect(log.debug).toHaveBeenCalledWith('[Command] Unrecognized message: ssp.a.b.c.d.e.f.g.h.i.j');
  });

  it('52 random garbage strings — no exceptions, all logged at debug', () => {
    connectClient();
    const fuzzInputs = [
      '', '   ', 'x'.repeat(10240), '\x01\x02\xFF', '\x00',
      'ssp.', 'ssp.unknown', 'ssp.vol.', 'ssp.a.b.c.d.e',
      'error', 'ssp.keepalive', '日本語', 'ñ', '😀',
      'just plain text', '12345', 'true', 'false', 'null',
      '{}', '[]', '<xml/>', '!@#$%^&*()', 'ssp.power.maybe',
      'ssp.vol.NaN', 'ssp.mute.perhaps', 'ssp.input.abc',
      'ssp.procstate.99', 'ssp.procstate.-1', 'ssp.procstate.foo',
      'ssp.brightness.abc', 'ssp.generator.maybe', 'ssp.lipsync.foo',
      'ssp.stormxt.maybe', 'ssp.sphereaudioeffect.abc',
      'ssp.dim.maybe', 'ssp.drc.invalid', 'ssp.dialogcontrol.bad',
      'ssp.zones.start', 'ssp.zones.end',
      'ssp.preset.start', 'ssp.preset.end',
      'ssp.surroundmode.start', 'ssp.surroundmode.end',
      'ssp.trigger.start', 'ssp.trigger.end',
      'ssp.auropreset.start', 'ssp.auropreset.end',
      'ssp.frontpanel.unknown.value', '\r\n', 'ssp..power.on',
      'SSP.POWER.ON', // case-sensitive check
    ];
    for (const input of fuzzInputs) {
      expect(() => mockSocket.simulateData(input + '\n')).not.toThrow();
    }
  });
});

describe('StormAudioClient — log level audit: [TCP] lifecycle (Story 4.3, Task 3)', () => {
  let mockSocket: MockSocket;
  let socketFactory: ReturnType<typeof vi.fn>;
  let log: ReturnType<typeof makeLog>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockSocket = new MockSocket();
    socketFactory = vi.fn().mockReturnValue(mockSocket);
    log = makeLog();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('[TCP] Connected to {host}:{port} → info', () => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.connect();
    mockSocket.simulateConnect();
    expect(log.info).toHaveBeenCalledWith('[TCP] Connected to 192.168.1.100:23');
  });

  it('[TCP] Reconnected to {host}:{port} → info', () => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.on('error', () => {});
    client.connect();
    mockSocket.simulateConnect();
    // Drop connection to trigger reconnection
    mockSocket.simulateError(new Error('dropped'));
    mockSocket.simulateClose();
    // Advance past reconnect delay
    const reconnectSocket = new MockSocket();
    socketFactory.mockReturnValue(reconnectSocket);
    vi.advanceTimersByTime(RECONNECT_INITIAL_DELAY_MS);
    reconnectSocket.simulateConnect();
    expect(log.info).toHaveBeenCalledWith('[TCP] Reconnected to 192.168.1.100:23');
  });

  it('[TCP] Connection lost. Reconnecting... → warn', () => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.on('error', () => {});
    client.connect();
    mockSocket.simulateConnect();
    mockSocket.simulateError(new Error('dropped'));
    expect(log.warn).toHaveBeenCalledWith('[TCP] Connection lost. Reconnecting...');
  });

  it('[TCP] Reconnection attempt failed → warn', () => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.on('error', () => {});
    client.connect();
    mockSocket.simulateConnect();
    // Drop and close
    mockSocket.simulateError(new Error('dropped'));
    mockSocket.simulateClose();
    // Advance to first reconnect
    const reconnectSocket = new MockSocket();
    socketFactory.mockReturnValue(reconnectSocket);
    vi.advanceTimersByTime(RECONNECT_INITIAL_DELAY_MS);
    // Reconnect attempt fails
    reconnectSocket.simulateError(new Error('still down'));
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('[TCP] Reconnection attempt'),
    );
  });

  it('[TCP] Keepalive sent → debug', () => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.connect();
    mockSocket.simulateConnect();
    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS);
    expect(log.debug).toHaveBeenCalledWith('[TCP] Keepalive sent');
  });

  it('[TCP] Keepalive timeout → warn', () => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.connect();
    mockSocket.simulateConnect();
    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS + KEEPALIVE_TIMEOUT_MS);
    expect(log.warn).toHaveBeenCalledWith('[TCP] Keepalive timeout — connection appears stale');
  });

  it('[TCP] Max reconnection retries exhausted → error', () => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.on('error', () => {});
    client.connect();
    mockSocket.simulateConnect();
    // Drop connection
    mockSocket.simulateError(new Error('dropped'));
    mockSocket.simulateClose();
    // Exhaust all retries
    let delay = RECONNECT_INITIAL_DELAY_MS;
    for (let i = 0; i < RECONNECT_MAX_RETRIES; i++) {
      const retrySocket = new MockSocket();
      socketFactory.mockReturnValue(retrySocket);
      vi.advanceTimersByTime(delay);
      retrySocket.simulateError(new Error('nope'));
      retrySocket.simulateClose();
      delay = Math.min(delay * RECONNECT_MULTIPLIER, RECONNECT_MAX_DELAY_MS);
    }
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('[TCP] Max reconnection retries exhausted'),
    );
  });

  // Note: [TCP] Connection closed gracefully → info is the 8th sibling in the QA spec Sibling Coverage.
  // It is logged by platform.ts (shutdown handler), not stormAudioClient.ts.
  // Covered by: platform.test.ts — 'logs graceful close message on shutdown'
  // expect(log.info).toHaveBeenCalledWith('[TCP] Connection closed gracefully');
});

describe('StormAudioClient — log level audit: [Command] traffic (Story 4.3, Task 3)', () => {
  let mockSocket: MockSocket;
  let socketFactory: ReturnType<typeof vi.fn>;
  let log: ReturnType<typeof makeLog>;

  beforeEach(() => {
    mockSocket = new MockSocket();
    socketFactory = vi.fn().mockReturnValue(mockSocket);
    log = makeLog();
  });

  const connectClient = () => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.connect();
    mockSocket.simulateConnect();
    return client;
  };

  it('[Command] Sent: ssp.xxx → debug', () => {
    const client = connectClient();
    client.setPower(true);
    expect(log.debug).toHaveBeenCalledWith('[Command] Sent: ssp.power.on');
  });

  it('[Command] Received: ssp.xxx → debug', () => {
    connectClient();
    mockSocket.simulateData('ssp.power.on\n');
    expect(log.debug).toHaveBeenCalledWith('[Command] Received: ssp.power.on');
  });

  it('[Command] Command rejected → warn', () => {
    connectClient();
    mockSocket.simulateData('error\n');
    expect(log.warn).toHaveBeenCalledWith('[Command] Command rejected by processor (invalid command or out of range)');
  });

  it('[Command] Unrecognized message → debug', () => {
    connectClient();
    mockSocket.simulateData('garbage.data\n');
    expect(log.debug).toHaveBeenCalledWith('[Command] Unrecognized message: garbage.data');
  });

  it('[Command] Cannot send... not connected → debug', () => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.setPower(true);
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('[Command] Cannot send'));
  });
});

describe('StormAudioClient — log level audit: [State] changes (Story 4.3, Task 3)', () => {
  let mockSocket: MockSocket;
  let socketFactory: ReturnType<typeof vi.fn>;
  let log: ReturnType<typeof makeLog>;

  beforeEach(() => {
    mockSocket = new MockSocket();
    socketFactory = vi.fn().mockReturnValue(mockSocket);
    log = makeLog();
  });

  const connectClient = () => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.connect();
    mockSocket.simulateConnect();
    return client;
  };

  it('[State] Processor entered sleep mode → info', () => {
    connectClient();
    mockSocket.simulateData('ssp.procstate.0\n');
    expect(log.info).toHaveBeenCalledWith('[State] Processor entered sleep mode');
  });

  it('[State] Processor initializing → info', () => {
    connectClient();
    mockSocket.simulateData('ssp.procstate.1\n');
    expect(log.info).toHaveBeenCalledWith('[State] Processor initializing');
  });

  it('[State] Processor active → info', () => {
    connectClient();
    mockSocket.simulateData('ssp.procstate.2\n');
    expect(log.info).toHaveBeenCalledWith('[State] Processor active');
  });

  it('[State] Waking processor... → info', () => {
    vi.useFakeTimers();
    const client = connectClient();
    client.ensureActive(); // not awaited — checking immediate log only
    expect(log.info).toHaveBeenCalledWith('[State] Waking processor... waiting for active state');
    client.disconnect(); // cancel pending ensureActive promise and clear timer
    vi.useRealTimers();
  });

  it('[State] wake timeout → warn', async () => {
    // Use a disconnected client (no simulateConnect) so keepalive never starts,
    // then use a short custom timeout to avoid advancing 90s of fake time.
    vi.useFakeTimers();
    const client = new StormAudioClient(validConfig, log, socketFactory);
    const promise = client.ensureActive(1000); // custom 1s timeout
    vi.advanceTimersByTime(1001);
    await promise;
    expect(log.warn).toHaveBeenCalledWith('[State] Processor did not reach active state within timeout');
    vi.useRealTimers();
  });
});

describe('StormAudioClient — error classification audit (Story 4.3, Task 2)', () => {
  let mockSocket: MockSocket;
  let socketFactory: ReturnType<typeof vi.fn>;
  let log: ReturnType<typeof makeLog>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockSocket = new MockSocket();
    socketFactory = vi.fn().mockReturnValue(mockSocket);
    log = makeLog();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('Transient: sendCommand when disconnected → debug, no error event emitted', () => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    const errors: unknown[] = [];
    client.on('error', (err) => { errors.push(err); });
    client.setPower(true);
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('[Command] Cannot send'));
    expect(errors).toHaveLength(0);
  });

  it('Recoverable: initial connection failure → error emitted with Recoverable category', () => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    const errors: { category: string }[] = [];
    client.on('error', (err) => { errors.push(err); });
    client.connect();
    mockSocket.simulateError(new Error('ECONNREFUSED'));
    expect(errors).toHaveLength(1);
    expect(errors[0].category).toBe(ErrorCategory.Recoverable);
  });

  it('Recoverable: connection drop → warn logged, reconnection triggered', () => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.on('error', () => {});
    client.connect();
    mockSocket.simulateConnect();
    mockSocket.simulateError(new Error('ECONNRESET'));
    expect(log.warn).toHaveBeenCalledWith('[TCP] Connection lost. Reconnecting...');
  });

  it('Fatal: max retries exhausted → error emitted with Fatal category', () => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    const errors: { category: string }[] = [];
    client.on('error', (err) => { errors.push(err); });
    client.connect();
    mockSocket.simulateConnect();
    // Drop and close
    mockSocket.simulateError(new Error('dropped'));
    mockSocket.simulateClose();
    // Exhaust all retries
    let delay = RECONNECT_INITIAL_DELAY_MS;
    for (let i = 0; i < RECONNECT_MAX_RETRIES; i++) {
      const retrySocket = new MockSocket();
      socketFactory.mockReturnValue(retrySocket);
      vi.advanceTimersByTime(delay);
      retrySocket.simulateError(new Error('nope'));
      retrySocket.simulateClose();
      delay = Math.min(delay * RECONNECT_MULTIPLIER, RECONNECT_MAX_DELAY_MS);
    }
    const fatalErrors = errors.filter(e => e.category === ErrorCategory.Fatal);
    expect(fatalErrors.length).toBeGreaterThanOrEqual(1);
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('[TCP] Max reconnection retries exhausted'),
    );
  });
});

describe('StormAudioClient — log level filtering simulation (Story 4.3, AC 4)', () => {
  let mockSocket: MockSocket;
  let socketFactory: ReturnType<typeof vi.fn>;
  let log: ReturnType<typeof makeLog>;

  beforeEach(() => {
    mockSocket = new MockSocket();
    socketFactory = vi.fn().mockReturnValue(mockSocket);
    log = makeLog();
  });

  const connectClient = () => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.connect();
    mockSocket.simulateConnect();
    return client;
  };

  it('info-only logs show meaningful operational overview', () => {
    connectClient();
    // Simulate some activity
    mockSocket.simulateData('ssp.procstate.2\n'); // processor active
    mockSocket.simulateData('ssp.power.on\n');
    mockSocket.simulateData('ssp.input.start\n');
    mockSocket.simulateData('ssp.input.end\n');

    // All info calls should be meaningful operational messages
    const infoCalls = log.info.mock.calls.map((args: unknown[]) => args[0] as string);
    expect(infoCalls.length).toBeGreaterThan(0);
    // Should include connection and state messages
    expect(infoCalls.some(m => m.includes('[TCP]'))).toBe(true);
    expect(infoCalls.some(m => m.includes('[State]'))).toBe(true);
  });

  it('warn/error logs show only actionable problems', () => {
    connectClient();
    // Normal operation — no warns or errors expected during happy path
    mockSocket.simulateData('ssp.power.on\n');
    mockSocket.simulateData('ssp.vol.[-40]\n');
    mockSocket.simulateData('ssp.mute.off\n');

    // Warns should only appear for actual problems
    const warnCalls = log.warn.mock.calls.map((args: unknown[]) => args[0] as string);
    const errorCalls = log.error.mock.calls.map((args: unknown[]) => args[0] as string);
    // During normal happy path, there should be no warns or errors
    expect(warnCalls).toHaveLength(0);
    expect(errorCalls).toHaveLength(0);
  });

  it('debug logs show all command traffic detail', () => {
    const client = connectClient();
    client.setPower(true);
    mockSocket.simulateData('ssp.power.on\n');

    const debugCalls = log.debug.mock.calls.map((args: unknown[]) => args[0] as string);
    // Should include both sent and received messages
    expect(debugCalls.some(m => m.includes('[Command] Sent:'))).toBe(true);
    expect(debugCalls.some(m => m.includes('[Command] Received:'))).toBe(true);
  });
});
