#!/usr/bin/env npx ts-node
/**
 * Zone 2 Command Investigation
 *
 * Hardware validation for PB-3/4/5 (Zone 2 volume, mute, source, useZone2Source).
 * Tests zone-specific commands that were not validated during MVP development.
 *
 * Tests:
 * 1. Capture initial zone state from state dump
 * 2. Zone volume set: ssp.zones.volume.[ID, value]
 * 3. Zone mute toggle: ssp.zones.mute.[ID, on/off]
 * 4. Zone useZone2Source toggle: ssp.zones.useZone2.[ID, on/off]
 * 5. inputZone2 set: ssp.inputZone2.[id]
 * 6. Zone bass/treble: ssp.zones.bass.[ID, value], ssp.zones.treble.[ID, value]
 * 7. Restore original state
 *
 * Usage:
 *   npx ts-node test/hardware/zoneInvestigation.ts
 *
 * Requires test/hardware/config.json to be present.
 */

import * as fs from 'fs';
import * as path from 'path';

import { StormAudioClient } from '../../src/stormAudioClient';
import { ProcessorState } from '../../src/types';
import type { StormAudioConfig, StormAudioError, ZoneState } from '../../src/types';
import { HarnessLogger } from './logger';
import type { HardwareTestConfig } from './types';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function loadConfig(): HardwareTestConfig {
  const configPath = path.resolve(__dirname, 'config.json');
  const raw = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(raw) as HardwareTestConfig;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const protocolLog: { ts: number; msg: string }[] = [];

function createClient(config: HardwareTestConfig, log: HarnessLogger): StormAudioClient {
  const stormConfig: StormAudioConfig = {
    host: config.host,
    port: config.port,
    name: 'ZoneInvestigation',
    volumeCeiling: config.volumeCeiling,
    volumeFloor: config.volumeFloor,
    volumeControl: 'fan',
    wakeTimeout: 90,
    commandInterval: 0, // no throttle — we want to see raw behavior
    inputs: {},
  };

  const client = new StormAudioClient(stormConfig, log);
  client.on('error', (err: StormAudioError) => {
    log.warn(`[Test] Client error: ${err.category} — ${err.message}`);
  });
  return client;
}

function connectAndWait(client: StormAudioClient, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.disconnect();
      reject(new Error('Connection timeout'));
    }, timeoutMs);

    client.on('inputList', () => {
      clearTimeout(timer);
      resolve();
    });

    client.connect();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Send a raw command and wait for a zone update event or timeout.
 * Returns the event data or null on timeout.
 */
function sendAndWaitZoneUpdate(
  client: StormAudioClient,
  command: string,
  timeoutMs = 5000,
): Promise<{ zoneId: number; field: string; value: unknown } | null> {
  return new Promise((resolve) => {
    // handler and timer reference each other — unavoidable circular declaration
    const handler = (zoneId: number, field: string, value: unknown): void => {
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      clearTimeout(timer);
      client.removeListener('zoneUpdate', handler);
      resolve({ zoneId, field, value });
    };

    const timer = setTimeout(() => {
      client.removeListener('zoneUpdate', handler);
      resolve(null);
    }, timeoutMs);

    client.on('zoneUpdate', handler);
    // Use the internal sendCommand — no public zone command API exists
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).sendCommand(command + '\n');
  });
}

// ---------------------------------------------------------------------------
// Test functions
// ---------------------------------------------------------------------------

