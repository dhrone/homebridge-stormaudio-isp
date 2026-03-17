import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StormAudioClient } from '../src/stormAudioClient';
import { ProcessorState } from '../src/types';
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
  wakeTimeout: 90,
  commandInterval: 0,
  inputs: {},
};

describe('StormAudioClient — processor state logging (Task 1)', () => {
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

  it('logs [State] Processor entered sleep mode on ssp.procstate.0', () => {
    const log = makeLog();
    connectClient(log);
    mockSocket.simulateData('ssp.procstate.0\n');
    expect(log.info).toHaveBeenCalledWith('[State] Processor entered sleep mode');
  });

  it('logs [State] Processor initializing on ssp.procstate.1', () => {
    const log = makeLog();
    connectClient(log);
    mockSocket.simulateData('ssp.procstate.1\n');
    expect(log.info).toHaveBeenCalledWith('[State] Processor initializing');
  });

  it('logs [State] Processor active on ssp.procstate.2', () => {
    const log = makeLog();
    connectClient(log);
    mockSocket.simulateData('ssp.procstate.2\n');
    expect(log.info).toHaveBeenCalledWith('[State] Processor active');
  });
});

describe('StormAudioClient — getProcessorState and getPower getters (Task 3)', () => {
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

  it('getProcessorState() returns ProcessorState.Sleep initially', () => {
    const client = connectClient();
    expect(client.getProcessorState()).toBe(ProcessorState.Sleep);
  });

  it('getProcessorState() returns ProcessorState.Active after ssp.procstate.2', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.procstate.2\n');
    expect(client.getProcessorState()).toBe(ProcessorState.Active);
  });

  it('getPower() returns false initially', () => {
    const client = connectClient();
    expect(client.getPower()).toBe(false);
  });

  it('getPower() returns true after ssp.power.on', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.power.on\n');
    expect(client.getPower()).toBe(true);
  });

  it('getProcessorState() returns ProcessorState.Initializing after ssp.procstate.1', () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.procstate.1\n');
    expect(client.getProcessorState()).toBe(ProcessorState.Initializing);
  });
});

