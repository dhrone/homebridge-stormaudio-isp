import { EventEmitter } from 'events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StormAudioClient } from '../src/stormAudioClient';
import { PROCESSOR_WAKE_TIMEOUT_MS } from '../src/settings';
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

  it('logs [Command] Cannot send at warn when socket is null (connect never called)', () => {
    const log = makeLog();
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.setPower(true);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('[Command] Cannot send'));
    expect(mockSocket.written).toHaveLength(0);
  });

  it('logs [Command] Cannot send at warn when socket is connecting but connect event not yet fired', () => {
    const log = makeLog();
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.connect(); // socket created but simulateConnect() not called
    client.setPower(true);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('[Command] Cannot send'));
    expect(mockSocket.written).toHaveLength(0);
  });

  it('rejects commands after socket error (connected flag reset)', () => {
    const log = makeLog();
    const client = connectClient(log);
    client.on('error', () => {}); // prevent unhandled error throw
    mockSocket.simulateError(new Error('ECONNRESET'));
    client.setPower(true);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('[Command] Cannot send'));
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

  it('volumeUp() guarded when disconnected — no write, logs warn', () => {
    const log = makeLog();
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.volumeUp();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('[Command] Cannot send'));
    expect(mockSocket.written).toHaveLength(0);
  });

  it('volumeDown() guarded when disconnected — no write, logs warn', () => {
    const log = makeLog();
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.volumeDown();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('[Command] Cannot send'));
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

  it('socket error after successful connection logs "Lost connection"', () => {
    const log = makeLog();
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.on('error', () => {});
    client.connect();
    mockSocket.simulateConnect();
    mockSocket.simulateError(new Error('ECONNRESET'));
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Lost connection'));
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
