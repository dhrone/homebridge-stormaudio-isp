import { describe, expect, it, vi } from 'vitest';

import { validateConfig } from '../src/platform';

const makeLog = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
});

const baseConfig = {
  platform: 'StormAudioISP',
  host: '192.168.1.100',
};

describe('validateConfig — host', () => {
  it('returns null and logs error when host is missing', () => {
    const log = makeLog();
    const result = validateConfig({ platform: 'StormAudioISP' }, log);
    expect(result).toBeNull();
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('[Config]'));
  });

  it('returns null when host is empty string', () => {
    const log = makeLog();
    const result = validateConfig({ platform: 'StormAudioISP', host: '' }, log);
    expect(result).toBeNull();
    expect(log.error).toHaveBeenCalled();
  });

  it('returns null when host is a non-string type', () => {
    const log = makeLog();
    const result = validateConfig({ platform: 'StormAudioISP', host: 123 }, log);
    expect(result).toBeNull();
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('[Config]'));
  });

  it('accepts a valid host', () => {
    const log = makeLog();
    const result = validateConfig(baseConfig, log);
    expect(result).not.toBeNull();
    expect(result!.host).toBe('192.168.1.100');
  });
});

describe('validateConfig — port', () => {
  it('defaults port to 23 when not provided', () => {
    const log = makeLog();
    const result = validateConfig(baseConfig, log);
    expect(result!.port).toBe(23);
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('[Config]'));
  });

  it('accepts a valid port', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, port: 2000 }, log);
    expect(result!.port).toBe(2000);
  });

  it('returns null when port is 0', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, port: 0 }, log);
    expect(result).toBeNull();
    expect(log.error).toHaveBeenCalled();
  });

  it('returns null when port is 65536', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, port: 65536 }, log);
    expect(result).toBeNull();
    expect(log.error).toHaveBeenCalled();
  });

  it('accepts port 1 (lower boundary)', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, port: 1 }, log);
    expect(result!.port).toBe(1);
  });

  it('accepts port 65535 (upper boundary)', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, port: 65535 }, log);
    expect(result!.port).toBe(65535);
  });
});

describe('validateConfig — name', () => {
  it('defaults name to "StormAudio" when not provided', () => {
    const log = makeLog();
    const result = validateConfig(baseConfig, log);
    expect(result!.name).toBe('StormAudio');
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('[Config]'));
  });

  it('defaults name to "StormAudio" when name is empty string', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, name: '' }, log);
    expect(result!.name).toBe('StormAudio');
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('[Config]'));
  });

  it('uses provided name', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, name: 'Theater' }, log);
    expect(result!.name).toBe('Theater');
  });
});

describe('validateConfig — volumeCeiling', () => {
  it('defaults volumeCeiling to -20', () => {
    const log = makeLog();
    const result = validateConfig(baseConfig, log);
    expect(result!.volumeCeiling).toBe(-20);
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('[Config]'));
  });

  it('accepts -20 as volumeCeiling', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, volumeCeiling: -20 }, log);
    expect(result!.volumeCeiling).toBe(-20);
  });

  it('returns null when volumeCeiling is 1 (above 0)', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, volumeCeiling: 1 }, log);
    expect(result).toBeNull();
    expect(log.error).toHaveBeenCalled();
  });

  it('returns null when volumeCeiling is -101 (below -100)', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, volumeCeiling: -101 }, log);
    expect(result).toBeNull();
    expect(log.error).toHaveBeenCalled();
  });
});

describe('validateConfig — volumeFloor', () => {
  it('defaults volumeFloor to -100', () => {
    const log = makeLog();
    const result = validateConfig(baseConfig, log);
    expect(result!.volumeFloor).toBe(-100);
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('[Config]'));
  });

  it('returns null when volumeFloor >= volumeCeiling', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, volumeFloor: -20, volumeCeiling: -20 }, log);
    expect(result).toBeNull();
    expect(log.error).toHaveBeenCalled();
  });

  it('returns null when volumeFloor > volumeCeiling', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, volumeFloor: -10, volumeCeiling: -20 }, log);
    expect(result).toBeNull();
    expect(log.error).toHaveBeenCalled();
  });

  it('accepts volumeFloor less than volumeCeiling', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, volumeFloor: -80, volumeCeiling: -20 }, log);
    expect(result!.volumeFloor).toBe(-80);
    expect(result!.volumeCeiling).toBe(-20);
  });
});

describe('validateConfig — volumeControl', () => {
  it('defaults volumeControl to "fan"', () => {
    const log = makeLog();
    const result = validateConfig(baseConfig, log);
    expect(result!.volumeControl).toBe('fan');
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('[Config]'));
  });

  it('accepts "fan" as volumeControl', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, volumeControl: 'fan' }, log);
    expect(result!.volumeControl).toBe('fan');
  });

  it('accepts "lightbulb" as volumeControl', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, volumeControl: 'lightbulb' }, log);
    expect(result!.volumeControl).toBe('lightbulb');
  });

  it('accepts "none" as volumeControl', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, volumeControl: 'none' }, log);
    expect(result!.volumeControl).toBe('none');
  });

  it('returns null for invalid volumeControl value', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, volumeControl: 'slider' }, log);
    expect(result).toBeNull();
    expect(log.error).toHaveBeenCalled();
  });
});

describe('validateConfig — wakeTimeout', () => {
  it('defaults wakeTimeout to 90', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig }, log);
    expect(result!.wakeTimeout).toBe(90);
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('wakeTimeout'));
  });

  it('accepts wakeTimeout within range (120)', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, wakeTimeout: 120 }, log);
    expect(result!.wakeTimeout).toBe(120);
  });

  it('accepts wakeTimeout at lower boundary (30)', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, wakeTimeout: 30 }, log);
    expect(result!.wakeTimeout).toBe(30);
  });

  it('accepts wakeTimeout at upper boundary (300)', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, wakeTimeout: 300 }, log);
    expect(result!.wakeTimeout).toBe(300);
  });

  it('returns null for wakeTimeout below minimum (29)', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, wakeTimeout: 29 }, log);
    expect(result).toBeNull();
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('wakeTimeout'));
  });

  it('returns null for wakeTimeout above maximum (301)', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, wakeTimeout: 301 }, log);
    expect(result).toBeNull();
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('wakeTimeout'));
  });
});

describe('validateConfig — commandInterval', () => {
  it('defaults commandInterval to 100 when not provided', () => {
    const log = makeLog();
    const result = validateConfig(baseConfig, log);
    expect(result!.commandInterval).toBe(100);
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('commandInterval'));
  });

  it('accepts commandInterval within range (50)', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, commandInterval: 50 }, log);
    expect(result!.commandInterval).toBe(50);
  });

  it('accepts commandInterval at lower boundary (0)', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, commandInterval: 0 }, log);
    expect(result!.commandInterval).toBe(0);
  });

  it('accepts commandInterval at upper boundary (1000)', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, commandInterval: 1000 }, log);
    expect(result!.commandInterval).toBe(1000);
  });

  it('returns null for commandInterval below minimum (-1)', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, commandInterval: -1 }, log);
    expect(result).toBeNull();
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('commandInterval'));
  });

  it('returns null for commandInterval above maximum (1001)', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, commandInterval: 1001 }, log);
    expect(result).toBeNull();
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('commandInterval'));
  });
});
