'use strict';

const path = require('path');
const fs = require('fs');

/**
 * Reads the persisted presets array from Homebridge plugin storage.
 * Returns the parsed array, or [] if the file is missing, invalid JSON, or non-array.
 *
 * @param {string} homebridgeStoragePath - Base Homebridge storage path (e.g. ~/.homebridge)
 * @param {Function} [readFileFn] - fs.readFileSync-compatible function (injected for testing)
 * @returns {Array} Presets array or empty array on any error
 */
function readPresets(homebridgeStoragePath, readFileFn) {
  const read = readFileFn || fs.readFileSync;
  const presetsPath = path.join(homebridgeStoragePath, 'homebridge-stormaudio-isp', 'presets');
  try {
    const raw = read(presetsPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed;
  } catch {
    return [];
  }
}

module.exports = { readPresets };