describe('StormAudioClient — ensureActive() (Task 2)', () => {
  let mockSocket: MockSocket;
  let socketFactory: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSocket = new MockSocket();
    socketFactory = vi.fn().mockReturnValue(mockSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const connectClient = (log = makeLog()) => {
    const client = new StormAudioClient(validConfig, log, socketFactory);
    client.connect();
    mockSocket.simulateConnect();
    return client;
  };

  it('returns true immediately when processor is already active', async () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.procstate.2\n');
    const result = await client.ensureActive();
    expect(result).toBe(true);
    // Should not have sent ssp.power.on (only writes would be none in this path)
    expect(mockSocket.written).not.toContain('ssp.power.on\n');
  });

  it('sends ssp.power.on and resolves true when processor transitions from Sleep to Active', async () => {
    const client = connectClient();
    // state is initially Sleep
    const promise = client.ensureActive();
    // Should have sent power on command
    expect(mockSocket.written).toContain('ssp.power.on\n');
    // Simulate processor becoming active
    mockSocket.simulateData('ssp.procstate.2\n');
    const result = await promise;
    expect(result).toBe(true);
  });

  it('logs Waking processor message when called from Sleep state', async () => {
    const log = makeLog();
    const client = connectClient(log);
    const promise = client.ensureActive();
    mockSocket.simulateData('ssp.procstate.2\n');
    await promise;
    expect(log.info).toHaveBeenCalledWith('[State] Waking processor... waiting for active state');
  });

  it('does NOT send ssp.power.on when called from Initializing state', async () => {
    const client = connectClient();
    mockSocket.simulateData('ssp.procstate.1\n'); // set state to Initializing
    const writtenBefore = mockSocket.written.length;
    const promise = client.ensureActive();
    // Should NOT have sent additional ssp.power.on
    const newWrites = mockSocket.written.slice(writtenBefore);
    expect(newWrites).not.toContain('ssp.power.on\n');
    // Simulate processor becoming active
    mockSocket.simulateData('ssp.procstate.2\n');
    const result = await promise;
    expect(result).toBe(true);
  });

  it('logs Processor initializing message when called from Initializing state', async () => {
    const log = makeLog();
    const client = connectClient(log);
    mockSocket.simulateData('ssp.procstate.1\n');
    const promise = client.ensureActive();
    mockSocket.simulateData('ssp.procstate.2\n');
    await promise;
    expect(log.info).toHaveBeenCalledWith('[State] Processor initializing... waiting for active state');
  });

  it('logs Processor active — ready for commands when active state is reached', async () => {
    const log = makeLog();
    const client = connectClient(log);
    const promise = client.ensureActive();
    mockSocket.simulateData('ssp.procstate.2\n');
    await promise;
    expect(log.info).toHaveBeenCalledWith('[State] Processor active — ready for commands');
  });

  it('returns false and logs warn after timeout', async () => {
    vi.useFakeTimers();
    const log = makeLog();
    const client = connectClient(log);
    const promise = client.ensureActive(1000);
    vi.advanceTimersByTime(1001);
    const result = await promise;
    expect(result).toBe(false);
    expect(log.warn).toHaveBeenCalledWith('[State] Processor did not reach active state within timeout');
  });

  it('disconnected: sendCommand logs debug; ensureActive returns false on timeout (no throw)', async () => {
    vi.useFakeTimers();
    const log = makeLog();
    const client = new StormAudioClient(validConfig, log, socketFactory); // NOT connected
    const promise = client.ensureActive(1000);
    // sendCommand should have logged debug (socket is null) — Story 4.3 changed from warn to debug
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('[Command] Cannot send'));
    vi.advanceTimersByTime(1001);
    await expect(promise).resolves.toBe(false);
  });

  it('waits through Initializing state and resolves true only on Active', async () => {
    const client = connectClient();
    const promise = client.ensureActive();
    // Processor transitions: Sleep → Initializing (should not resolve)
    mockSocket.simulateData('ssp.procstate.1\n');
    // Processor transitions: Initializing → Active (should resolve)
    mockSocket.simulateData('ssp.procstate.2\n');
    const result = await promise;
    expect(result).toBe(true);
  });

  it('cleans up processorState listener after resolving true', async () => {
    const client = connectClient();
    const before = client.listenerCount('processorState');
    const promise = client.ensureActive();
    expect(client.listenerCount('processorState')).toBe(before + 1);
    mockSocket.simulateData('ssp.procstate.2\n');
    await promise;
    expect(client.listenerCount('processorState')).toBe(before);
  });

  it('cleans up processorState listener after timeout', async () => {
    vi.useFakeTimers();
    const client = connectClient();
    const before = client.listenerCount('processorState');
    const promise = client.ensureActive(1000);
    expect(client.listenerCount('processorState')).toBe(before + 1);
    vi.advanceTimersByTime(1001);
    await promise;
    expect(client.listenerCount('processorState')).toBe(before);
  });

  it('concurrent calls share a single wake — only one ssp.power.on sent', async () => {
    const log = makeLog();
    const client = connectClient(log);
    // Fire 4 concurrent ensureActive() calls (simulates multiple HomeKit handlers)
    const p1 = client.ensureActive();
    const p2 = client.ensureActive();
    const p3 = client.ensureActive();
    const p4 = client.ensureActive();
    // Only ONE power-on command should have been sent
    const powerOnCount = mockSocket.written.filter((w: string) => w === 'ssp.power.on\n').length;
    expect(powerOnCount).toBe(1);
    // Only ONE "Waking processor" log
    const wakeLogs = log.info.mock.calls.filter(
      (c: unknown[]) => c[0] === '[State] Waking processor... waiting for active state',
    );
    expect(wakeLogs).toHaveLength(1);
    // Only ONE processorState listener added
    expect(client.listenerCount('processorState')).toBe(1);
    // Resolve all — all 4 should get true
    mockSocket.simulateData('ssp.procstate.2\n');
    const results = await Promise.all([p1, p2, p3, p4]);
    expect(results).toEqual([true, true, true, true]);
    // Listener cleaned up
    expect(client.listenerCount('processorState')).toBe(0);
  });

  it('wakePromise is cleared after resolution — next call creates a new wake', async () => {
    const client = connectClient();
    // First wake cycle
    const p1 = client.ensureActive();
    mockSocket.simulateData('ssp.procstate.2\n');
    await p1;
    // Put processor back to sleep
    mockSocket.simulateData('ssp.procstate.0\n');
    // Second wake cycle — should send a new ssp.power.on
    const writtenBefore = mockSocket.written.length;
    const p2 = client.ensureActive();
    const newWrites = mockSocket.written.slice(writtenBefore);
    expect(newWrites).toContain('ssp.power.on\n');
    mockSocket.simulateData('ssp.procstate.2\n');
    const result = await p2;
    expect(result).toBe(true);
  });

  it('concurrent calls share timeout — all get false on timeout', async () => {
    vi.useFakeTimers();
    const client = connectClient();
    const p1 = client.ensureActive(1000);
    const p2 = client.ensureActive(1000);
    const p3 = client.ensureActive(1000);
    vi.advanceTimersByTime(1001);
    const results = await Promise.all([p1, p2, p3]);
    expect(results).toEqual([false, false, false]);
    // Listener cleaned up
    expect(client.listenerCount('processorState')).toBe(0);
  });
});
