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

describe('validateConfig — zone2 (Story 5.1)', () => {
  // Sibling: zone2 absent → no error, zone2 undefined on config
  it('zone2 absent — returns config with zone2 undefined, no errors', () => {
    const log = makeLog();
    const result = validateConfig(baseConfig, log);
    expect(result).not.toBeNull();
    expect(result!.zone2).toBeUndefined();
    expect(log.error).not.toHaveBeenCalled();
  });

  // Sibling: zone2 present but not an object → error
  it('zone2 is a string — returns null with error', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, zone2: 'invalid' }, log);
    expect(result).toBeNull();
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('zone2'));
  });

  it('zone2 is a number — returns null with error', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, zone2: 42 }, log);
    expect(result).toBeNull();
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('zone2'));
  });

  it('zone2 is an array — returns null with error', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, zone2: [1, 2] }, log);
    expect(result).toBeNull();
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('zone2'));
  });

  // Sibling: zone2 present, zoneId present → normal creation
  it('zone2 with explicit zoneId — returns config with zone2 populated', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, zone2: { zoneId: 13 } }, log);
    expect(result).not.toBeNull();
    expect(result!.zone2).toBeDefined();
    expect(result!.zone2!.zoneId).toBe(13);
  });

  // Sibling: zone2 present, zoneId omitted → default to 1
  it('zone2 with zoneId omitted — defaults to 1 and logs debug message', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, zone2: {} }, log);
    expect(result).not.toBeNull();
    expect(result!.zone2!.zoneId).toBe(1);
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('zone2.zoneId not specified'));
  });

  it('zone2 default name is "Zone 2" when omitted', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, zone2: { zoneId: 5 } }, log);
    expect(result!.zone2!.name).toBe('Zone 2');
  });

  it('zone2 uses provided name', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, zone2: { zoneId: 5, name: 'Patio' } }, log);
    expect(result!.zone2!.name).toBe('Patio');
  });

  it('zone2 default volumeFloor is -80 when omitted', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, zone2: { zoneId: 5 } }, log);
    expect(result!.zone2!.volumeFloor).toBe(-80);
  });

  it('zone2 default volumeCeiling is 0 when omitted', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, zone2: { zoneId: 5 } }, log);
    expect(result!.zone2!.volumeCeiling).toBe(0);
  });

  it('zone2 default volumeControl is "none" when omitted', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, zone2: { zoneId: 5 } }, log);
    expect(result!.zone2!.volumeControl).toBe('none');
  });

  // Sibling: floor >= ceiling → error
  it('zone2 floor >= ceiling — returns null with error', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, zone2: { zoneId: 5, volumeFloor: -20, volumeCeiling: -80 } }, log);
    expect(result).toBeNull();
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('volumeFloor'));
  });

  it('zone2 floor == ceiling — returns null with error', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, zone2: { zoneId: 5, volumeFloor: -40, volumeCeiling: -40 } }, log);
    expect(result).toBeNull();
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('volumeFloor'));
  });

  // Sibling: floor/ceiling out of range → error
  it('zone2 volumeFloor below -100 — returns null with error', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, zone2: { zoneId: 5, volumeFloor: -200 } }, log);
    expect(result).toBeNull();
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('volumeFloor'));
  });

  it('zone2 volumeCeiling above 0 — returns null with error', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, zone2: { zoneId: 5, volumeFloor: -80, volumeCeiling: 10 } }, log);
    expect(result).toBeNull();
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('volumeCeiling'));
  });

  // Sibling: invalid volumeControl → error
  it('zone2 invalid volumeControl — returns null with error', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, zone2: { zoneId: 5, volumeControl: 'knob' } }, log);
    expect(result).toBeNull();
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('volumeControl'));
  });

  it('zone2 volumeControl "fan" is accepted', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, zone2: { zoneId: 5, volumeControl: 'fan' } }, log);
    expect(result!.zone2!.volumeControl).toBe('fan');
  });

  it('zone2 volumeControl "lightbulb" is accepted', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, zone2: { zoneId: 5, volumeControl: 'lightbulb' } }, log);
    expect(result!.zone2!.volumeControl).toBe('lightbulb');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateConfig — presets (Story 6.1)
