#!/usr/bin/env npx ts-node
/**
 * Volume Step Investigation
 *
 * Determines:
 * 1. What is the step size of ssp.vol.up / ssp.vol.down? (1dB or 0.1dB)
 * 2. What is the minimum interval between commands that the processor
 *    acknowledges individually?
 *
 * Usage:
 *   npx ts-node test/hardware/volumeStepTest.ts
 *
 * Requires test/hardware/config.json to be present.
 */

import * as fs from 'fs';
import * as path from 'path';

import { StormAudioClient } from '../../src/stormAudioClient';
import { ProcessorState } from '../../src/types';
import type { StormAudioConfig, StormAudioError } from '../../src/types';
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

function createClient(config: HardwareTestConfig, log: HarnessLogger): StormAudioClient {
  const stormConfig: StormAudioConfig = {
    host: config.host,
    port: config.port,
    name: 'VolumeStepTest',
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

interface VolumeEvent {
  dB: number;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Test 1: Step Size
// ---------------------------------------------------------------------------

async function testStepSize(client: StormAudioClient): Promise<void> {
  console.log('\n=== TEST 1: Volume Step Size ===\n');

  const startVol = client.getVolume();
  console.log(`Starting volume: ${startVol} dB`);

  // Send a single vol.up and capture the exact response
  const upResult = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), 5000);
    client.once('volume', (dB: number) => {
      clearTimeout(timer);
      resolve(dB);
    });
    client.volumeUp();
  });

  if (upResult !== null) {
    const stepUp = Math.round((upResult - startVol) * 10) / 10;
    console.log(`After vol.up: ${upResult} dB (step: ${stepUp > 0 ? '+' : ''}${stepUp} dB)`);
  } else {
    console.log('No response to vol.up within 5s');
  }

  // Wait for processor to settle
  await sleep(1000);

  // Send a single vol.down and capture
  const midVol = client.getVolume();
  const downResult = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), 5000);
    client.once('volume', (dB: number) => {
      clearTimeout(timer);
      resolve(dB);
    });
    client.volumeDown();
  });

  if (downResult !== null) {
    const stepDown = Math.round((downResult - midVol) * 10) / 10;
    console.log(`After vol.down: ${downResult} dB (step: ${stepDown > 0 ? '+' : ''}${stepDown} dB)`);
  } else {
    console.log('No response to vol.down within 5s');
  }

  // Restore original volume
  await sleep(500);
  if (client.getVolume() !== startVol) {
    client.setVolume(startVol);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 3000);
      client.once('volume', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  console.log(`Restored to: ${client.getVolume()} dB`);
}

// ---------------------------------------------------------------------------
// Test 2: Command Spacing Threshold
// ---------------------------------------------------------------------------

async function testCommandSpacing(client: StormAudioClient): Promise<void> {
  console.log('\n=== TEST 2: Command Spacing Threshold ===\n');
  console.log('Sending vol.up commands at increasing intervals to find');
  console.log('the minimum spacing the processor acknowledges individually.\n');

  const intervals = [0, 50, 100, 150, 200, 300, 500, 750, 1000];

  for (const intervalMs of intervals) {
    const startVol = client.getVolume();
    const commandCount = 3;
    const events: VolumeEvent[] = [];

    const volumeHandler = (dB: number): void => {
      events.push({ dB, timestamp: Date.now() });
    };
    client.on('volume', volumeHandler);

    const sendStart = Date.now();

    // Send commands with the specified interval
    for (let i = 0; i < commandCount; i++) {
      client.volumeUp();
      if (i < commandCount - 1 && intervalMs > 0) {
        await sleep(intervalMs);
      }
    }

    // Wait for all responses (give extra time for slow intervals)
    const waitTime = Math.max(2000, intervalMs * commandCount + 2000);
    await sleep(waitTime);

    client.removeListener('volume', volumeHandler);

    const finalVol = client.getVolume();
    const totalChange = Math.round((finalVol - startVol) * 10) / 10;
    const elapsed = Date.now() - sendStart;

    console.log(
      `Interval: ${String(intervalMs).padStart(4)}ms | ` +
        `Sent: ${commandCount} | ` +
        `Events: ${events.length} | ` +
        `Change: ${totalChange > 0 ? '+' : ''}${totalChange} dB | ` +
        `Values: [${events.map((e) => e.dB).join(', ')}] | ` +
        `Time: ${elapsed}ms`,
    );

    // Restore volume
    if (finalVol !== startVol) {
      client.setVolume(startVol);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 3000);
        client.once('volume', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      await sleep(500);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const config = loadConfig();
  const log = new HarnessLogger();
  const client = createClient(config, log);

  // Suppress log output during test — we only want our formatted output
  log.info = () => {};
  log.debug = () => {};

  console.log(`Connecting to ${config.host}:${config.port}...`);
  await connectAndWait(client);
  console.log('Connected.');

  if (client.getProcessorState() !== ProcessorState.Active) {
    console.error('Processor is not active. Cannot run volume tests.');
    client.disconnect();
    process.exit(1);
  }

  await testStepSize(client);
  await testCommandSpacing(client);

  console.log('\nDone.');
  client.disconnect();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
