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

  it('setVolume(-40) sends ssp.vol.-40\\n', () => {
    const client = connectClient();
    client.setVolume(-40);
    expect(mockSocket.written).toContain('ssp.vol.-40\n');
  });

  it('setInput(3) sends ssp.input.3\\n', () => {
    const client = connectClient();
    client.setInput(3);
    expect(mockSocket.written).toContain('ssp.input.3\n');
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