// ─────────────────────────────────────────────────────────────────────────────

describe('validateConfig — presets', () => {
  it('presets absent → no error, presets undefined on config', () => {
    const log = makeLog();
    const result = validateConfig(baseConfig, log);
    expect(result).not.toBeNull();
    expect(result!.presets).toBeUndefined();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('presets present, enabled=true → config returned with enabled=true', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, presets: { enabled: true } }, log);
    expect(result).not.toBeNull();
    expect(result!.presets?.enabled).toBe(true);
  });

  it('presets present, enabled=false → config returned with enabled=false', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, presets: { enabled: false } }, log);
    expect(result).not.toBeNull();
    expect(result!.presets?.enabled).toBe(false);
  });

  it('presets present, enabled omitted → defaults to false', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, presets: {} }, log);
    expect(result).not.toBeNull();
    expect(result!.presets?.enabled).toBe(false);
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('presets.enabled'));
  });

  it('presets present, name specified → uses specified name', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, presets: { enabled: true, name: 'Theater Presets' } }, log);
    expect(result!.presets?.name).toBe('Theater Presets');
  });

  it('presets present, name omitted → defaults to "Presets"', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, presets: { enabled: true } }, log);
    expect(result!.presets?.name).toBe('Presets');
  });

  it('presets present, aliases is non-object → returns null with error', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, presets: { enabled: true, aliases: 'bad' } }, log);
    expect(result).toBeNull();
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('presets.aliases'));
  });

  it('presets is non-object (string) → returns null with error', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, presets: 'invalid' }, log);
    expect(result).toBeNull();
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('"presets"'));
  });

  it('presets present, enabled is non-boolean (string) → defaults to false', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, presets: { enabled: 'yes' } }, log);
    expect(result).not.toBeNull();
    expect(result!.presets?.enabled).toBe(false);
  });

  it('presets present, name is non-string (number) → defaults to "Presets"', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, presets: { enabled: true, name: 123 } }, log);
    expect(result).not.toBeNull();
    expect(result!.presets?.name).toBe('Presets');
  });

  it('presets aliases absent → defaults to {}', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, presets: { enabled: true } }, log);
    expect(result!.presets?.aliases).toEqual({});
  });

  it('presets aliases provided → uses provided aliases', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, presets: { enabled: true, aliases: { '9': 'Movie Night' } } }, log);
    expect(result!.presets?.aliases).toEqual({ '9': 'Movie Night' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateConfig — triggers (Story 6.2)
// ─────────────────────────────────────────────────────────────────────────────

describe('validateConfig — triggers', () => {
  it('triggers absent → no error, triggers undefined on config', () => {
    const log = makeLog();
    const result = validateConfig(baseConfig, log);
    expect(result).not.toBeNull();
    expect(result!.triggers).toBeUndefined();
  });

  it('triggers present with valid switch → normal creation', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, triggers: { '1': { name: 'Amp Power', type: 'switch' } } }, log);
    expect(result).not.toBeNull();
    expect(result!.triggers?.['1']).toEqual({ name: 'Amp Power', type: 'switch' });
  });

  it('triggers present with valid contact → normal creation', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, triggers: { '2': { name: 'Screen Down', type: 'contact' } } }, log);
    expect(result).not.toBeNull();
    expect(result!.triggers?.['2']).toEqual({ name: 'Screen Down', type: 'contact' });
  });

  it('triggers present with "none" short form → trigger skipped, no error', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, triggers: { '3': 'none' } }, log);
    expect(result).not.toBeNull();
    expect(result!.triggers).toBeUndefined();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('triggers present with "none" long form → trigger skipped, no error', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, triggers: { '3': { type: 'none' } } }, log);
    expect(result).not.toBeNull();
    expect(result!.triggers).toBeUndefined();
  });

  it('triggers present with invalid type → returns null with error', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, triggers: { '1': { name: 'Bad', type: 'invalid' } } }, log);
    expect(result).toBeNull();
    expect(log.error).toHaveBeenCalled();
  });

  it('triggers present with invalid ID "5" → warning and skip', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, triggers: { '5': { name: 'Invalid', type: 'switch' } } }, log);
    expect(result).not.toBeNull();
    expect(result!.triggers).toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('"5"'));
  });

  it('triggers present with invalid ID "0" → warning and skip', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, triggers: { '0': { name: 'Invalid', type: 'switch' } } }, log);
    expect(result).not.toBeNull();
    expect(result!.triggers).toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('"0"'));
  });

  it('triggers present with invalid ID "-1" → warning and skip', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, triggers: { '-1': { name: 'Negative', type: 'switch' } } }, log);
    expect(result).not.toBeNull();
    expect(result!.triggers).toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('"-1"'));
  });

  it('triggers present with invalid ID "1.5" → warning and skip', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, triggers: { '1.5': { name: 'Fractional', type: 'switch' } } }, log);
    expect(result).not.toBeNull();
    expect(result!.triggers).toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('"1.5"'));
  });

  it('triggers present with non-numeric ID "abc" → warning and skip', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, triggers: { 'abc': { name: 'Invalid', type: 'switch' } } }, log);
    expect(result).not.toBeNull();
    expect(result!.triggers).toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('"abc"'));
  });

  it('triggers present with valid ID "4" (upper boundary) → normal creation', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, triggers: { '4': { name: 'Trigger 4', type: 'switch' } } }, log);
    expect(result).not.toBeNull();
    expect(result!.triggers?.['4']).toBeDefined();
  });

  it('triggers entry is non-string non-object → returns null with error', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, triggers: { '1': 42 } }, log);
    expect(result).toBeNull();
    expect(log.error).toHaveBeenCalled();
  });

  it('triggers is not an object → returns null with error', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, triggers: 'invalid' }, log);
    expect(result).toBeNull();
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('"triggers"'));
  });

  it('triggers is empty object {} → no error, triggers undefined on config', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, triggers: {} }, log);
    expect(result).not.toBeNull();
    expect(result!.triggers).toBeUndefined();
  });

  it('triggers short form non-"none" string → returns null with error', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, triggers: { '1': 'switch' } }, log);
    expect(result).toBeNull();
    expect(log.error).toHaveBeenCalled();
  });

  it('trigger name defaults when omitted → "Trigger N"', () => {
    const log = makeLog();
    const result = validateConfig({ ...baseConfig, triggers: { '2': { type: 'switch' } } }, log);
    expect(result!.triggers?.['2']?.name).toBe('Trigger 2');
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('Trigger 2'));
  });

  it('mixed triggers — only switch/contact entries in returned config', () => {
    const log = makeLog();
    const result = validateConfig({
      ...baseConfig,
      triggers: {
        '1': { name: 'Amp', type: 'switch' },
        '2': 'none',
        '3': { name: 'Screen', type: 'contact' },
      },
    }, log);
    expect(result).not.toBeNull();
    expect(Object.keys(result!.triggers ?? {})).toEqual(expect.arrayContaining(['1', '3']));
    expect(result!.triggers?.['2']).toBeUndefined();
  });

  it('all 4 triggers as switch → config has all 4 entries', () => {
    const log = makeLog();
    const result = validateConfig({
      ...baseConfig,
      triggers: {
        '1': { name: 'T1', type: 'switch' },
        '2': { name: 'T2', type: 'switch' },
        '3': { name: 'T3', type: 'switch' },
        '4': { name: 'T4', type: 'switch' },
      },
    }, log);
    expect(result).not.toBeNull();
    expect(Object.keys(result!.triggers ?? {})).toHaveLength(4);
  });
});
