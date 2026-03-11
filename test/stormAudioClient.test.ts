import { EventEmitter } from 'events';

import { describe, expect, it } from 'vitest';

import { StormAudioClient } from '../src/stormAudioClient';

// TCP connection and protocol tests — full implementation in Story 1.2
describe('StormAudioClient scaffold', () => {
  it('is a subclass of EventEmitter', () => {
    const client = new StormAudioClient();
    expect(client).toBeInstanceOf(EventEmitter);
  });

  it('exposes all required stub methods', () => {
    const client = new StormAudioClient();
    expect(typeof client.connect).toBe('function');
    expect(typeof client.disconnect).toBe('function');
    expect(typeof client.setPower).toBe('function');
    expect(typeof client.setVolume).toBe('function');
    expect(typeof client.setInput).toBe('function');
    expect(typeof client.setMute).toBe('function');
  });

  it('stub methods do not throw for valid inputs', () => {
    const client = new StormAudioClient();
    expect(() => client.connect()).not.toThrow();
    expect(() => client.disconnect()).not.toThrow();
    expect(() => client.setPower(true)).not.toThrow();
    expect(() => client.setPower(false)).not.toThrow();
    expect(() => client.setVolume(-20)).not.toThrow();
    expect(() => client.setVolume(-80)).not.toThrow();
    expect(() => client.setInput(1)).not.toThrow();
    expect(() => client.setMute(true)).not.toThrow();
    expect(() => client.setMute(false)).not.toThrow();
  });

  it('on/emit is functional for typed power event', () => {
    const client = new StormAudioClient();
    let received: boolean | null = null;
    client.on('power', (on) => {
      received = on;
    });
    client.emit('power', true);
    expect(received).toBe(true);
    client.emit('power', false);
    expect(received).toBe(false);
  });

  it('once fires exactly one time for connected event', () => {
    const client = new StormAudioClient();
    let callCount = 0;
    client.once('connected', () => {
      callCount++;
    });
    client.emit('connected');
    client.emit('connected');
    expect(callCount).toBe(1);
  });

  it('removeListener stops subsequent event delivery', () => {
    const client = new StormAudioClient();
    let callCount = 0;
    const handler = (): void => {
      callCount++;
    };
    client.on('connected', handler);
    client.emit('connected');
    client.removeListener('connected', handler);
    client.emit('connected');
    expect(callCount).toBe(1);
  });
});
