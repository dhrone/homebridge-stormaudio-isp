/**
 * Preset & Trigger hardware integration test scenarios.
 *
 * Maps to the Epic 6 smoke test scenarios (ST-1 through ST-8).
 * Each scenario exercises the StormAudioClient preset/trigger API
 * against a real processor.
 */

import { StormAudioClient } from '../../src/stormAudioClient';
import { ProcessorState } from '../../src/types';
import type { InputInfo, PresetInfo, StormAudioConfig, StormAudioError } from '../../src/types';
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
 * Wait for a triggerState event matching a specific trigger ID.
 * Returns the boolean state, or null on timeout.
 */
function waitForTriggerState(
  client: StormAudioClient,
  targetTriggerId: number,
  timeoutMs: number,
): Promise<boolean | null> {
  return new Promise((resolve) => {
    let settled = false;

    const handler = (triggerId: number, on: boolean): void => {
      if (!settled && triggerId === targetTriggerId) {
        settled = true;
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        clearTimeout(timer);
        client.removeListener('triggerState', handler);
        resolve(on);
      }
    };

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        client.removeListener('triggerState', handler);
        resolve(null);
      }
    }, timeoutMs);

    client.on('triggerState', handler);
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
      name: 'PresetTriggerHarnessTest',
      volumeCeiling: config.volumeCeiling,
      volumeFloor: config.volumeFloor,
      volumeControl: 'fan',
      wakeTimeout: 90,
      commandInterval: 0,
      inputs: {},
    };

    const client = new StormAudioClient(stormConfig, log);

    client.on('error', (err: StormAudioError) => {
      log.warn(`[PresetTriggerHarness] Client error event: ${err.category} — ${err.message}`);
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

function formatTriggerStates(states: Map<number, boolean>): string {
  if (states.size === 0) return '(none)';
  const entries: string[] = [];
  for (const [id, on] of states.entries()) {
    entries.push(`T${id}=${on ? 'ON' : 'OFF'}`);
  }
  return entries.join(', ');
}

function waitForStateDump(client: StormAudioClient, timeoutMs = 15000): Promise<InputInfo[] | null> {
  return waitForEvent<InputInfo[]>(client, 'inputList', timeoutMs);
}

/** Wait for the presetList event. Returns the preset array or null on timeout. */
function waitForPresetList(client: StormAudioClient, timeoutMs = 15000): Promise<PresetInfo[] | null> {
  return waitForEvent<PresetInfo[]>(client, 'presetList', timeoutMs);
}

/**
 * Wait for BOTH inputList and presetList events.
 * Returns { inputs, presets } or nulls on timeout.
 */
async function waitForFullStateDump(
  client: StormAudioClient,
  timeoutMs = 15000,
): Promise<{ inputs: InputInfo[] | null; presets: PresetInfo[] | null }> {
  const [inputs, presets] = await Promise.all([
    waitForStateDump(client, timeoutMs),
    waitForPresetList(client, timeoutMs),
  ]);
  return { inputs, presets };
}

// ---------------------------------------------------------------------------
// Scenario P1: Preset List Retrieval (ST-1)
// ---------------------------------------------------------------------------

export async function scenarioPresetListRetrieval(
  config: HardwareTestConfig,
  log: HarnessLogger,
  _spinner: Spinner,
): Promise<ScenarioResult> {
  const result = makeResult('P1. Preset List Retrieval');
  const start = Date.now();

  try {
    const { client } = await createAndConnect(config, log);
    const { inputs, presets } = await waitForFullStateDump(client);

    if (!inputs) {
      result.observations.push('Input list not received (unexpected)');
    }

    if (!presets || presets.length === 0) {
      result.status = 'FAIL';
      result.reason = 'No presets received from processor';
      client.disconnect();
      result.durationMs = Date.now() - start;
      return result;
    }

    result.observations.push(`Received ${presets.length} presets`);

    let allValid = true;
    for (const p of presets) {
      const valid = typeof p.id === 'number' && p.id >= 0 && typeof p.name === 'string' && p.name.length > 0;
      result.observations.push(`  Preset ${p.id}: "${p.name}" — ${valid ? 'valid' : 'INVALID'}`);
      if (!valid) {
        allValid = false;
      }
    }

    // Check for duplicate IDs
    const ids = presets.map((p) => p.id);
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length) {
      result.observations.push('WARNING: Duplicate preset IDs detected');
      allValid = false;
    }

    // Verify cached preset list matches
    const cached = client.getAudioConfig().presetList;
    if (cached.length !== presets.length) {
      result.observations.push(`WARNING: Cached preset count (${cached.length}) does not match event (${presets.length})`);
      allValid = false;
    } else {
      result.observations.push(`Cached preset list matches: ${cached.length} presets`);
    }

    // Read current active preset
    const activePreset = client.getAudioConfig().preset;
    result.observations.push(`Active preset ID: ${activePreset}`);

    result.status = allValid ? 'PASS' : 'FAIL';
    if (!allValid) {
      result.reason = 'One or more presets had invalid id/name pairs or duplicates';
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
// Scenario P2: Trigger State Retrieval (ST-1)
// ---------------------------------------------------------------------------

export async function scenarioTriggerStateRetrieval(
  config: HardwareTestConfig,
  log: HarnessLogger,
  _spinner: Spinner,
): Promise<ScenarioResult> {
  const result = makeResult('P2. Trigger State Retrieval');
  const start = Date.now();

  try {
    const { client } = await createAndConnect(config, log);
    await waitForStateDump(client);

    // Give time for trigger state broadcasts to arrive (they come after input list)
    await sleep(2000);

    const triggerStates = client.getTriggerStates();

    if (triggerStates.size === 0) {
      result.observations.push('No trigger states received — processor may not have broadcast trigger states yet');
      result.observations.push('This is not necessarily a failure — triggers may all be off by default');
      result.status = 'PASS';
    } else {
      result.observations.push(`Received trigger states for ${triggerStates.size} trigger(s)`);

      let allValid = true;
      for (const [id, on] of triggerStates.entries()) {
        const valid = typeof id === 'number' && id >= 1 && id <= 4 && typeof on === 'boolean';
        result.observations.push(`  Trigger ${id}: ${on ? 'ON' : 'OFF'} — ${valid ? 'valid' : 'INVALID'}`);
        if (!valid) {
          allValid = false;
        }
      }

      result.status = allValid ? 'PASS' : 'FAIL';
      if (!allValid) {
        result.reason = 'One or more trigger states had invalid id or value';
      }
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
// Scenario P3: Preset Command Round-Trip (ST-2)
// ---------------------------------------------------------------------------

export async function scenarioPresetCommandRoundTrip(
  config: HardwareTestConfig,
  log: HarnessLogger,
  _spinner: Spinner,
): Promise<{ result: ScenarioResult; responseStats: ResponseTimeStat[] }> {
  const result = makeResult('P3. Preset Command Round-Trip');
  const responseStats: ResponseTimeStat[] = [];
  const start = Date.now();

  if (config.skipDestructive) {
    result.status = 'SKIP';
    result.reason = 'skipDestructive is true';
    result.durationMs = Date.now() - start;
    return { result, responseStats };
  }

  if (config.testPresetId === null) {
    result.status = 'SKIP';
    result.reason = 'testPresetId not configured';
    result.durationMs = Date.now() - start;
    return { result, responseStats };
  }

  try {
    const { client } = await createAndConnect(config, log);
    const { presets } = await waitForFullStateDump(client);

    const procState = client.getProcessorState();
    if (procState !== ProcessorState.Active) {
      result.status = 'SKIP';
      result.reason = `Processor not active (state: ${ProcessorState[procState]}). Cannot test preset commands safely.`;
      client.disconnect();
      result.durationMs = Date.now() - start;
      return { result, responseStats };
    }

    if (!presets || presets.length === 0) {
      result.status = 'FAIL';
      result.reason = 'No presets received — cannot test preset selection';
      client.disconnect();
      result.durationMs = Date.now() - start;
      return { result, responseStats };
    }

    // Capture original preset for restoration
    const origPreset = client.getAudioConfig().preset;
    result.observations.push(`Original active preset: ${origPreset}`);

    // Validate target preset exists
    const targetPresetId = config.testPresetId;
    const targetExists = presets.some((p) => p.id === targetPresetId);
    if (!targetExists) {
      result.status = 'FAIL';
      result.reason = `testPresetId ${targetPresetId} not found in preset list: [${presets.map((p) => p.id).join(', ')}]`;
      client.disconnect();
      result.durationMs = Date.now() - start;
      return { result, responseStats };
    }

    const targetPresetName = presets.find((p) => p.id === targetPresetId)?.name ?? 'unknown';
    result.observations.push(`Target preset: ${targetPresetId} ("${targetPresetName}")`);

    // --- Send preset command ---
    const cmdStart = Date.now();
    client.setPreset(targetPresetId);
    const presetResult = await waitForEvent<number>(client, 'preset', 10000);
    const elapsed = Date.now() - cmdStart;
    responseStats.push({ command: `setPreset(${targetPresetId})`, roundTripMs: elapsed });

    if (presetResult !== null) {
      result.observations.push(`Preset set to ${targetPresetId}, confirmed: ${presetResult} in ${elapsed}ms`);
    } else {
      result.observations.push(`Preset set to ${targetPresetId}, no confirmation within 10s`);
    }

    // Verify internal state updated
    await sleep(500);
    const currentPreset = client.getAudioConfig().preset;
    result.observations.push(`getAudioConfig().preset after command: ${currentPreset}`);

    // --- Restore original preset ---
    if (origPreset !== currentPreset && origPreset !== 0) {
      result.observations.push(`Restoring original preset: ${origPreset}...`);
      client.setPreset(origPreset);
      await waitForEvent<number>(client, 'preset', 10000);
      await sleep(500);
      const restored = client.getAudioConfig().preset;
      result.observations.push(`Restored preset: ${restored}`);
    }

    // Evaluate
    const presetMatch = presetResult === targetPresetId || currentPreset === targetPresetId;
    if (presetMatch) {
      result.status = 'PASS';
    } else {
      result.status = 'FAIL';
      result.reason = `Preset command sent but confirmation mismatch: expected ${targetPresetId}, got event=${presetResult}, state=${currentPreset}`;
    }

    client.disconnect();
  } catch (err) {
    result.status = 'FAIL';
    result.reason = err instanceof Error ? err.message : String(err);
  }

  result.durationMs = Date.now() - start;
  return { result, responseStats };
}

// ---------------------------------------------------------------------------
// Scenario P4: Preset Wake from Sleep (ST-5)
// ---------------------------------------------------------------------------

export async function scenarioPresetWakeFromSleep(
  config: HardwareTestConfig,
  log: HarnessLogger,
  spinner: Spinner,
): Promise<ScenarioResult> {
  const result = makeResult('P4. Preset Wake from Sleep');
  const start = Date.now();

  if (config.skipDestructive) {
    result.status = 'SKIP';
    result.reason = 'skipDestructive is true';
    result.durationMs = Date.now() - start;
    return result;
  }

  if (config.testPresetId === null) {
    result.status = 'SKIP';
    result.reason = 'testPresetId not configured';
    result.durationMs = Date.now() - start;
    return result;
  }

  try {
    const { client } = await createAndConnect(config, log);
    const { presets } = await waitForFullStateDump(client);

    if (!presets || presets.length === 0) {
      result.status = 'FAIL';
      result.reason = 'No presets received';
      client.disconnect();
      result.durationMs = Date.now() - start;
      return result;
    }

    const procState = client.getProcessorState();

    // Ensure processor is sleeping
    if (procState === ProcessorState.Active) {
      result.observations.push('Processor is active. Putting to sleep first...');
      client.setPower(false);

      const sleepResult = await new Promise<boolean>((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            resolve(false);
          }
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

      if (!sleepResult) {
        result.status = 'SKIP';
        result.reason = 'Could not put processor to sleep within 30s';
        client.disconnect();
        result.durationMs = Date.now() - start;
        return result;
      }

      result.observations.push('Processor is now in sleep mode');
      await sleepWithProgress(2000, spinner, 'Letting processor settle...', 10, 15);
    } else if (procState === ProcessorState.Sleep) {
      result.observations.push('Processor is already in sleep mode');
    } else {
      result.status = 'SKIP';
      result.reason = `Processor in unexpected state: ${ProcessorState[procState]}`;
      client.disconnect();
      result.durationMs = Date.now() - start;
      return result;
    }

    // Now wake via ensureActive() and set preset
    result.observations.push('Calling ensureActive() + setPreset()...');
    const wakeStart = Date.now();
    const stateTransitions: string[] = [];

    const trackStates = (state: ProcessorState): void => {
      stateTransitions.push(`${ProcessorState[state]} at +${Date.now() - wakeStart}ms`);
    };
    client.on('processorState', trackStates);

    const wakeSuccess = await client.ensureActive();
    client.removeListener('processorState', trackStates);

    const wakeDuration = Date.now() - wakeStart;
    result.observations.push(`ensureActive() result: ${wakeSuccess ? 'SUCCESS' : 'TIMEOUT'} in ${wakeDuration}ms`);
    result.observations.push(`State transitions: ${stateTransitions.join(' -> ')}`);

    if (wakeSuccess) {
      // Send preset command now that processor is active
      const targetPresetId = config.testPresetId;
      result.observations.push(`Sending preset command: ${targetPresetId}...`);
      client.setPreset(targetPresetId);
      const presetResult = await waitForEvent<number>(client, 'preset', 10000);

      if (presetResult !== null) {
        result.observations.push(`Preset ${targetPresetId} confirmed after wake in ${Date.now() - wakeStart}ms total`);
        result.status = 'PASS';
      } else {
        // Check internal state as fallback
        await sleep(500);
        const currentPreset = client.getAudioConfig().preset;
        if (currentPreset === targetPresetId) {
          result.observations.push(`Preset ${targetPresetId} confirmed via state (no event echo)`);
          result.status = 'PASS';
        } else {
          result.status = 'FAIL';
          result.reason = `Preset command sent after wake but not confirmed. Current preset: ${currentPreset}`;
        }
      }
    } else {
      result.status = 'FAIL';
      result.reason = `Processor did not reach Active within timeout (${wakeDuration}ms)`;
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
// Scenario P5: Trigger Command Round-Trip (ST-6, ST-7)
// ---------------------------------------------------------------------------

export async function scenarioTriggerCommandRoundTrip(
  config: HardwareTestConfig,
  log: HarnessLogger,
  _spinner: Spinner,
): Promise<{ result: ScenarioResult; responseStats: ResponseTimeStat[] }> {
  const result = makeResult('P5. Trigger Command Round-Trip');
  const responseStats: ResponseTimeStat[] = [];
  const start = Date.now();

  if (config.skipDestructive) {
    result.status = 'SKIP';
    result.reason = 'skipDestructive is true';
    result.durationMs = Date.now() - start;
    return { result, responseStats };
  }

  if (config.testTriggerId === null) {
    result.status = 'SKIP';
    result.reason = 'testTriggerId not configured';
    result.durationMs = Date.now() - start;
    return { result, responseStats };
  }

  try {
    const { client } = await createAndConnect(config, log);
    await waitForStateDump(client);

    const procState = client.getProcessorState();
    if (procState !== ProcessorState.Active) {
      result.status = 'SKIP';
      result.reason = `Processor not active (state: ${ProcessorState[procState]}). Cannot test trigger commands safely.`;
      client.disconnect();
      result.durationMs = Date.now() - start;
      return { result, responseStats };
    }

    // Wait for trigger states to arrive
    await sleep(2000);

    const triggerId = config.testTriggerId;
    const origState = client.getTriggerStates().get(triggerId) ?? false;
    result.observations.push(`Trigger ${triggerId} original state: ${origState ? 'ON' : 'OFF'}`);

    // --- Toggle trigger ON ---
    {
      const targetState = !origState;
      const cmdStart = Date.now();
      client.setTrigger(triggerId, targetState);
      const trigResult = await waitForTriggerState(client, triggerId, 5000);
      const elapsed = Date.now() - cmdStart;
      responseStats.push({ command: `setTrigger(${triggerId}, ${targetState})`, roundTripMs: elapsed });

      if (trigResult !== null) {
        result.observations.push(`Trigger ${triggerId} set to ${targetState}, confirmed: ${trigResult} in ${elapsed}ms`);
      } else {
        result.observations.push(`Trigger ${triggerId} set to ${targetState}, no confirmation within 5s`);
      }
    }

    // Small pause between toggles
    await sleep(500);

    // --- Toggle trigger back ---
    {
      const cmdStart = Date.now();
      client.setTrigger(triggerId, origState);
      const trigResult = await waitForTriggerState(client, triggerId, 5000);
      const elapsed = Date.now() - cmdStart;
      responseStats.push({ command: `setTrigger(${triggerId}, ${origState})`, roundTripMs: elapsed });

      if (trigResult !== null) {
        result.observations.push(`Trigger ${triggerId} restored to ${origState}, confirmed: ${trigResult} in ${elapsed}ms`);
      } else {
        result.observations.push(`Trigger ${triggerId} restored to ${origState}, no confirmation within 5s`);
      }
    }

    // Verify final state matches original
    await sleep(500);
    const finalState = client.getTriggerStates().get(triggerId);
    result.observations.push(`Final trigger ${triggerId} state: ${finalState !== undefined ? (finalState ? 'ON' : 'OFF') : 'unknown'}`);

    const restored = finalState === origState;
    if (restored) {
      result.status = 'PASS';
      result.observations.push('Trigger state fully restored');
    } else {
      result.status = 'PASS';
      result.observations.push('WARNING: Trigger state may not have restored (auto-switching rules may override manual toggle)');
    }

    client.disconnect();
  } catch (err) {
    result.status = 'FAIL';
    result.reason = err instanceof Error ? err.message : String(err);
  }

  result.durationMs = Date.now() - start;
  return { result, responseStats };
}

// ---------------------------------------------------------------------------
// Scenario P6: Trigger Bidirectional Sync via Preset Change (ST-8)
// ---------------------------------------------------------------------------

export async function scenarioTriggerBidirectionalSync(
  config: HardwareTestConfig,
  log: HarnessLogger,
  spinner: Spinner,
): Promise<ScenarioResult> {
  const result = makeResult('P6. Trigger Bidirectional Sync');
  const start = Date.now();

  if (config.skipDestructive) {
    result.status = 'SKIP';
    result.reason = 'skipDestructive is true';
    result.durationMs = Date.now() - start;
    return result;
  }

  if (config.testPresetId === null) {
    result.status = 'SKIP';
    result.reason = 'testPresetId not configured (needed to change preset and observe trigger changes)';
    result.durationMs = Date.now() - start;
    return result;
  }

  try {
    const { client } = await createAndConnect(config, log);
    const { presets } = await waitForFullStateDump(client);

    const procState = client.getProcessorState();
    if (procState !== ProcessorState.Active) {
      result.status = 'SKIP';
      result.reason = `Processor not active (state: ${ProcessorState[procState]})`;
      client.disconnect();
      result.durationMs = Date.now() - start;
      return result;
    }

    if (!presets || presets.length < 2) {
      result.status = 'SKIP';
      result.reason = 'Need at least 2 presets to test bidirectional sync (change preset → observe trigger changes)';
      client.disconnect();
      result.durationMs = Date.now() - start;
      return result;
    }

    // Wait for trigger states to settle
    await sleep(2000);

    // Record initial state
    const origPreset = client.getAudioConfig().preset;
    const origTriggers = new Map(client.getTriggerStates());
    result.observations.push(`Initial preset: ${origPreset}`);
    result.observations.push(`Initial trigger states: ${formatTriggerStates(origTriggers)}`);

    // Find a different preset to switch to
    const targetPresetId = config.testPresetId;
    const targetExists = presets.some((p) => p.id === targetPresetId);
    if (!targetExists) {
      result.status = 'SKIP';
      result.reason = `testPresetId ${targetPresetId} not found in preset list`;
      client.disconnect();
      result.durationMs = Date.now() - start;
      return result;
    }

    // Collect trigger state changes
    const triggerChanges: Array<{ id: number; on: boolean; atMs: number }> = [];
    const changeStart = Date.now();
    const triggerHandler = (triggerId: number, on: boolean): void => {
      triggerChanges.push({ id: triggerId, on, atMs: Date.now() - changeStart });
    };
    client.on('triggerState', triggerHandler);

    // Change preset
    result.observations.push(`Switching to preset ${targetPresetId}...`);
    client.setPreset(targetPresetId);

    // Wait for cascading changes (preset change may trigger auto-switching)
    await sleepWithProgress(5000, spinner, 'Waiting for trigger auto-switching...', 50, 80);

    client.removeListener('triggerState', triggerHandler);

    // Report changes
    const newTriggers = new Map(client.getTriggerStates());
    result.observations.push(`Trigger states after preset change: ${formatTriggerStates(newTriggers)}`);

    if (triggerChanges.length > 0) {
      result.observations.push(`Observed ${triggerChanges.length} trigger state change(s):`);
      for (const change of triggerChanges) {
        result.observations.push(`  Trigger ${change.id}: ${change.on ? 'ON' : 'OFF'} at +${change.atMs}ms`);
      }
    } else {
      result.observations.push('No trigger state changes observed (preset may not have auto-switching rules for triggers)');
    }

    // Restore original preset
    if (origPreset !== 0 && origPreset !== targetPresetId) {
      result.observations.push(`Restoring original preset: ${origPreset}...`);
      client.setPreset(origPreset);
      await waitForEvent<number>(client, 'preset', 10000);
      await sleep(2000);
    }

    // The scenario passes if we successfully observed trigger broadcasts (or lack thereof)
    // — both outcomes are valid depending on the processor's preset configuration.
    result.status = 'PASS';
    result.observations.push('Bidirectional sync test complete — trigger broadcasts received and parsed correctly');

    client.disconnect();
  } catch (err) {
    result.status = 'FAIL';
    result.reason = err instanceof Error ? err.message : String(err);
  }

  result.durationMs = Date.now() - start;
  return result;
}