async function testZoneState(client: StormAudioClient): Promise<Map<number, ZoneState>> {
  console.log('\n=== TEST 1: Initial Zone State ===\n');

  const zones = client.getZones();
  const profiles = client.getZoneProfiles();

  if (zones.size === 0) {
    console.log('WARNING: No zones reported by processor.');
    console.log('Zone list may not be configured on this processor.');
    return zones;
  }

  console.log(`Zones found: ${zones.size}`);
  for (const [id, zone] of zones) {
    console.log(`\n  Zone ${id}: "${zone.name}"`);
    console.log(`    layout=${zone.layout}, type=${zone.type}`);
    console.log(`    useZone2Source=${zone.useZone2Source}`);
    console.log(`    volume=${zone.volume} dB, mute=${zone.mute}`);
    console.log(`    bass=${zone.bass}, treble=${zone.treble}`);
    console.log(`    loudness=${zone.loudness}, mode=${zone.mode}`);
    console.log(`    delay=${zone.delay}, eq=${zone.eq}, lipsync=${zone.lipsync}`);
    console.log(`    avzones=${zone.avzones}`);
  }

  console.log(`\nZone profiles: ${profiles.length}`);
  for (const p of profiles) {
    console.log(`  Zone ${p.zoneId} / Profile ${p.profileId}: "${p.name}" (active=${p.active})`);
  }

  return zones;
}

async function testZoneVolume(client: StormAudioClient, zoneId: number, originalVol: number): Promise<void> {
  console.log('\n=== TEST 2: Zone Volume ===\n');

  // Try setting zone volume to a safe test value
  const testVol = Math.max(originalVol - 5, -78);
  console.log(`Sending: ssp.zones.volume.[${zoneId}, ${testVol}]`);

  const result = await sendAndWaitZoneUpdate(client, `ssp.zones.volume.[${zoneId}, ${testVol}]`);

  if (result) {
    console.log(`  Response: zoneId=${result.zoneId}, field=${result.field}, value=${result.value}`);
    console.log(`  PASS — Zone volume command acknowledged.`);
  } else {
    console.log(`  No zoneUpdate event received within 5s.`);
    console.log(`  Checking zone state directly...`);
    const zone = client.getZones().get(zoneId);
    console.log(`  Zone ${zoneId} volume is now: ${zone?.volume}`);
    if (zone && zone.volume === testVol) {
      console.log(`  PASS — Volume changed (no event, but state updated).`);
    } else {
      console.log(`  FAIL — Volume did not change.`);
    }
  }

  // Restore
  console.log(`\nRestoring volume to ${originalVol}...`);
  await sendAndWaitZoneUpdate(client, `ssp.zones.volume.[${zoneId}, ${originalVol}]`);
  await sleep(500);
  const restored = client.getZones().get(zoneId);
  console.log(`  Restored: ${restored?.volume} dB`);
}

async function testZoneMute(client: StormAudioClient, zoneId: number, originalMute: boolean): Promise<void> {
  console.log('\n=== TEST 3: Zone Mute ===\n');

  const toggleTo = originalMute ? 'off' : 'on';
  console.log(`Sending: ssp.zones.mute.[${zoneId}, ${toggleTo}]`);

  const result = await sendAndWaitZoneUpdate(client, `ssp.zones.mute.[${zoneId}, ${toggleTo}]`);

  if (result) {
    console.log(`  Response: zoneId=${result.zoneId}, field=${result.field}, value=${result.value}`);
    console.log(`  PASS — Zone mute command acknowledged.`);
  } else {
    console.log(`  No zoneUpdate event received within 5s.`);
    const zone = client.getZones().get(zoneId);
    console.log(`  Zone ${zoneId} mute is now: ${zone?.mute}`);
    if (zone && zone.mute !== originalMute) {
      console.log(`  PASS — Mute changed (no event, but state updated).`);
    } else {
      console.log(`  FAIL — Mute did not change.`);
    }
  }

  // Restore
  const restoreTo = originalMute ? 'on' : 'off';
  console.log(`\nRestoring mute to ${originalMute}...`);
  await sendAndWaitZoneUpdate(client, `ssp.zones.mute.[${zoneId}, ${restoreTo}]`);
  await sleep(500);
  const restored = client.getZones().get(zoneId);
  console.log(`  Restored: mute=${restored?.mute}`);
}

