#!/usr/bin/env npx ts-node
/**
 * Zone 2 Command Investigation — Round 2
 *
 * Findings from round 1:
 * - Zone 1 ("Downmix") and Zone 13 ("Zone 2") both present
 * - ssp.zones.volume.[ID, val] — PASS (zone 1)
 * - ssp.zones.mute.[ID, on/off] — FAIL (error response on zone 1)
 * - ssp.zones.useZone2.[ID, on/off] — FAIL (error response on zone 1)
 * - ssp.inputZone2.[id] — PASS (writable, broadcasts confirmation)
 * - ssp.zones.bass/treble — PASS (zone 1)
 *
 * Round 2 goals:
 * 1. Test all commands against Zone 13 ("Zone 2") — maybe zone 1 rejects mute/useZone2
 * 2. Try alternate mute formats: [ID, 0/1], [ID, true/false]
 * 3. Try alternate useZone2 formats
 * 4. Test zone volume on zone 13
 * 5. Observe if ssp.zones.mute uses a different wire format than expected
 */

import * as fs from 'fs';
import * as path from 'path';

import { StormAudioClient } from '../../src/stormAudioClient';
import { ProcessorState } from '../../src/types';
import type { StormAudioConfig, StormAudioError } from '../../src/types';
import { HarnessLogger } from './logger';
import type { HardwareTestConfig } from './types';

function loadConfig(): HardwareTestConfig {
  const configPath = path.resolve(__dirname, 'config.json');
  const raw = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(raw) as HardwareTestConfig;
}

function createClient(config: HardwareTestConfig, log: HarnessLogger): StormAudioClient {
  const stormConfig: StormAudioConfig = {
    host: config.host,
    port: config.port,
    name: 'ZoneInvestigation2',
    volumeCeiling: config.volumeCeiling,
    volumeFloor: config.volumeFloor,
    volumeControl: 'fan',
    wakeTimeout: 90,
    commandInterval: 0,
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
    const timer = setTimeout(() => { client.disconnect(); reject(new Error('Timeout')); }, timeoutMs);
    client.on('inputList', () => { clearTimeout(timer); resolve(); });
    client.connect();
  });
}

/**
 * Send a command and capture ALL responses (zone updates, errors, any debug) for a window.
 */
function sendAndObserve(
  client: StormAudioClient,
  command: string,
  waitMs = 3000,
): Promise<{ zoneEvents: { zoneId: number; field: string; value: unknown }[]; errors: number }> {
  return new Promise((resolve) => {
    const zoneEvents: { zoneId: number; field: string; value: unknown }[] = [];
    let errors = 0;

    const zoneHandler = (zoneId: number, field: string, value: unknown): void => {
      zoneEvents.push({ zoneId, field, value });
    };
    const errorHandler = (): void => { errors++; };

    client.on('zoneUpdate', zoneHandler);
    client.on('error', errorHandler);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).sendCommand(command + '\n');

    setTimeout(() => {
      client.removeListener('zoneUpdate', zoneHandler);
      client.removeListener('error', errorHandler);
      resolve({ zoneEvents, errors });
    }, waitMs);
  });
}

