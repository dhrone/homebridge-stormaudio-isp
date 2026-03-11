import { describe, expect, it } from 'vitest';

import { PLATFORM_NAME, PLUGIN_NAME } from '../src/settings';

describe('Plugin settings constants', () => {
  it('PLATFORM_NAME is "StormAudioISP"', () => {
    expect(PLATFORM_NAME).toBe('StormAudioISP');
  });

  it('PLUGIN_NAME is "homebridge-stormaudio-isp"', () => {
    expect(PLUGIN_NAME).toBe('homebridge-stormaudio-isp');
  });

  it('PLUGIN_NAME follows homebridge-* naming convention', () => {
    expect(PLUGIN_NAME).toMatch(/^homebridge-/);
  });

  it('PLATFORM_NAME and PLUGIN_NAME are distinct values', () => {
    expect(PLATFORM_NAME).not.toBe(PLUGIN_NAME);
  });
});