async function testZoneUseZone2Source(client: StormAudioClient, zoneId: number, originalValue: boolean): Promise<void> {
  console.log('\n=== TEST 4: Zone useZone2Source Toggle ===\n');

  const toggleTo = originalValue ? 'off' : 'on';
  console.log(`Sending: ssp.zones.useZone2.[${zoneId}, ${toggleTo}]`);

  const result = await sendAndWaitZoneUpdate(client, `ssp.zones.useZone2.[${zoneId}, ${toggleTo}]`);

  if (result) {
    console.log(`  Response: zoneId=${result.zoneId}, field=${result.field}, value=${result.value}`);
    console.log(`  PASS — useZone2Source command acknowledged.`);
  } else {
    console.log(`  No zoneUpdate event received within 5s.`);
    const zone = client.getZones().get(zoneId);
    console.log(`  Zone ${zoneId} useZone2Source is now: ${zone?.useZone2Source}`);
    if (zone && zone.useZone2Source !== originalValue) {
      console.log(`  PASS — useZone2Source changed (no event, but state updated).`);
    } else {
      console.log(`  FAIL — useZone2Source did not change.`);
    }
  }

  // Restore
  const restoreTo = originalValue ? 'on' : 'off';
  console.log(`\nRestoring useZone2Source to ${originalValue}...`);
  await sendAndWaitZoneUpdate(client, `ssp.zones.useZone2.[${zoneId}, ${restoreTo}]`);
  await sleep(500);
  const restored = client.getZones().get(zoneId);
  console.log(`  Restored: useZone2Source=${restored?.useZone2Source}`);
}

async function testInputZone2(client: StormAudioClient): Promise<void> {
  console.log('\n=== TEST 5: inputZone2 ===\n');
  console.log('Note: ssp.inputZone2 is currently logged at debug level only.');
  console.log('Observing raw protocol response...\n');

  // Capture any events that come back when we query/set inputZone2
  // Since we don't have a dedicated handler, we listen for any event
  const events: string[] = [];

  // Access private internals for raw protocol testing
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const internals = client as any as { sendCommand: (cmd: string) => void; log: { debug: (msg: string) => void } };

  // Temporarily capture all debug log output to see raw messages
  const originalDebug = internals.log.debug;
  internals.log.debug = (msg: string) => {
    if (msg.includes('inputZone2') || msg.includes('Zone2')) {
      events.push(msg);
    }
    originalDebug.call(internals.log, msg);
  };

  // Try setting inputZone2 to current value (safe — no actual change)
  console.log('Sending: ssp.inputZone2.[0]');
  internals.sendCommand('ssp.inputZone2.[0]\n');
  await sleep(3000);

  // Try different values
  console.log('Sending: ssp.inputZone2.[1]');
  internals.sendCommand('ssp.inputZone2.[1]\n');
  await sleep(3000);

  // Restore
  console.log('Sending: ssp.inputZone2.[0]');
  internals.sendCommand('ssp.inputZone2.[0]\n');
  await sleep(3000);

  // Restore original debug
  internals.log.debug = originalDebug;

  console.log(`\nCaptured ${events.length} inputZone2-related messages:`);
  for (const e of events) {
    console.log(`  ${e}`);
  }
}

async function testZoneBass(client: StormAudioClient, zoneId: number, originalBass: number): Promise<void> {
  console.log('\n=== TEST 6: Zone Bass ===\n');

  const testBass = originalBass === 0 ? 1 : 0;
  console.log(`Sending: ssp.zones.bass.[${zoneId}, ${testBass}]`);

  const result = await sendAndWaitZoneUpdate(client, `ssp.zones.bass.[${zoneId}, ${testBass}]`);

  if (result) {
    console.log(`  Response: zoneId=${result.zoneId}, field=${result.field}, value=${result.value}`);
    console.log(`  PASS — Zone bass command acknowledged.`);
  } else {
    console.log(`  No zoneUpdate event within 5s.`);
    const zone = client.getZones().get(zoneId);
    console.log(`  Zone ${zoneId} bass is now: ${zone?.bass}`);
    if (zone && zone.bass === testBass) {
      console.log(`  PASS — Bass changed (no event, but state updated).`);
    } else {
      console.log(`  FAIL — Bass did not change.`);
    }
  }

  // Restore
  console.log(`\nRestoring bass to ${originalBass}...`);
  await sendAndWaitZoneUpdate(client, `ssp.zones.bass.[${zoneId}, ${originalBass}]`);
  await sleep(500);
}