async function tryCommand(client: StormAudioClient, label: string, command: string): Promise<void> {
  console.log(`  ${label}`);
  console.log(`    Sending: ${command}`);
  const result = await sendAndObserve(client, command, 2000);
  if (result.zoneEvents.length > 0) {
    for (const e of result.zoneEvents) {
      console.log(`    ✓ zoneUpdate: zone=${e.zoneId}, field=${e.field}, value=${e.value}`);
    }
  } else if (result.errors > 0) {
    console.log(`    ✗ Error response from processor (${result.errors} error(s))`);
  } else {
    console.log(`    ? No response (no zone event, no error)`);
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const log = new HarnessLogger();

  // Suppress routine logs
  log.info = () => {};

  const client = createClient(config, log);

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  Zone 2 Command Investigation — Round 2         ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`\nConnecting to ${config.host}:${config.port}...`);

  await connectAndWait(client);
  console.log('Connected.\n');

  if (client.getProcessorState() !== ProcessorState.Active) {
    console.error('Processor is not active.');
    client.disconnect();
    process.exit(1);
  }

  // Show zones
  const zones = client.getZones();
  for (const [id, z] of zones) {
    console.log(`Zone ${id}: "${z.name}" vol=${z.volume} mute=${z.mute} useZone2Source=${z.useZone2Source}`);
  }

  // -----------------------------------------------------------------------
  // Test mute formats on BOTH zones
  // -----------------------------------------------------------------------
  console.log('\n=== MUTE COMMAND FORMATS ===\n');

  console.log('--- Zone 1 (Downmix) ---');
  await tryCommand(client, 'on/off format:', 'ssp.zones.mute.[1, on]');
  await tryCommand(client, '0/1 format:', 'ssp.zones.mute.[1, 1]');
  await tryCommand(client, 'true/false format:', 'ssp.zones.mute.[1, true]');
  // Restore
  await tryCommand(client, 'restore off:', 'ssp.zones.mute.[1, off]');
  await tryCommand(client, 'restore 0:', 'ssp.zones.mute.[1, 0]');

  console.log('\n--- Zone 13 (Zone 2) ---');
  await tryCommand(client, 'on/off format:', 'ssp.zones.mute.[13, on]');
  await tryCommand(client, '0/1 format:', 'ssp.zones.mute.[13, 1]');
  await tryCommand(client, 'true/false format:', 'ssp.zones.mute.[13, true]');
  // Restore
  await tryCommand(client, 'restore off:', 'ssp.zones.mute.[13, off]');
  await tryCommand(client, 'restore 0:', 'ssp.zones.mute.[13, 0]');

  // -----------------------------------------------------------------------
  // Test useZone2 formats on BOTH zones
  // -----------------------------------------------------------------------
  console.log('\n=== useZone2Source COMMAND FORMATS ===\n');

  console.log('--- Zone 1 (Downmix) ---');
  await tryCommand(client, 'on/off format:', 'ssp.zones.useZone2.[1, on]');
  await tryCommand(client, '0/1 format:', 'ssp.zones.useZone2.[1, 1]');
  await tryCommand(client, 'restore:', 'ssp.zones.useZone2.[1, 0]');

  console.log('\n--- Zone 13 (Zone 2) ---');
  const z13 = zones.get(13);
  const z13Original = z13?.useZone2Source;
  await tryCommand(client, 'on/off format:', 'ssp.zones.useZone2.[13, on]');
  await tryCommand(client, '0/1 format:', 'ssp.zones.useZone2.[13, 1]');
  await tryCommand(client, 'off format:', 'ssp.zones.useZone2.[13, off]');
  await tryCommand(client, '0 format:', 'ssp.zones.useZone2.[13, 0]');
  // Restore to original
  const restoreVal = z13Original ? '1' : '0';
  await tryCommand(client, `restore to ${z13Original}:`, `ssp.zones.useZone2.[13, ${restoreVal}]`);

  // -----------------------------------------------------------------------
  // Test volume on Zone 13
  // -----------------------------------------------------------------------
  console.log('\n=== ZONE 13 VOLUME ===\n');
  const z13vol = z13?.volume ?? -75;
  await tryCommand(client, `set to ${z13vol - 2}:`, `ssp.zones.volume.[13, ${z13vol - 2}]`);
  await tryCommand(client, `restore to ${z13vol}:`, `ssp.zones.volume.[13, ${z13vol}]`);

  // -----------------------------------------------------------------------
  // Test bass/treble on Zone 13
  // -----------------------------------------------------------------------
  console.log('\n=== ZONE 13 BASS/TREBLE ===\n');
  await tryCommand(client, 'bass +1:', 'ssp.zones.bass.[13, 1]');
  await tryCommand(client, 'bass restore:', 'ssp.zones.bass.[13, 0]');
  await tryCommand(client, 'treble +1:', 'ssp.zones.treble.[13, 1]');
  await tryCommand(client, 'treble restore:', 'ssp.zones.treble.[13, 0]');

  // -----------------------------------------------------------------------
  // Final state verification
  // -----------------------------------------------------------------------
  console.log('\n=== FINAL STATE ===\n');
  const finalZones = client.getZones();
  for (const [id, z] of finalZones) {
    console.log(`Zone ${id}: "${z.name}" vol=${z.volume} mute=${z.mute} useZone2Source=${z.useZone2Source} bass=${z.bass} treble=${z.treble}`);
  }

  console.log('\nDone.');
  client.disconnect();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
