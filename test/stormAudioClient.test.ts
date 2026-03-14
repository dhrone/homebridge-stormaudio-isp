import { EventEmitter } from 'events';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StormAudioClient } from '../src/stormAudioClient';
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
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('[State] Skipped malformed input list entry:'));
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
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('[State] Skipped malformed input list entry:'));
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