async function testZoneTreble(client: StormAudioClient, zoneId: number, originalTreble: number): Promise<void> {
  console.log('\n=== TEST 7: Zone Treble ===\n');

  const testTreble = originalTreble === 0 ? 1 : 0;
  console.log(`Sending: ssp.zones.treble.[${zoneId}, ${testTreble}]`);

  const result = await sendAndWaitZoneUpdate(client, `ssp.zones.treble.[${zoneId}, ${testTreble}]`);

  if (result) {
    console.log(`  Response: zoneId=${result.zoneId}, field=${result.field}, value=${result.value}`);
    console.log(`  PASS — Zone treble command acknowledged.`);
  } else {
    console.log(`  No zoneUpdate event within 5s.`);
    const zone = client.getZones().get(zoneId);
    console.log(`  Zone ${zoneId} treble is now: ${zone?.treble}`);
    if (zone && zone.treble === testTreble) {
      console.log(`  PASS — Treble changed (no event, but state updated).`);
    } else {
      console.log(`  FAIL — Treble did not change.`);
    }
  }

  // Restore
  console.log(`\nRestoring treble to ${originalTreble}...`);
  await sendAndWaitZoneUpdate(client, `ssp.zones.treble.[${zoneId}, ${originalTreble}]`);
  await sleep(500);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const config = loadConfig();
  const log = new HarnessLogger();

  // Keep info logging for protocol visibility
  const originalInfo = log.info.bind(log);
  log.info = (msg: string) => {
    if (msg.includes('[State]') || msg.includes('[Command]') || msg.includes('zone') || msg.includes('Zone')) {
      protocolLog.push({ ts: Date.now(), msg });
      originalInfo(msg);
    }
  };

  const client = createClient(config, log);

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║    Zone 2 Command Investigation — PB-3/4/5      ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`\nConnecting to ${config.host}:${config.port}...`);

  await connectAndWait(client);
  console.log('Connected.');

  if (client.getProcessorState() !== ProcessorState.Active) {
    console.error('Processor is not active. Cannot run zone tests.');
    client.disconnect();
    process.exit(1);
  }

  // Test 1: Capture initial state
  const zones = await testZoneState(client);

  if (zones.size === 0) {
    console.log('\nNo zones configured — cannot proceed with zone tests.');
    console.log('This is still a valid finding (processor may not have zones configured).');
    client.disconnect();
    return;
  }

  // Pick the first zone for testing
  const [firstZoneId, firstZone] = [...zones.entries()][0];
  console.log(`\n--- Using Zone ${firstZoneId} ("${firstZone.name}") for tests ---`);

  // Save original state for restoration
  const original = { ...firstZone };

  // Test 2-7: Zone commands
  await testZoneVolume(client, firstZoneId, original.volume);
  await testZoneMute(client, firstZoneId, original.mute);
  await testZoneUseZone2Source(client, firstZoneId, original.useZone2Source);
  await testInputZone2(client);
  await testZoneBass(client, firstZoneId, original.bass);
  await testZoneTreble(client, firstZoneId, original.treble);

  // Final state check
  console.log('\n=== FINAL STATE VERIFICATION ===\n');
  const finalZone = client.getZones().get(firstZoneId);
  if (finalZone) {
    const fields = ['volume', 'mute', 'useZone2Source', 'bass', 'treble'] as const;
    let allRestored = true;
    for (const f of fields) {
      const orig = original[f];
      const curr = finalZone[f];
      const match = orig === curr;
      console.log(`  ${f}: original=${orig}, current=${curr} ${match ? '✓' : '✗ NOT RESTORED'}`);
      if (!match) allRestored = false;
    }
    console.log(allRestored ? '\n  All fields restored.' : '\n  WARNING: Some fields not restored!');
  }

  // Protocol log summary
  console.log('\n=== PROTOCOL LOG ===\n');
  for (const entry of protocolLog) {
    console.log(`  [${new Date(entry.ts).toISOString()}] ${entry.msg}`);
  }

  console.log('\nDone.');
  client.disconnect();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
