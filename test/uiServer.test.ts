/**
 * Tests for homebridge-ui/zonesHandler.js — readZones() (Story 5.3, Tasks 7.4–7.5b)
 *
 * Strategy: test readZones() as a plain function directly using dependency injection.
 * readZones accepts an optional readFileFn parameter for testability, following the
 * story's guidance: "test the handler logic as a plain function extracted into a
 * testable module."
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readZones } = require('../homebridge-ui/zonesHandler.js') as {
  readZones: (storagePath: string, readFileFn?: (p: string, enc: string) => string) => unknown[];
};

const MOCK_STORAGE = '/mock-storage';
const EXPECTED_ZONES_PATH = path.join(MOCK_STORAGE, 'homebridge-stormaudio-isp', 'zones');

describe('readZones — /zones endpoint handler logic (Story 5.3)', () => {
  let readFileMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    readFileMock = vi.fn();
  });

  // QA-8: returns zone array from storage
  it('QA-8: returns zone array when storage file exists', () => {
    const zones = [
      { id: 1, name: 'Downmix' },
      { id: 13, name: 'Zone 2' },
    ];
    readFileMock.mockReturnValue(JSON.stringify(zones));
    expect(readZones(MOCK_STORAGE, readFileMock)).toEqual(zones);
  });

  // QA-9: returns [] when file does not exist (ENOENT)
  it('QA-9: returns [] when storage file is missing (ENOENT)', () => {
    const err = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    readFileMock.mockImplementation(() => {
      throw err;
    });
    expect(readZones(MOCK_STORAGE, readFileMock)).toEqual([]);
  });

  // QA-19: returns [] when storage contains non-array JSON object
  it('QA-19 (object): returns [] when storage contains non-array JSON object', () => {
    readFileMock.mockReturnValue('{"not": "an array"}');
    expect(readZones(MOCK_STORAGE, readFileMock)).toEqual([]);
  });

  // QA-19: returns [] when storage contains non-array JSON string
  it('QA-19 (string): returns [] when storage contains non-array JSON string', () => {
    readFileMock.mockReturnValue('"just a string"');
    expect(readZones(MOCK_STORAGE, readFileMock)).toEqual([]);
  });

  // Returns [] when storage contains invalid JSON
  it('returns [] when storage contains invalid JSON', () => {
    readFileMock.mockReturnValue('not valid json at all');
    expect(readZones(MOCK_STORAGE, readFileMock)).toEqual([]);
  });

  // Returns [] when storage file is empty (JSON.parse('') throws SyntaxError)
  it('returns [] when storage file is empty', () => {
    readFileMock.mockReturnValue('');
    expect(readZones(MOCK_STORAGE, readFileMock)).toEqual([]);
  });

  // Reads from correct path: <homebridgeStoragePath>/homebridge-stormaudio-isp/zones
  it('reads from the correct storage path', () => {
    readFileMock.mockReturnValue('[]');
    readZones(MOCK_STORAGE, readFileMock);
    expect(readFileMock).toHaveBeenCalledWith(EXPECTED_ZONES_PATH, 'utf-8');
  });
});
