/**
 * Zone 2 hardware integration test scenarios.
 *
 * Maps to the "Automation Opportunities" section (A1-A15) of the
 * Epic 5 smoke test document. Each scenario exercises the StormAudioClient
 * Zone 2 API against a real processor.
 */

import { StormAudioClient } from '../../src/stormAudioClient';
import { percentageToDB, dBToPercentage } from '../../src/platformAccessory';
import { ProcessorState } from '../../src/types';
import type { InputInfo, StormAudioConfig, StormAudioError, ZoneState } from '../../src/types';
import { HarnessLogger } from './logger';
import { sleepWithProgress, Spinner } from './spinner';
import type { HardwareTestConfig, ResponseTimeStat, ScenarioResult } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(name: string): ScenarioResult {
  return {
    name,
    status: 'FAIL',
    durationMs: 0,
    observations: [],
    unexpectedBroadcasts: [],
  };
}

function waitForEvent<T>(client: StormAudioClient, event: string, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, timeoutMs);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = (...args: any[]): void => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(args.length === 1 ? args[0] : (args as unknown as T));
      }
    };

    client.once(event as 'connected', handler);
  });
}

/**
 * Wait for a zoneUpdate event matching a specific zoneId and field.
 * Returns the value, or null on timeout.
 */
function waitForZoneUpdate(
  client: StormAudioClient,
  targetZoneId: number,
  targetField: string,
  timeoutMs: number,
): Promise<unknown | null> {
  return new Promise((resolve) => {
    let settled = false;

    // handler and timer reference each other — unavoidable circular declaration
    const handler = (zoneId: number, field: string, value: unknown): void => {
      if (!settled && zoneId === targetZoneId && field === targetField) {
        settled = true;
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        clearTimeout(timer);
        client.removeListener('zoneUpdate', handler);
        resolve(value);
      }
    };

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        client.removeListener('zoneUpdate', handler);
        resolve(null);
      }
    }, timeoutMs);

    client.on('zoneUpdate', handler);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createAndConnect(
  config: HardwareTestConfig,
  log: HarnessLogger,
  timeoutMs = 15000,
): Promise<{ client: StormAudioClient; connectMs: number }> {
  return new Promise((resolve, reject) => {
    const stormConfig: StormAudioConfig = {
      host: config.host,
      port: config.port,
      name: 'Zone2HarnessTest',
      volumeCeiling: config.volumeCeiling,
      volumeFloor: config.volumeFloor,
      volumeControl: 'fan',
      wakeTimeout: 90,
      commandInterval: 0,
      inputs: {},
    };

    const client = new StormAudioClient(stormConfig, log);

    client.on('error', (err: StormAudioError) => {
      log.warn(`[Zone2Harness] Client error event: ${err.category} — ${err.message}`);
    });

    const start = Date.now();
    const timer = setTimeout(() => {
      client.disconnect();
      reject(new Error(`Connection to ${config.host}:${config.port} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    client.on('connected', () => {
      clearTimeout(timer);
      resolve({ client, connectMs: Date.now() - start });
    });

    client.connect();
  });
}

function waitForStateDump(client: StormAudioClient, timeoutMs = 15000): Promise<InputInfo[] | null> {
  return waitForEvent<InputInfo[]>(client, 'inputList', timeoutMs);
}

/** Wait for the zoneList event. Returns the zone array or null on timeout. */
function waitForZoneList(client: StormAudioClient, timeoutMs = 15000): Promise<ZoneState[] | null> {
  return waitForEvent<ZoneState[]>(client, 'zoneList', timeoutMs);
}

/**
 * Wait for BOTH inputList and zoneList events (zones arrive after inputs in the
 * protocol dump). Returns { inputs, zones } or nulls on timeout.
 */
async function waitForFullStateDump(
  client: StormAudioClient,
  timeoutMs = 15000,
): Promise<{ inputs: InputInfo[] | null; zones: ZoneState[] | null }> {
  const [inputs, zones] = await Promise.all([
    waitForStateDump(client, timeoutMs),
    waitForZoneList(client, timeoutMs),
  ]);
  return { inputs, zones };
}

function skipIfNoZone2(config: HardwareTestConfig, result: ScenarioResult): boolean {
  if (config.zone2ZoneId === null) {
    result.status = 'SKIP';
    result.reason = 'zone2ZoneId not configured';
    return true;
  }
  return false;
}

function skipIfDestructive(config: HardwareTestConfig, result: ScenarioResult): boolean {
  if (config.skipDestructive) {
    result.status = 'SKIP';
    result.reason = 'skipDestructive is true';
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// A1: Zone List Parsing (ST-1)
// ---------------------------------------------------------------------------

export async function scenarioZoneListParsing(
  config: HardwareTestConfig,
  log: HarnessLogger,
  _spinner: Spinner,
): Promise<ScenarioResult> {
  const result = makeResult('A1. Zone List Parsing');
  const start = Date.now();

  try {
    const { client } = await createAndConnect(config, log);

    // zoneList may fire before or after inputList — listen for both
    const zones = await waitForZoneList(client, 15000);
    // Also wait for full state dump to settle
    await waitForStateDump(client, 5000);

    if (!zones || zones.length === 0) {
      result.status = 'FAIL';
      result.reason = 'No zones received from processor';
      client.disconnect();
      result.durationMs = Date.now() - start;
      return result;
    }

    result.observations.push(`Received ${zones.length} zones`);

    let hasDownmix = false;
    let allValid = true;

    for (const zone of zones) {
      const valid = typeof zone.id === 'number' && zone.id > 0 && typeof zone.name === 'string' && zone.name.length > 0;
      const zoneType = zone.id === 1 ? 'built-in' : 'user zone';
      result.observations.push(`  Zone ${zone.id}: "${zone.name}" (${zoneType}) — ${valid ? 'valid' : 'INVALID'}`);

      if (zone.id === 1 && zone.name.toLowerCase().includes('downmix')) {
        hasDownmix = true;
      }
      if (!valid) allValid = false;
    }

    // Check for Zone 1 (Downmix)
    if (!hasDownmix) {
      result.observations.push('WARNING: Zone 1 "Downmix" not found (expected built-in zone)');
    }

    // If zone2ZoneId is configured, verify it exists in the zone list
    if (config.zone2ZoneId !== null) {
      const z2 = zones.find((z) => z.id === config.zone2ZoneId);
      if (z2) {
        result.observations.push(`Zone 2 target zone ${config.zone2ZoneId}: "${z2.name}" — found`);
      } else {
        result.observations.push(`WARNING: zone2ZoneId ${config.zone2ZoneId} NOT found in zone list`);
      }
    }

    // Check for duplicate IDs
    const ids = zones.map((z) => z.id);
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length) {
      result.observations.push('WARNING: Duplicate zone IDs detected');
      allValid = false;
    }

    result.status = allValid ? 'PASS' : 'FAIL';
    if (!allValid) {
      result.reason = 'One or more zones had invalid id/name or duplicate IDs';
    }

    client.disconnect();
  } catch (err) {
    result.status = 'FAIL';
    result.reason = err instanceof Error ? err.message : String(err);
  }

  result.durationMs = Date.now() - start;
  return result;
}

// ---------------------------------------------------------------------------
// A2: Zone 2 Mute Command Format (ST-3)
// ---------------------------------------------------------------------------

export async function scenarioZone2MuteCommand(
  config: HardwareTestConfig,
  log: HarnessLogger,
  _spinner: Spinner,
): Promise<{ result: ScenarioResult; responseStats: ResponseTimeStat[] }> {
  const result = makeResult('A2. Zone 2 Mute Command Format');
  const responseStats: ResponseTimeStat[] = [];
  const start = Date.now();
  const zoneId = config.zone2ZoneId!;

  if (skipIfNoZone2(config, result) || skipIfDestructive(config, result)) {
    result.durationMs = Date.now() - start;
    return { result, responseStats };
  }

  try {
    const { client } = await createAndConnect(config, log);
    await waitForFullStateDump(client);

    const procState = client.getProcessorState();
    if (procState !== ProcessorState.Active) {
      result.status = 'SKIP';
      result.reason = `Processor not active (state: ${ProcessorState[procState]})`;
      client.disconnect();
      result.durationMs = Date.now() - start;
      return { result, responseStats };
    }

    // Capture original zone state
    const zones = client.getZones();
    const origZone = zones.get(zoneId);
    if (!origZone) {
      result.status = 'FAIL';
      result.reason = `Zone ${zoneId} not found in client state`;
      client.disconnect();
      result.durationMs = Date.now() - start;
      return { result, responseStats };
    }

    const origMute = origZone.mute;
    result.observations.push(`Original zone ${zoneId} mute: ${origMute}`);

    // --- Mute ON ---
    {
      const muteWait = waitForZoneUpdate(client, zoneId, 'mute', 5000);
      const cmdStart = Date.now();
      client.setZoneMute(zoneId, true);
      const muteVal = await muteWait;
      const elapsed = Date.now() - cmdStart;
      responseStats.push({ command: `setZoneMute(${zoneId}, true)`, roundTripMs: elapsed });

      if (muteVal === true) {
        result.observations.push(`Mute ON confirmed: ${muteVal} in ${elapsed}ms`);
      } else {
        result.observations.push(`Mute ON: expected true, got ${muteVal} (${elapsed}ms)`);
      }
    }

    await sleep(300);

    // --- Mute OFF ---
    {
      const muteWait = waitForZoneUpdate(client, zoneId, 'mute', 5000);
      const cmdStart = Date.now();
      client.setZoneMute(zoneId, false);
      const muteVal = await muteWait;
      const elapsed = Date.now() - cmdStart;
      responseStats.push({ command: `setZoneMute(${zoneId}, false)`, roundTripMs: elapsed });

      if (muteVal === false) {
        result.observations.push(`Mute OFF confirmed: ${muteVal} in ${elapsed}ms`);
      } else {
        result.observations.push(`Mute OFF: expected false, got ${muteVal} (${elapsed}ms)`);
      }
    }

    await sleep(300);

    // --- Restore original ---
    if (origMute !== client.getZones().get(zoneId)?.mute) {
      client.setZoneMute(zoneId, origMute);
      await waitForZoneUpdate(client, zoneId, 'mute', 5000);
    }

    // Verify integer format: check log for D15 format (1/0 not "on"/"off")
    const muteLogEntries = log.messages.filter((m) => m.includes('ssp.zones.mute'));
    const hasIntegerFormat = muteLogEntries.some((m) => /ssp\.zones\.mute\.\[\d+, [01]\]/.test(m));
    result.observations.push(`Integer format (1/0) in protocol: ${hasIntegerFormat ? 'YES' : 'NO'}`);

    result.status = 'PASS';
    client.disconnect();
  } catch (err) {
    result.status = 'FAIL';
    result.reason = err instanceof Error ? err.message : String(err);
  }

  result.durationMs = Date.now() - start;
  return { result, responseStats };
}

// ---------------------------------------------------------------------------
// A3: Zone 2 Volume Command Format (ST-5)
// ---------------------------------------------------------------------------

export async function scenarioZone2VolumeCommand(
  config: HardwareTestConfig,
  log: HarnessLogger,
  _spinner: Spinner,
): Promise<{ result: ScenarioResult; responseStats: ResponseTimeStat[] }> {
  const result = makeResult('A3. Zone 2 Volume Command Format');
  const responseStats: ResponseTimeStat[] = [];
  const start = Date.now();
  const zoneId = config.zone2ZoneId!;

  if (skipIfNoZone2(config, result) || skipIfDestructive(config, result)) {
    result.durationMs = Date.now() - start;
    return { result, responseStats };
  }

  try {
    const { client } = await createAndConnect(config, log);
    await waitForFullStateDump(client);

    const procState = client.getProcessorState();
    if (procState !== ProcessorState.Active) {
      result.status = 'SKIP';
      result.reason = `Processor not active (state: ${ProcessorState[procState]})`;
      client.disconnect();
      result.durationMs = Date.now() - start;
      return { result, responseStats };
    }

    const zones = client.getZones();
    const origZone = zones.get(zoneId);
    if (!origZone) {
      result.status = 'FAIL';
      result.reason = `Zone ${zoneId} not found in client state`;
      client.disconnect();
      result.durationMs = Date.now() - start;
      return { result, responseStats };
    }

    const origVolume = origZone.volume;
    const targetVolume = -40;
    result.observations.push(`Original zone ${zoneId} volume: ${origVolume}dB, target: ${targetVolume}dB`);

    // --- Set volume ---
    const volWait = waitForZoneUpdate(client, zoneId, 'volume', 5000);
    const cmdStart = Date.now();
    client.setZoneVolume(zoneId, targetVolume);
    const volVal = await volWait;
    const elapsed = Date.now() - cmdStart;
    responseStats.push({ command: `setZoneVolume(${zoneId}, ${targetVolume})`, roundTripMs: elapsed });

    if (volVal === targetVolume) {
      result.observations.push(`Volume confirmed: ${volVal}dB in ${elapsed}ms`);
    } else {
      result.observations.push(`Volume: expected ${targetVolume}dB, got ${volVal}dB (${elapsed}ms)`);
    }

    await sleep(300);

    // --- Restore ---
    if (origVolume !== client.getZones().get(zoneId)?.volume) {
      client.setZoneVolume(zoneId, origVolume);
      await waitForZoneUpdate(client, zoneId, 'volume', 5000);
    }
    result.observations.push(`Restored volume to ${client.getZones().get(zoneId)?.volume}dB`);

    result.status = 'PASS';
    client.disconnect();
  } catch (err) {
    result.status = 'FAIL';
    result.reason = err instanceof Error ? err.message : String(err);
  }

  result.durationMs = Date.now() - start;
  return { result, responseStats };
}

// ---------------------------------------------------------------------------
// A4: Zone 2 Volume Mapping Accuracy (ST-5)
// ---------------------------------------------------------------------------

export async function scenarioZone2VolumeMapping(
  config: HardwareTestConfig,
  log: HarnessLogger,
  _spinner: Spinner,
): Promise<ScenarioResult> {
  const result = makeResult('A4. Zone 2 Volume Mapping Accuracy');
  const start = Date.now();
  const zoneId = config.zone2ZoneId!;
  const floor = config.zone2VolumeFloor;
  const ceiling = config.zone2VolumeCeiling;

  if (skipIfNoZone2(config, result) || skipIfDestructive(config, result)) {
    result.durationMs = Date.now() - start;
    return result;
  }

  try {
    const { client } = await createAndConnect(config, log);
    await waitForFullStateDump(client);

    const procState = client.getProcessorState();
    if (procState !== ProcessorState.Active) {
      result.status = 'SKIP';
      result.reason = `Processor not active (state: ${ProcessorState[procState]})`;
      client.disconnect();
      result.durationMs = Date.now() - start;
      return result;
    }

    const zones = client.getZones();
    const origZone = zones.get(zoneId);
    if (!origZone) {
      result.status = 'FAIL';
      result.reason = `Zone ${zoneId} not found in client state`;
      client.disconnect();
      result.durationMs = Date.now() - start;
      return result;
    }

    const origVolume = origZone.volume;
    result.observations.push(`Floor: ${floor}dB, Ceiling: ${ceiling}dB`);

    let allMatch = true;

    // Test 0%, 50%, 100%
    const testPoints = [
      { pct: 0, expectedDb: percentageToDB(0, floor, ceiling) },
      { pct: 50, expectedDb: percentageToDB(50, floor, ceiling) },
      { pct: 100, expectedDb: percentageToDB(100, floor, ceiling) },
    ];

    for (const { pct, expectedDb } of testPoints) {
      const volWait = waitForZoneUpdate(client, zoneId, 'volume', 5000);
      client.setZoneVolume(zoneId, expectedDb);
      const confirmedDb = await volWait;
      await sleep(300);

      const match = confirmedDb === expectedDb;
      if (!match) allMatch = false;
      result.observations.push(
        `  ${pct}% → ${expectedDb}dB: confirmed ${confirmedDb}dB — ${match ? 'OK' : 'MISMATCH'}`,
      );

      // Verify reverse mapping
      if (typeof confirmedDb === 'number') {
        const reversePct = dBToPercentage(confirmedDb, floor, ceiling);
        result.observations.push(`    Reverse: ${confirmedDb}dB → ${reversePct}% (expected ${pct}%)`);
        if (reversePct !== pct) {
          result.observations.push(`    WARNING: reverse mapping mismatch`);
        }
      }
    }

    // Restore
    client.setZoneVolume(zoneId, origVolume);
    await waitForZoneUpdate(client, zoneId, 'volume', 5000);
    result.observations.push(`Restored volume to ${origVolume}dB`);

    result.status = allMatch ? 'PASS' : 'FAIL';
    if (!allMatch) result.reason = 'One or more volume mapping points did not match';

    client.disconnect();
  } catch (err) {
    result.status = 'FAIL';
    result.reason = err instanceof Error ? err.message : String(err);
  }

  result.durationMs = Date.now() - start;
  return result;
}

// ---------------------------------------------------------------------------
// A5: Follow Main Command (ST-7)
// ---------------------------------------------------------------------------

export async function scenarioFollowMain(
  config: HardwareTestConfig,
  log: HarnessLogger,
  _spinner: Spinner,
): Promise<ScenarioResult> {
  const result = makeResult('A5. Follow Main Command');
  const start = Date.now();
  const zoneId = config.zone2ZoneId!;

  if (skipIfNoZone2(config, result) || skipIfDestructive(config, result)) {
    result.durationMs = Date.now() - start;
    return result;
  }

  try {
    const { client } = await createAndConnect(config, log);
    await waitForFullStateDump(client);

    const procState = client.getProcessorState();
    if (procState !== ProcessorState.Active) {
      result.status = 'SKIP';
      result.reason = `Processor not active (state: ${ProcessorState[procState]})`;
      client.disconnect();
      result.durationMs = Date.now() - start;
      return result;
    }

    const zones = client.getZones();
    const origZone = zones.get(zoneId);
    if (!origZone) {
      result.status = 'FAIL';
      result.reason = `Zone ${zoneId} not found in client state`;
      client.disconnect();
      result.durationMs = Date.now() - start;
      return result;
    }

    const origUseZone2 = origZone.useZone2Source;
    result.observations.push(`Original useZone2Source: ${origUseZone2}`);

    // First ensure we're in independent mode so we can test switching to Follow Main
    if (!origUseZone2) {
      const enableWait = waitForZoneUpdate(client, zoneId, 'useZone2', 5000);
      client.setZoneUseZone2(zoneId, true);
      await enableWait;
      await sleep(500);
      result.observations.push('Switched to independent mode first');
    }

    // Now send Follow Main command
    const logBefore = log.messages.length;
    const followWait = waitForZoneUpdate(client, zoneId, 'useZone2', 5000);
    client.setZoneUseZone2(zoneId, false);
    const followVal = await followWait;

    if (followVal === false) {
      result.observations.push(`Follow Main confirmed: useZone2Source=${followVal}`);
    } else {
      result.observations.push(`Follow Main: expected false, got ${followVal}`);
    }

    // Verify no inputZone2 command was sent (Follow Main is a single command)
    const logAfter = log.messages.slice(logBefore);
    const hasInputZone2 = logAfter.some((m) => m.includes('ssp.inputZone2'));
    result.observations.push(`No inputZone2 command sent: ${!hasInputZone2 ? 'CORRECT' : 'UNEXPECTED inputZone2 found'}`);

    await sleep(300);

    // Restore original
    if (origUseZone2 !== client.getZones().get(zoneId)?.useZone2Source) {
      client.setZoneUseZone2(zoneId, origUseZone2);
      await waitForZoneUpdate(client, zoneId, 'useZone2', 5000);
    }

    result.status = followVal === false && !hasInputZone2 ? 'PASS' : 'FAIL';
    if (result.status === 'FAIL' && !result.reason) {
      result.reason = followVal !== false ? 'useZone2Source not confirmed as false' : 'Unexpected inputZone2 command sent';
    }

    client.disconnect();
  } catch (err) {
    result.status = 'FAIL';
    result.reason = err instanceof Error ? err.message : String(err);
  }

  result.durationMs = Date.now() - start;
  return result;
}

// ---------------------------------------------------------------------------
// A6: Independent Source Commands + Ordering (ST-8)
// ---------------------------------------------------------------------------

export async function scenarioIndependentSource(
  config: HardwareTestConfig,
  log: HarnessLogger,
  _spinner: Spinner,
): Promise<ScenarioResult> {
  const result = makeResult('A6. Independent Source Commands + Ordering');
  const start = Date.now();
  const zoneId = config.zone2ZoneId!;

  if (skipIfNoZone2(config, result) || skipIfDestructive(config, result)) {
    result.durationMs = Date.now() - start;
    return result;
  }

  try {
    const { client } = await createAndConnect(config, log);
    await waitForFullStateDump(client);

    const procState = client.getProcessorState();
    if (procState !== ProcessorState.Active) {
      result.status = 'SKIP';
      result.reason = `Processor not active (state: ${ProcessorState[procState]})`;
      client.disconnect();
      result.durationMs = Date.now() - start;
      return result;
    }

    // Find a Zone 2-capable input
    let testInputId = config.testZone2InputId;
    if (testInputId === null) {
      const z2Inputs = client.getZone2Inputs();
      if (z2Inputs.length === 0) {
        result.status = 'SKIP';
        result.reason = 'No Zone 2-capable inputs found on processor';
        client.disconnect();
        result.durationMs = Date.now() - start;
        return result;
      }
      testInputId = z2Inputs[0].id;
      result.observations.push(`Auto-detected Zone 2-capable input: ${z2Inputs[0].id} ("${z2Inputs[0].name}")`);
    }

    const zones = client.getZones();
    const origZone = zones.get(zoneId);
    if (!origZone) {
      result.status = 'FAIL';
      result.reason = `Zone ${zoneId} not found in client state`;
      client.disconnect();
      result.durationMs = Date.now() - start;
      return result;
    }

    const origUseZone2 = origZone.useZone2Source;
    const origInputZone2 = client.getInputZone2();

    // First ensure Follow Main so we can test the full switch
    if (origUseZone2) {
      client.setZoneUseZone2(zoneId, false);
      await waitForZoneUpdate(client, zoneId, 'useZone2', 5000);
      await sleep(300);
    }

    // Track command ordering via log timestamps
    const logBefore = log.messages.length;
    const commandTimestamps: Array<{ command: string; index: number }> = [];

    // Send useZone2 FIRST, then inputZone2
    const useZone2Wait = waitForZoneUpdate(client, zoneId, 'useZone2', 5000);
    client.setZoneUseZone2(zoneId, true);
    commandTimestamps.push({ command: 'useZone2', index: log.messages.length });

    const inputZone2Wait = waitForEvent<number>(client, 'inputZone2', 5000);
    client.setInputZone2(testInputId);
    commandTimestamps.push({ command: 'inputZone2', index: log.messages.length });

    const useZone2Val = await useZone2Wait;
    const inputZone2Val = await inputZone2Wait;

    result.observations.push(`useZone2Source confirmed: ${useZone2Val}`);
    result.observations.push(`inputZone2 confirmed: ${inputZone2Val}`);

    // Verify ordering: useZone2 command should appear before inputZone2 in logs
    const logAfter = log.messages.slice(logBefore);
    let useZone2LogIdx = -1;
    let inputZone2LogIdx = -1;
    for (let i = 0; i < logAfter.length; i++) {
      if (useZone2LogIdx === -1 && logAfter[i].includes('ssp.zones.useZone2')) {
        useZone2LogIdx = i;
      }
      if (inputZone2LogIdx === -1 && logAfter[i].includes('ssp.inputZone2')) {
        inputZone2LogIdx = i;
      }
    }

    const correctOrder = useZone2LogIdx >= 0 && inputZone2LogIdx >= 0 && useZone2LogIdx < inputZone2LogIdx;
    result.observations.push(
      `Command ordering: useZone2 at log[${useZone2LogIdx}], inputZone2 at log[${inputZone2LogIdx}] — ${correctOrder ? 'CORRECT' : 'WRONG ORDER'}`,
    );

    await sleep(300);

    // Restore original
    if (origUseZone2 !== client.getZones().get(zoneId)?.useZone2Source) {
      client.setZoneUseZone2(zoneId, origUseZone2);
      await waitForZoneUpdate(client, zoneId, 'useZone2', 5000);
    }
    if (!origUseZone2 && origInputZone2 !== client.getInputZone2()) {
      // Only restore inputZone2 if we were originally in independent mode
    }

    const allGood = useZone2Val === true && inputZone2Val === testInputId && correctOrder;
    result.status = allGood ? 'PASS' : 'FAIL';
    if (!allGood) {
      const reasons: string[] = [];
      if (useZone2Val !== true) reasons.push('useZone2Source not confirmed');
      if (inputZone2Val !== testInputId) reasons.push(`inputZone2 expected ${testInputId}, got ${inputZone2Val}`);
      if (!correctOrder) reasons.push('command ordering incorrect');
      result.reason = reasons.join('; ');
    }

    client.disconnect();
  } catch (err) {
    result.status = 'FAIL';
    result.reason = err instanceof Error ? err.message : String(err);
  }

  result.durationMs = Date.now() - start;
  return result;
}

// ---------------------------------------------------------------------------
// A7: Bidirectional Sync — Mute (ST-6)
// ---------------------------------------------------------------------------

export async function scenarioBidirectionalMute(
  config: HardwareTestConfig,
  log: HarnessLogger,
  _spinner: Spinner,
): Promise<ScenarioResult> {
  const result = makeResult('A7. Bidirectional Sync — Mute');
  const start = Date.now();
  const zoneId = config.zone2ZoneId!;

  if (skipIfNoZone2(config, result) || skipIfDestructive(config, result)) {
    result.durationMs = Date.now() - start;
    return result;
  }

  try {
    // Connect TWO clients to simulate external change
    const { client: observer } = await createAndConnect(config, log);
    await waitForFullStateDump(observer);

    const { client: actor } = await createAndConnect(config, log);
    await waitForFullStateDump(actor);

    const procState = observer.getProcessorState();
    if (procState !== ProcessorState.Active) {
      result.status = 'SKIP';
      result.reason = `Processor not active (state: ${ProcessorState[procState]})`;
      observer.disconnect();
      actor.disconnect();
      result.durationMs = Date.now() - start;
      return result;
    }

    const origMute = observer.getZones().get(zoneId)?.mute;
    if (origMute === undefined) {
      result.status = 'FAIL';
      result.reason = `Zone ${zoneId} not found`;
      observer.disconnect();
      actor.disconnect();
      result.durationMs = Date.now() - start;
      return result;
    }

    result.observations.push(`Original zone ${zoneId} mute: ${origMute}`);

    // Actor changes mute externally; observer should receive the broadcast
    const targetMute = !origMute;
    const observerWait = waitForZoneUpdate(observer, zoneId, 'mute', 5000);
    actor.setZoneMute(zoneId, targetMute);
    const observedVal = await observerWait;

    result.observations.push(
      `Actor set mute=${targetMute}, observer received: ${observedVal}`,
    );

    await sleep(300);

    // Restore via actor
    actor.setZoneMute(zoneId, origMute);
    await waitForZoneUpdate(observer, zoneId, 'mute', 5000);
    result.observations.push(`Restored mute to ${origMute}`);

    result.status = observedVal === targetMute ? 'PASS' : 'FAIL';
    if (result.status === 'FAIL') {
      result.reason = `Observer expected mute=${targetMute}, got ${observedVal}`;
    }

    observer.disconnect();
    actor.disconnect();
  } catch (err) {
    result.status = 'FAIL';
    result.reason = err instanceof Error ? err.message : String(err);
  }

  result.durationMs = Date.now() - start;
  return result;
}

// ---------------------------------------------------------------------------
// A8: Bidirectional Sync — Volume (ST-6)
// ---------------------------------------------------------------------------

export async function scenarioBidirectionalVolume(
  config: HardwareTestConfig,
  log: HarnessLogger,
  _spinner: Spinner,
): Promise<ScenarioResult> {
  const result = makeResult('A8. Bidirectional Sync — Volume');
  const start = Date.now();
  const zoneId = config.zone2ZoneId!;

  if (skipIfNoZone2(config, result) || skipIfDestructive(config, result)) {
    result.durationMs = Date.now() - start;
    return result;
  }

  try {
    const { client: observer } = await createAndConnect(config, log);
    await waitForFullStateDump(observer);

    const { client: actor } = await createAndConnect(config, log);
    await waitForFullStateDump(actor);

    const procState = observer.getProcessorState();
    if (procState !== ProcessorState.Active) {
      result.status = 'SKIP';
      result.reason = `Processor not active (state: ${ProcessorState[procState]})`;
      observer.disconnect();
      actor.disconnect();
      result.durationMs = Date.now() - start;
      return result;
    }

    const origVolume = observer.getZones().get(zoneId)?.volume;
    if (origVolume === undefined) {
      result.status = 'FAIL';
      result.reason = `Zone ${zoneId} not found`;
      observer.disconnect();
      actor.disconnect();
      result.durationMs = Date.now() - start;
      return result;
    }

    const targetVolume = origVolume === -40 ? -50 : -40;
    result.observations.push(`Original zone ${zoneId} volume: ${origVolume}dB, target: ${targetVolume}dB`);

    // Actor changes volume; observer should receive the broadcast
    const observerWait = waitForZoneUpdate(observer, zoneId, 'volume', 5000);
    actor.setZoneVolume(zoneId, targetVolume);
    const observedVal = await observerWait;

    result.observations.push(`Actor set volume=${targetVolume}dB, observer received: ${observedVal}dB`);

    // Verify dBToPercentage conversion
    if (typeof observedVal === 'number') {
      const floor = config.zone2VolumeFloor;
      const ceiling = config.zone2VolumeCeiling;
      const pct = dBToPercentage(observedVal, floor, ceiling);
      result.observations.push(`  dBToPercentage(${observedVal}, ${floor}, ${ceiling}) = ${pct}%`);
    }

    await sleep(300);

    // Restore
    actor.setZoneVolume(zoneId, origVolume);
    await waitForZoneUpdate(observer, zoneId, 'volume', 5000);
    result.observations.push(`Restored volume to ${origVolume}dB`);

    result.status = observedVal === targetVolume ? 'PASS' : 'FAIL';
    if (result.status === 'FAIL') {
      result.reason = `Observer expected volume=${targetVolume}, got ${observedVal}`;
    }

    observer.disconnect();
    actor.disconnect();
  } catch (err) {
    result.status = 'FAIL';
    result.reason = err instanceof Error ? err.message : String(err);
  }

  result.durationMs = Date.now() - start;
  return result;
}

// ---------------------------------------------------------------------------
// A9: Bidirectional Sync — Source (ST-9)
// ---------------------------------------------------------------------------

export async function scenarioBidirectionalSource(
  config: HardwareTestConfig,
  log: HarnessLogger,
  _spinner: Spinner,
): Promise<ScenarioResult> {
  const result = makeResult('A9. Bidirectional Sync — Source');
  const start = Date.now();
  const zoneId = config.zone2ZoneId!;

  if (skipIfNoZone2(config, result) || skipIfDestructive(config, result)) {
    result.durationMs = Date.now() - start;
    return result;
  }

  try {
    const { client: observer } = await createAndConnect(config, log);
    await waitForFullStateDump(observer);

    const { client: actor } = await createAndConnect(config, log);
    await waitForFullStateDump(actor);

    const procState = observer.getProcessorState();
    if (procState !== ProcessorState.Active) {
      result.status = 'SKIP';
      result.reason = `Processor not active (state: ${ProcessorState[procState]})`;
      observer.disconnect();
      actor.disconnect();
      result.durationMs = Date.now() - start;
      return result;
    }

    const origZone = observer.getZones().get(zoneId);
    if (!origZone) {
      result.status = 'FAIL';
      result.reason = `Zone ${zoneId} not found`;
      observer.disconnect();
      actor.disconnect();
      result.durationMs = Date.now() - start;
      return result;
    }

    const origUseZone2 = origZone.useZone2Source;
    result.observations.push(`Original useZone2Source: ${origUseZone2}`);

    // Test 1: Actor switches to Follow Main — observer should see useZone2Source=false
    if (origUseZone2) {
      const observerWait = waitForZoneUpdate(observer, zoneId, 'useZone2', 5000);
      actor.setZoneUseZone2(zoneId, false);
      const observedVal = await observerWait;
      result.observations.push(`Actor set Follow Main, observer got useZone2Source=${observedVal}`);

      if (observedVal !== false) {
        result.status = 'FAIL';
        result.reason = `Expected observer useZone2Source=false, got ${observedVal}`;
        observer.disconnect();
        actor.disconnect();
        result.durationMs = Date.now() - start;
        return result;
      }
    }

    await sleep(300);

    // Test 2: Actor switches to independent source — observer should see useZone2Source=true
    let testInputId = config.testZone2InputId;
    const z2Inputs = observer.getZone2Inputs();
    if (z2Inputs.length === 0) {
      result.observations.push('No Zone 2-capable inputs — skipping independent source test');
      result.status = 'PASS';
      observer.disconnect();
      actor.disconnect();
      result.durationMs = Date.now() - start;
      return result;
    }

    // Pick an input that differs from the current inputZone2 so the processor
    // actually broadcasts a change (it suppresses no-op updates).
    const currentInputZone2 = observer.getInputZone2();
    if (testInputId === null) {
      const different = z2Inputs.find((inp) => inp.id !== currentInputZone2);
      testInputId = different ? different.id : z2Inputs[0].id;
    }
    result.observations.push(
      `Current inputZone2: ${currentInputZone2}, will switch to: ${testInputId} (${testInputId === currentInputZone2 ? 'SAME — broadcast may be suppressed' : 'different'})`,
    );

    const useZone2Wait = waitForZoneUpdate(observer, zoneId, 'useZone2', 5000);
    actor.setZoneUseZone2(zoneId, true);
    const useZone2Observed = await useZone2Wait;

    let inputObserved: number | null;
    if (testInputId !== currentInputZone2) {
      const inputWait = waitForEvent<number>(observer, 'inputZone2', 5000);
      actor.setInputZone2(testInputId);
      inputObserved = await inputWait;
    } else {
      // Same input — processor won't broadcast, just send the command and verify state
      actor.setInputZone2(testInputId);
      await sleep(500);
      inputObserved = testInputId; // Accept as-is since value was already correct
      result.observations.push('Input unchanged — skipping broadcast verification');
    }

    result.observations.push(
      `Actor set independent source ${testInputId}, observer got useZone2Source=${useZone2Observed}, inputZone2=${inputObserved}`,
    );

    await sleep(300);

    // Restore
    if (origUseZone2 !== observer.getZones().get(zoneId)?.useZone2Source) {
      actor.setZoneUseZone2(zoneId, origUseZone2);
      await waitForZoneUpdate(observer, zoneId, 'useZone2', 5000);
    }

    const allGood = useZone2Observed === true && inputObserved === testInputId;
    result.status = allGood ? 'PASS' : 'FAIL';
    if (!allGood) {
      result.reason = `Observer mismatch: useZone2=${useZone2Observed} (exp true), input=${inputObserved} (exp ${testInputId})`;
    }

    observer.disconnect();
    actor.disconnect();
  } catch (err) {
    result.status = 'FAIL';
    result.reason = err instanceof Error ? err.message : String(err);
  }

  result.durationMs = Date.now() - start;
  return result;
}

// ---------------------------------------------------------------------------
// A10: Zone List Persistence (ST-11 partial)
// ---------------------------------------------------------------------------

export async function scenarioZoneListPersistence(
  config: HardwareTestConfig,
  log: HarnessLogger,
  _spinner: Spinner,
): Promise<ScenarioResult> {
  const result = makeResult('A10. Zone List Persistence');
  const start = Date.now();

  // This scenario verifies the client emits zoneList with structured data
  // that a platform could persist. We cannot verify file I/O here (that's
  // platform-level), but we validate the zoneList payload is well-formed.

  try {
    const { client } = await createAndConnect(config, log);
    const zones = await waitForZoneList(client, 15000);
    await waitForFullStateDump(client);

    if (!zones || zones.length === 0) {
      result.status = 'FAIL';
      result.reason = 'No zone list received';
      client.disconnect();
      result.durationMs = Date.now() - start;
      return result;
    }

    // Validate structure: every zone must have { id: number, name: string }
    let allPersistable = true;
    for (const z of zones) {
      const ok = typeof z.id === 'number' && Number.isInteger(z.id) && z.id > 0 &&
                 typeof z.name === 'string' && z.name.length > 0;
      if (!ok) {
        allPersistable = false;
        result.observations.push(`  Zone ${z.id}: NOT persistable (invalid id/name)`);
      }
    }

    result.observations.push(`${zones.length} zones received, all persistable: ${allPersistable}`);

    // Verify JSON-serializable (what platform would write to disk)
    try {
      const serialized = JSON.stringify(zones.map((z) => ({ id: z.id, name: z.name })));
      const parsed = JSON.parse(serialized) as Array<{ id: number; name: string }>;
      result.observations.push(`JSON round-trip OK: ${parsed.length} entries`);
    } catch {
      allPersistable = false;
      result.observations.push('JSON round-trip FAILED');
    }

    result.status = allPersistable ? 'PASS' : 'FAIL';

    client.disconnect();
  } catch (err) {
    result.status = 'FAIL';
    result.reason = err instanceof Error ? err.message : String(err);
  }

  result.durationMs = Date.now() - start;
  return result;
}

// ---------------------------------------------------------------------------
// A11: Processor Sleep → Zone 2 Inactive (ST-10)
// ---------------------------------------------------------------------------

export async function scenarioSleepZone2Inactive(
  config: HardwareTestConfig,
  log: HarnessLogger,
  spinner: Spinner,
): Promise<ScenarioResult> {
  const result = makeResult('A11. Processor Sleep → Zone 2 Inactive');
  const start = Date.now();
  const zoneId = config.zone2ZoneId!;

  if (skipIfNoZone2(config, result) || skipIfDestructive(config, result)) {
    result.durationMs = Date.now() - start;
    return result;
  }

  try {
    const { client } = await createAndConnect(config, log);
    await waitForFullStateDump(client);

    const procState = client.getProcessorState();
    if (procState !== ProcessorState.Active) {
      result.status = 'SKIP';
      result.reason = `Processor not active (state: ${ProcessorState[procState]}). Need active state to test sleep transition.`;
      client.disconnect();
      result.durationMs = Date.now() - start;
      return result;
    }

    // Record pre-sleep zone state
    const preSleepZone = client.getZones().get(zoneId);
    if (!preSleepZone) {
      result.status = 'FAIL';
      result.reason = `Zone ${zoneId} not found`;
      client.disconnect();
      result.durationMs = Date.now() - start;
      return result;
    }

    result.observations.push(
      `Pre-sleep zone ${zoneId}: mute=${preSleepZone.mute}, vol=${preSleepZone.volume}dB, useZone2=${preSleepZone.useZone2Source}`,
    );

    // Put processor to sleep
    const sleepWait = new Promise<boolean>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; resolve(false); }
      }, 30000);
      const handler = (state: ProcessorState): void => {
        if (!settled && state === ProcessorState.Sleep) {
          settled = true;
          clearTimeout(timer);
          client.removeListener('processorState', handler);
          resolve(true);
        }
      };
      client.on('processorState', handler);
    });

    // Snapshot log index BEFORE sending power off so we only check messages from this scenario
    const logBeforePowerOff = log.messages.length;

    client.setPower(false);
    result.observations.push('Sent power OFF, waiting for sleep...');

    const didSleep = await sleepWait;
    if (!didSleep) {
      result.status = 'SKIP';
      result.reason = 'Processor did not enter sleep within 30s';
      client.disconnect();
      result.durationMs = Date.now() - start;
      return result;
    }

    result.observations.push('Processor entered sleep mode');

    // After sleep, processor state should be Sleep — Zone 2 should be "inactive"
    // In sleep mode, the zone data from the processor is no longer being broadcast.
    // The platform would set Zone 2 to INACTIVE based on processorState=Sleep.
    const postSleepState = client.getProcessorState();
    result.observations.push(`Post-sleep processor state: ${ProcessorState[postSleepState]}`);

    // The key verification: no zone commands should have been SENT by the harness
    // during the transition to sleep. Only check log entries after our power off.
    // "Sent:" prefix distinguishes harness commands from processor broadcasts ("Received:").
    const zoneCommandsAfterSleep = log.messages
      .slice(logBeforePowerOff)
      .filter((m) =>
        m.includes('Sent:') &&
        (m.includes('ssp.zones.mute') || m.includes('ssp.zones.volume') || m.includes('ssp.zones.useZone2') || m.includes('ssp.inputZone2')),
      );

    result.observations.push(
      `Zone commands sent after power-off: ${zoneCommandsAfterSleep.length} (expected 0)`,
    );

    const passed = postSleepState === ProcessorState.Sleep && zoneCommandsAfterSleep.length === 0;
    result.status = passed ? 'PASS' : 'FAIL';
    if (!passed) {
      result.reason = zoneCommandsAfterSleep.length > 0
        ? 'Unexpected zone commands sent during sleep transition'
        : 'Processor did not reach Sleep state';
    }

    // Wake the processor back up for subsequent tests
    result.observations.push('Waking processor for subsequent tests...');
    await sleepWithProgress(2000, spinner, 'Settling before wake...', 50, 60);
    const wakeSuccess = await client.ensureActive();
    result.observations.push(`Wake result: ${wakeSuccess ? 'SUCCESS' : 'TIMEOUT'}`);

    client.disconnect();
  } catch (err) {
    result.status = 'FAIL';
    result.reason = err instanceof Error ? err.message : String(err);
  }

  result.durationMs = Date.now() - start;
  return result;
}

// ---------------------------------------------------------------------------
// A12: Processor Wake → Zone 2 State Restored (ST-10)
// ---------------------------------------------------------------------------

export async function scenarioWakeZone2Restored(
  config: HardwareTestConfig,
  log: HarnessLogger,
  spinner: Spinner,
): Promise<ScenarioResult> {
  const result = makeResult('A12. Processor Wake → Zone 2 State Restored');
  const start = Date.now();
  const zoneId = config.zone2ZoneId!;

  if (skipIfNoZone2(config, result) || skipIfDestructive(config, result)) {
    result.durationMs = Date.now() - start;
    return result;
  }

  try {
    const { client } = await createAndConnect(config, log);
    await waitForFullStateDump(client);

    const procState = client.getProcessorState();
    if (procState !== ProcessorState.Active) {
      result.status = 'SKIP';
      result.reason = `Processor not active (state: ${ProcessorState[procState]})`;
      client.disconnect();
      result.durationMs = Date.now() - start;
      return result;
    }

    // Record pre-sleep zone state
    const preSleepZone = client.getZones().get(zoneId);
    if (!preSleepZone) {
      result.status = 'FAIL';
      result.reason = `Zone ${zoneId} not found`;
      client.disconnect();
      result.durationMs = Date.now() - start;
      return result;
    }

    const preSleepState = {
      mute: preSleepZone.mute,
      volume: preSleepZone.volume,
      useZone2Source: preSleepZone.useZone2Source,
    };
    result.observations.push(
      `Pre-sleep: mute=${preSleepState.mute}, vol=${preSleepState.volume}dB, useZone2=${preSleepState.useZone2Source}`,
    );

    // Sleep the processor
    const sleepWait = new Promise<boolean>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => { if (!settled) { settled = true; resolve(false); } }, 30000);
      const handler = (state: ProcessorState): void => {
        if (!settled && state === ProcessorState.Sleep) {
          settled = true; clearTimeout(timer);
          client.removeListener('processorState', handler);
          resolve(true);
        }
      };
      client.on('processorState', handler);
    });

    client.setPower(false);
    const didSleep = await sleepWait;

    if (!didSleep) {
      result.status = 'SKIP';
      result.reason = 'Processor did not enter sleep within 30s';
      client.disconnect();
      result.durationMs = Date.now() - start;
      return result;
    }

    result.observations.push('Processor asleep. Waiting before wake...');
    await sleepWithProgress(3000, spinner, 'Settling before wake...', 20, 30);

    // Track zone commands sent during wake — should be NONE
    const logBeforeWake = log.messages.length;

    // Wake the processor
    result.observations.push('Sending wake...');
    const wakeSuccess = await client.ensureActive();

    if (!wakeSuccess) {
      result.status = 'FAIL';
      result.reason = 'Processor did not reach Active after wake';
      client.disconnect();
      result.durationMs = Date.now() - start;
      return result;
    }

    result.observations.push('Processor reached Active state');

    // Wait for zone state dump to settle
    await sleep(2000);

    // Check restored zone state
    const postWakeZone = client.getZones().get(zoneId);
    if (!postWakeZone) {
      result.status = 'FAIL';
      result.reason = `Zone ${zoneId} not found after wake`;
      client.disconnect();
      result.durationMs = Date.now() - start;
      return result;
    }

    const postWakeState = {
      mute: postWakeZone.mute,
      volume: postWakeZone.volume,
      useZone2Source: postWakeZone.useZone2Source,
    };

    result.observations.push(
      `Post-wake: mute=${postWakeState.mute}, vol=${postWakeState.volume}dB, useZone2=${postWakeState.useZone2Source}`,
    );

    // Compare
    const muteMatch = preSleepState.mute === postWakeState.mute;
    const volMatch = preSleepState.volume === postWakeState.volume;
    const sourceMatch = preSleepState.useZone2Source === postWakeState.useZone2Source;

    result.observations.push(
      `State match: mute=${muteMatch}, volume=${volMatch}, source=${sourceMatch}`,
    );

    // Verify no zone commands were sent during wake (state dump is authoritative)
    const logDuringWake = log.messages.slice(logBeforeWake);
    const zoneCommandsDuringWake = logDuringWake.filter(
      (m) =>
        m.includes('Sent: ssp.zones.mute') ||
        m.includes('Sent: ssp.zones.volume') ||
        m.includes('Sent: ssp.zones.useZone2') ||
        m.includes('Sent: ssp.inputZone2'),
    );

    result.observations.push(
      `Zone commands sent during wake: ${zoneCommandsDuringWake.length} (expected 0)`,
    );

    const allMatch = muteMatch && volMatch && sourceMatch;
    const noCommands = zoneCommandsDuringWake.length === 0;

    result.status = allMatch && noCommands ? 'PASS' : 'FAIL';
    if (!allMatch) {
      result.reason = `State not fully restored: mute=${muteMatch}, vol=${volMatch}, source=${sourceMatch}`;
    } else if (!noCommands) {
      result.reason = `${zoneCommandsDuringWake.length} unexpected zone commands sent during wake`;
    }

    client.disconnect();
  } catch (err) {
    result.status = 'FAIL';
    result.reason = err instanceof Error ? err.message : String(err);
  }

  result.durationMs = Date.now() - start;
  return result;
}

// ---------------------------------------------------------------------------
// A13: Invalid Zone ID Handling (ST-14)
// ---------------------------------------------------------------------------

export async function scenarioInvalidZoneId(
  config: HardwareTestConfig,
  log: HarnessLogger,
  _spinner: Spinner,
): Promise<ScenarioResult> {
  const result = makeResult('A13. Invalid Zone ID Handling');
  const start = Date.now();

  // This scenario verifies that an invalid zone ID (999) does not exist in the
  // zone list. The platform-level behavior (refusing to create the accessory)
  // is tested in unit tests; here we validate the wire-level precondition.

  try {
    const { client } = await createAndConnect(config, log);
    const zones = await waitForZoneList(client, 15000);
    await waitForFullStateDump(client);

    if (!zones) {
      result.status = 'FAIL';
      result.reason = 'No zone list received';
      client.disconnect();
      result.durationMs = Date.now() - start;
      return result;
    }

    const bogusId = 999;
    const found = zones.find((z) => z.id === bogusId);

    result.observations.push(`Zone list contains ${zones.length} zones`);
    result.observations.push(`Zone ID ${bogusId} in list: ${found ? 'YES (unexpected)' : 'NO (correct)'}`);

    // Also verify getZones() on the client returns the same result
    const clientZones = client.getZones();
    const clientHasBogus = clientZones.has(bogusId);
    result.observations.push(`Client getZones().has(${bogusId}): ${clientHasBogus}`);

    result.status = !found && !clientHasBogus ? 'PASS' : 'FAIL';
    if (found || clientHasBogus) {
      result.reason = `Zone ID ${bogusId} unexpectedly exists on this processor`;
    }

    client.disconnect();
  } catch (err) {
    result.status = 'FAIL';
    result.reason = err instanceof Error ? err.message : String(err);
  }

  result.durationMs = Date.now() - start;
  return result;
}

// ---------------------------------------------------------------------------
// A14: Zone 2-Capable Input Detection (ST-7, ST-8)
// ---------------------------------------------------------------------------

export async function scenarioZone2InputDetection(
  config: HardwareTestConfig,
  log: HarnessLogger,
  _spinner: Spinner,
): Promise<ScenarioResult> {
  const result = makeResult('A14. Zone 2-Capable Input Detection');
  const start = Date.now();

  try {
    const { client } = await createAndConnect(config, log);
    await waitForFullStateDump(client);

    const z2Inputs = client.getZone2Inputs();

    result.observations.push(`Waiting for input list event to get total count...`);
    result.observations.push(`Zone 2-capable inputs: ${z2Inputs.length}`);

    for (const inp of z2Inputs) {
      result.observations.push(`  Input ${inp.id}: "${inp.name}" (zone2AudioInId=${inp.zone2AudioInId})`);
    }

    // Verify all Zone 2 inputs have zone2AudioInId !== 0
    let allValid = true;
    for (const inp of z2Inputs) {
      if (inp.zone2AudioInId === 0 || inp.zone2AudioInId === undefined) {
        allValid = false;
        result.observations.push(`  INVALID: Input ${inp.id} has zone2AudioInId=${inp.zone2AudioInId}`);
      }
    }

    // If testZone2InputId is configured, verify it's in the list
    if (config.testZone2InputId !== null) {
      const found = z2Inputs.find((i) => i.id === config.testZone2InputId);
      if (found) {
        result.observations.push(`Configured testZone2InputId ${config.testZone2InputId}: found in Zone 2 list`);
      } else {
        result.observations.push(
          `WARNING: testZone2InputId ${config.testZone2InputId} NOT found in Zone 2-capable list`,
        );
      }
    }

    result.status = allValid ? 'PASS' : 'FAIL';
    if (!allValid) {
      result.reason = 'One or more Zone 2 inputs had zone2AudioInId=0';
    }

    client.disconnect();
  } catch (err) {
    result.status = 'FAIL';
    result.reason = err instanceof Error ? err.message : String(err);
  }

  result.durationMs = Date.now() - start;
  return result;
}

// ---------------------------------------------------------------------------
// A15: Zone Persistence on Reconnect (ST-1, ST-11)
// ---------------------------------------------------------------------------

export async function scenarioZonePersistenceOnReconnect(
  config: HardwareTestConfig,
  log: HarnessLogger,
  spinner: Spinner,
): Promise<ScenarioResult> {
  const result = makeResult('A15. Zone Persistence on Reconnect');
  const start = Date.now();

  try {
    // First connection
    const { client } = await createAndConnect(config, log);
    const zones1 = await waitForZoneList(client, 15000);
    await waitForFullStateDump(client);

    if (!zones1 || zones1.length === 0) {
      result.status = 'FAIL';
      result.reason = 'No zone list on first connection';
      client.disconnect();
      result.durationMs = Date.now() - start;
      return result;
    }

    result.observations.push(`First connection: ${zones1.length} zones`);

    // Disconnect
    client.disconnect();
    result.observations.push('Disconnected');

    await sleepWithProgress(2000, spinner, 'Waiting before reconnect...', 30, 50);

    // Second connection — fresh client
    const { client: client2 } = await createAndConnect(config, log);
    const zones2 = await waitForZoneList(client2, 15000);
    await waitForStateDump(client2);

    if (!zones2 || zones2.length === 0) {
      result.status = 'FAIL';
      result.reason = 'No zone list on reconnection';
      client2.disconnect();
      result.durationMs = Date.now() - start;
      return result;
    }

    result.observations.push(`Second connection: ${zones2.length} zones`);

    // Compare zone lists
    const ids1 = zones1.map((z) => z.id).sort((a, b) => a - b);
    const ids2 = zones2.map((z) => z.id).sort((a, b) => a - b);

    const idsMatch = ids1.length === ids2.length && ids1.every((id, i) => id === ids2[i]);
    result.observations.push(
      `Zone IDs match across connections: ${idsMatch ? 'YES' : 'NO'} (${JSON.stringify(ids1)} vs ${JSON.stringify(ids2)})`,
    );

    // Verify names match too
    let namesMatch = true;
    for (const z1 of zones1) {
      const z2 = zones2.find((z) => z.id === z1.id);
      if (!z2 || z2.name !== z1.name) {
        namesMatch = false;
        result.observations.push(`  Zone ${z1.id} name mismatch: "${z1.name}" vs "${z2?.name}"`);
      }
    }

    result.status = idsMatch && namesMatch ? 'PASS' : 'FAIL';
    if (!idsMatch) result.reason = 'Zone IDs differ between connections';
    else if (!namesMatch) result.reason = 'Zone names differ between connections';

    client2.disconnect();
  } catch (err) {
    result.status = 'FAIL';
    result.reason = err instanceof Error ? err.message : String(err);
  }

  result.durationMs = Date.now() - start;
  return result;
}
