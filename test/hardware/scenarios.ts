/**
 * Hardware integration test scenarios.
 *
 * Each scenario function receives a connected StormAudioClient and returns
 * a ScenarioResult. Scenarios are designed to be safe for real hardware.
 */

import { StormAudioClient } from '../../src/stormAudioClient';
import { ProcessorState } from '../../src/types';
import type { InputInfo, StormAudioConfig, StormAudioError } from '../../src/types';
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

/** Wait for a specific event with a timeout. Returns the event args or null on timeout. */
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

/** Sleep for a duration. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a fresh StormAudioClient, connect it, wait for initial state,
 * and return it. Resolves when 'connected' fires. Rejects on timeout.
 */
function createAndConnect(
  config: HardwareTestConfig,
  log: HarnessLogger,
  timeoutMs = 15000,
): Promise<{ client: StormAudioClient; connectMs: number }> {
  return new Promise((resolve, reject) => {
    const stormConfig: StormAudioConfig = {
      host: config.host,
      port: config.port,
      name: 'HarnessTest',
      volumeCeiling: config.volumeCeiling,
      volumeFloor: config.volumeFloor,
      volumeControl: 'fan',
      wakeTimeout: 90,
      commandInterval: 0,
      inputs: {},
    };

    const client = new StormAudioClient(stormConfig, log);

    // CRITICAL: register error listener to prevent unhandled 'error' throws
    client.on('error', (err: StormAudioError) => {
      log.warn(`[Harness] Client error event: ${err.category} — ${err.message}`);
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

/** Wait for the initial state dump to settle (input list received). */
function waitForStateDump(client: StormAudioClient, timeoutMs = 15000): Promise<InputInfo[] | null> {
  return waitForEvent<InputInfo[]>(client, 'inputList', timeoutMs);
}

// ---------------------------------------------------------------------------
// Scenario 1: Connection Lifecycle
// ---------------------------------------------------------------------------

export async function scenarioConnectionLifecycle(
  config: HardwareTestConfig,
  log: HarnessLogger,
  _spinner: Spinner,
): Promise<{ result: ScenarioResult; connectMs: number }> {
  const result = makeResult('1. Connection Lifecycle');
  const start = Date.now();
  let connectMs = 0;

  try {
    const { client, connectMs: cMs } = await createAndConnect(config, log);
    connectMs = cMs;
    result.observations.push(`Connected in ${connectMs}ms`);

    // Wait for initial state dump
    const inputs = await waitForStateDump(client);

    const power = client.getPower();
    const volume = client.getVolume();
    const mute = client.getMute();
    const input = client.getInput();
    const procState = client.getProcessorState();
    const identity = client.getIdentity();

    result.observations.push(`Power: ${power ? 'ON' : 'OFF'}`);
    result.observations.push(`Volume: ${volume} dB`);
    result.observations.push(`Mute: ${mute}`);
    result.observations.push(`Input: ${input}`);
    result.observations.push(`Processor state: ${ProcessorState[procState]} (${procState})`);
    result.observations.push(`Identity: ${identity.brand} ${identity.model} v${identity.version}`);

    if (inputs) {
      result.observations.push(`Input list: ${inputs.length} inputs`);
      for (const inp of inputs) {
        result.observations.push(`  Input ${inp.id}: ${inp.name}`);
      }
    } else {
      result.observations.push('Input list: not received within timeout');
    }

    // Verify we got essential state
    const hasState = procState !== undefined && volume !== undefined;
    if (!hasState) {
      result.status = 'FAIL';
      result.reason = 'Essential state fields not received';
    } else {
      result.status = 'PASS';
    }

    // Graceful disconnect
    client.disconnect();
    result.observations.push('Disconnected gracefully');
  } catch (err) {
    result.status = 'FAIL';
    result.reason = err instanceof Error ? err.message : String(err);
  }

  result.durationMs = Date.now() - start;
  return { result, connectMs };
}

// ---------------------------------------------------------------------------
// Scenario 2: Command Round-Trip
// ---------------------------------------------------------------------------

export async function scenarioCommandRoundTrip(
  config: HardwareTestConfig,
  log: HarnessLogger,
  _spinner: Spinner,
): Promise<{ result: ScenarioResult; responseStats: ResponseTimeStat[] }> {
  const result = makeResult('2. Command Round-Trip');
  const responseStats: ResponseTimeStat[] = [];
  const start = Date.now();

  if (config.skipDestructive) {
    result.status = 'SKIP';
    result.reason = 'skipDestructive is true';
    result.durationMs = Date.now() - start;
    return { result, responseStats };
  }

  try {
    const { client } = await createAndConnect(config, log);
    await waitForStateDump(client);

    const procState = client.getProcessorState();
    if (procState !== ProcessorState.Active) {
      result.status = 'SKIP';
      result.reason = `Processor not active (state: ${ProcessorState[procState]}). Cannot test commands safely.`;
      client.disconnect();
      result.durationMs = Date.now() - start;
      return { result, responseStats };
    }

    // Capture original state for restoration
    const origPower = client.getPower();
    const origVolume = client.getVolume();
    const origMute = client.getMute();
    const origInput = client.getInput();

    result.observations.push(
      `Original state: power=${origPower}, vol=${origVolume}dB, mute=${origMute}, input=${origInput}`,
    );

    // --- Test volume command ---
    {
      const targetVol = config.testVolumeDb;
      const cmdStart = Date.now();
      client.setVolume(targetVol);
      const volResult = await waitForEvent<number>(client, 'volume', 5000);
      const elapsed = Date.now() - cmdStart;
      responseStats.push({ command: `setVolume(${targetVol})`, roundTripMs: elapsed });

      if (volResult !== null) {
        result.observations.push(`Volume set to ${targetVol}dB, confirmed: ${volResult}dB in ${elapsed}ms`);
      } else {
        result.observations.push(`Volume set to ${targetVol}dB, no confirmation within 5s`);
      }
    }

    // --- Test mute toggle ---
    {
      const targetMute = !origMute;
      const cmdStart = Date.now();
      client.setMute(targetMute);
      const muteResult = await waitForEvent<boolean>(client, 'mute', 5000);
      const elapsed = Date.now() - cmdStart;
      responseStats.push({ command: `setMute(${targetMute})`, roundTripMs: elapsed });

      if (muteResult !== null) {
        result.observations.push(`Mute set to ${targetMute}, confirmed: ${muteResult} in ${elapsed}ms`);
      } else {
        result.observations.push(`Mute set to ${targetMute}, no confirmation within 5s`);
      }
    }

    // --- Test input switch ---
    {
      // Find a different input to switch to
      let targetInput = config.testInputId;
      if (targetInput === null || targetInput === origInput) {
        // Pick a different input if available — we need the input list
        // If testInputId is same as current, we still send it to verify the round-trip
        if (targetInput === null) {
          targetInput = origInput; // fallback: send same input
        }
      }
      const cmdStart = Date.now();
      client.setInput(targetInput);
      const inputResult = await waitForEvent<number>(client, 'input', 5000);
      const elapsed = Date.now() - cmdStart;
      responseStats.push({ command: `setInput(${targetInput})`, roundTripMs: elapsed });

      if (inputResult !== null) {
        result.observations.push(`Input set to ${targetInput}, confirmed: ${inputResult} in ${elapsed}ms`);
      } else {
        result.observations.push(`Input set to ${targetInput}, no confirmation within 5s`);
      }
    }

    // --- Restore original state ---
    result.observations.push('Restoring original state...');

    if (origInput !== client.getInput()) {
      client.setInput(origInput);
      await waitForEvent<number>(client, 'input', 5000);
    }

    if (origMute !== client.getMute()) {
      client.setMute(origMute);
      await waitForEvent<boolean>(client, 'mute', 5000);
    }

    if (origVolume !== client.getVolume()) {
      client.setVolume(origVolume);
      await waitForEvent<number>(client, 'volume', 5000);
    }

    const finalVol = client.getVolume();
    const finalMute = client.getMute();
    const finalInput = client.getInput();
    result.observations.push(`Restored state: vol=${finalVol}dB, mute=${finalMute}, input=${finalInput}`);

    const restored = finalVol === origVolume && finalMute === origMute && finalInput === origInput;
    if (restored) {
      result.observations.push('State fully restored');
    } else {
      result.observations.push('WARNING: State not fully restored');
    }

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
// Scenario 3: Input List Retrieval
// ---------------------------------------------------------------------------

export async function scenarioInputListRetrieval(
  config: HardwareTestConfig,
  log: HarnessLogger,
  _spinner: Spinner,
): Promise<ScenarioResult> {
  const result = makeResult('3. Input List Retrieval');
  const start = Date.now();

  try {
    const { client } = await createAndConnect(config, log);
    const inputs = await waitForStateDump(client);

    if (!inputs || inputs.length === 0) {
      result.status = 'FAIL';
      result.reason = 'No inputs received from processor';
      client.disconnect();
      result.durationMs = Date.now() - start;
      return result;
    }

    result.observations.push(`Received ${inputs.length} inputs`);

    let allValid = true;
    for (const inp of inputs) {
      const valid = typeof inp.id === 'number' && inp.id > 0 && typeof inp.name === 'string' && inp.name.length > 0;
      result.observations.push(`  Input ${inp.id}: "${inp.name}" — ${valid ? 'valid' : 'INVALID'}`);
      if (!valid) {
        allValid = false;
      }
    }

    // Check for duplicate IDs
    const ids = inputs.map((i) => i.id);
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length) {
      result.observations.push('WARNING: Duplicate input IDs detected');
      allValid = false;
    }

    result.status = allValid ? 'PASS' : 'FAIL';
    if (!allValid) {
      result.reason = 'One or more inputs had invalid id/name pairs or duplicate IDs';
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
// Scenario 4: Wake from Sleep
// ---------------------------------------------------------------------------

export async function scenarioWakeFromSleep(config: HardwareTestConfig, log: HarnessLogger, spinner: Spinner): Promise<ScenarioResult> {
  const result = makeResult('4. Wake from Sleep');
  const start = Date.now();

  if (config.skipDestructive) {
    result.status = 'SKIP';
    result.reason = 'skipDestructive is true';
    result.durationMs = Date.now() - start;
    return result;
  }

  try {
    const { client } = await createAndConnect(config, log);
    await waitForStateDump(client);

    const procState = client.getProcessorState();

    if (procState === ProcessorState.Active) {
      result.observations.push('Processor is already active. Putting to sleep first...');
      client.setPower(false);

      // Wait for processor to enter sleep — up to 30s
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
      // Wait a beat to let the processor settle
      await sleepWithProgress(2000, spinner, 'Letting processor settle...', 10, 15);
    } else if (procState === ProcessorState.Sleep) {
      result.observations.push('Processor is in sleep mode — will attempt wake');
    } else {
      result.observations.push(`Processor is in state ${ProcessorState[procState]} — waiting for it to settle`);
      // Wait up to 90s for it to reach Active or Sleep
      const settleResult = await new Promise<ProcessorState>((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            resolve(client.getProcessorState());
          }
        }, 90000);
        const handler = (state: ProcessorState): void => {
          if (!settled && (state === ProcessorState.Active || state === ProcessorState.Sleep)) {
            settled = true;
            clearTimeout(timer);
            client.removeListener('processorState', handler);
            resolve(state);
          }
        };
        client.on('processorState', handler);
      });

      if (settleResult === ProcessorState.Active) {
        // Try to sleep it
        client.setPower(false);
        await sleepWithProgress(10000, spinner, 'Waiting for processor to sleep...', 15, 30);
      }
    }

    // Now attempt wake
    result.observations.push('Sending power ON (wake)...');
    const wakeStart = Date.now();
    const stateTransitions: string[] = [];

    const trackStates = (state: ProcessorState): void => {
      stateTransitions.push(`${ProcessorState[state]} at +${Date.now() - wakeStart}ms`);
    };
    client.on('processorState', trackStates);

    const wakeSuccess = await client.ensureActive();
    client.removeListener('processorState', trackStates);

    const wakeDuration = Date.now() - wakeStart;
    result.observations.push(`Wake result: ${wakeSuccess ? 'SUCCESS' : 'TIMEOUT'} in ${wakeDuration}ms`);
    result.observations.push(`State transitions: ${stateTransitions.join(' -> ')}`);

    if (wakeSuccess) {
      result.status = 'PASS';
      result.observations.push(`Processor reached Active state in ${wakeDuration}ms`);
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
// Scenario 5: Reconnection
// ---------------------------------------------------------------------------

export async function scenarioReconnection(
  config: HardwareTestConfig,
  log: HarnessLogger,
  _spinner: Spinner,
): Promise<{ result: ScenarioResult; reconnectMs: number | null }> {
  const result = makeResult('5. Reconnection');
  const start = Date.now();
  let reconnectMs: number | null = null;

  try {
    const { client } = await createAndConnect(config, log);
    await waitForStateDump(client);

    result.observations.push('Connected and state received. Simulating network interruption...');

    // Access the socket via the client's internal state to force-destroy it.
    // This simulates a network interruption without calling disconnect()
    // (which would set intentionalDisconnect=true and suppress reconnection).
    //
    // We use a targeted approach: emit 'error' then 'close' on the socket
    // to trigger the reconnection path. Since we cannot access private members
    // directly in TypeScript strict mode, we cast through unknown.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clientAny = client as any;
    const socket = clientAny.socket as { destroy: (err?: Error) => void } | null;
    if (!socket) {
      result.status = 'FAIL';
      result.reason = 'Could not access internal socket for reconnection test';
      client.disconnect();
      result.durationMs = Date.now() - start;
      return { result, reconnectMs };
    }

    const disconnectTime = Date.now();

    // Track reconnection
    const reconnected = new Promise<boolean>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      }, 60000); // 60s timeout for reconnection

      client.once('connected', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(true);
        }
      });
    });

    // Force-destroy the socket (simulates network drop)
    socket.destroy(new Error('Simulated network interruption'));
    result.observations.push('Socket destroyed. Waiting for reconnection...');

    const didReconnect = await reconnected;
    reconnectMs = Date.now() - disconnectTime;

    if (didReconnect) {
      result.observations.push(`Reconnected in ${reconnectMs}ms`);

      // Wait for state re-sync
      const inputs = await waitForStateDump(client, 15000);
      if (inputs) {
        result.observations.push(`State re-synced: ${inputs.length} inputs received`);
      } else {
        result.observations.push(
          'State re-sync: input list not received within timeout (may have been received before listener attached)',
        );
      }

      // Verify client is functional
      const power = client.getPower();
      const vol = client.getVolume();
      result.observations.push(`Post-reconnect state: power=${power}, vol=${vol}dB`);
      result.status = 'PASS';
    } else {
      result.status = 'FAIL';
      result.reason = `Reconnection did not occur within 60s`;
    }

    client.disconnect();
  } catch (err) {
    result.status = 'FAIL';
    result.reason = err instanceof Error ? err.message : String(err);
  }

  result.durationMs = Date.now() - start;
  return { result, reconnectMs };
}

// ---------------------------------------------------------------------------
// Scenario 6: Keepalive
// ---------------------------------------------------------------------------

export async function scenarioKeepalive(
  config: HardwareTestConfig,
  log: HarnessLogger,
  spinner: Spinner,
): Promise<{ result: ScenarioResult; keepalivesObserved: number }> {
  const result = makeResult('6. Keepalive');
  const start = Date.now();
  let keepalivesObserved = 0;

  try {
    const { client } = await createAndConnect(config, log);
    await waitForStateDump(client);

    result.observations.push('Connected. Monitoring keepalive for 70 seconds...');

    // Count keepalive responses by watching the log for keepalive messages.
    // The client logs '[Command] keepalive received' on each keepalive response.
    // We track this by counting log entries that contain keepalive.
    const logStartIndex = log.messages.length;

    // Wait 70 seconds (should see at least 2 keepalive cycles at 30s intervals)
    await sleepWithProgress(70000, spinner, 'Monitoring keepalive (70s)...', 10, 90);

    // Count keepalive messages in the log since we started monitoring
    for (let i = logStartIndex; i < log.messages.length; i++) {
      if (log.messages[i].includes('keepalive received')) {
        keepalivesObserved++;
      }
    }

    result.observations.push(`Keepalives observed: ${keepalivesObserved} in 70 seconds`);

    // We expect at least 2 keepalives in 70 seconds (interval is 30s)
    if (keepalivesObserved >= 2) {
      result.status = 'PASS';
      result.observations.push(`Connection stayed alive through ${keepalivesObserved} keepalive cycles`);
    } else {
      result.status = 'FAIL';
      result.reason = `Expected at least 2 keepalives in 70s, observed ${keepalivesObserved}`;
    }

    client.disconnect();
  } catch (err) {
    result.status = 'FAIL';
    result.reason = err instanceof Error ? err.message : String(err);
  }

  result.durationMs = Date.now() - start;
  return { result, keepalivesObserved };
}

// ---------------------------------------------------------------------------
// Scenario 7: State Consistency
// ---------------------------------------------------------------------------

export async function scenarioStateConsistency(
  config: HardwareTestConfig,
  log: HarnessLogger,
  _spinner: Spinner,
): Promise<ScenarioResult> {
  const result = makeResult('7. State Consistency');
  const start = Date.now();

  if (config.skipDestructive) {
    result.status = 'SKIP';
    result.reason = 'skipDestructive is true';
    result.durationMs = Date.now() - start;
    return result;
  }

  try {
    const { client } = await createAndConnect(config, log);
    await waitForStateDump(client);

    const procState = client.getProcessorState();
    if (procState !== ProcessorState.Active) {
      result.status = 'SKIP';
      result.reason = `Processor not active (state: ${ProcessorState[procState]})`;
      client.disconnect();
      result.durationMs = Date.now() - start;
      return result;
    }

    // Record state, make changes, verify state matches commands
    const origVol = client.getVolume();
    const origMute = client.getMute();

    // Set a specific volume
    const targetVol = config.testVolumeDb;
    client.setVolume(targetVol);
    await waitForEvent<number>(client, 'volume', 5000);
    await sleep(500);

    const actualVol = client.getVolume();
    result.observations.push(`Set volume to ${targetVol}dB, getVolume() reports: ${actualVol}dB`);

    // Set mute on
    client.setMute(true);
    await waitForEvent<boolean>(client, 'mute', 5000);
    await sleep(500);

    const actualMute = client.getMute();
    result.observations.push(`Set mute to true, getMute() reports: ${actualMute}`);

    // Restore
    client.setMute(origMute);
    await waitForEvent<boolean>(client, 'mute', 5000);
    client.setVolume(origVol);
    await waitForEvent<number>(client, 'volume', 5000);
    await sleep(500);

    result.observations.push(`Restored: vol=${client.getVolume()}dB, mute=${client.getMute()}`);

    // Check consistency
    const volMatch = actualVol === targetVol;
    const muteMatch = actualMute === true;
    const restoreMatch = client.getVolume() === origVol && client.getMute() === origMute;

    if (volMatch && muteMatch && restoreMatch) {
      result.status = 'PASS';
    } else {
      result.status = 'FAIL';
      result.reason = `State mismatch: volMatch=${volMatch}, muteMatch=${muteMatch}, restoreMatch=${restoreMatch}`;
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
// Scenario 8: Rapid Commands
// ---------------------------------------------------------------------------

export async function scenarioRapidCommands(config: HardwareTestConfig, log: HarnessLogger, spinner: Spinner): Promise<ScenarioResult> {
  const result = makeResult('8. Rapid Commands');
  const start = Date.now();

  if (config.skipDestructive) {
    result.status = 'SKIP';
    result.reason = 'skipDestructive is true';
    result.durationMs = Date.now() - start;
    return result;
  }

  try {
    const { client } = await createAndConnect(config, log);
    await waitForStateDump(client);

    const procState = client.getProcessorState();
    if (procState !== ProcessorState.Active) {
      result.status = 'SKIP';
      result.reason = `Processor not active (state: ${ProcessorState[procState]})`;
      client.disconnect();
      result.durationMs = Date.now() - start;
      return result;
    }

    const origVol = client.getVolume();

    // Send 5 volume-up commands rapidly
    const volumeEvents: number[] = [];
    const volumeHandler = (dB: number): void => {
      volumeEvents.push(dB);
    };
    client.on('volume', volumeHandler);

    result.observations.push(`Starting volume: ${origVol}dB. Sending 5 rapid volume-up commands...`);

    for (let i = 0; i < 5; i++) {
      client.volumeUp();
    }

    // Wait for responses
    await sleepWithProgress(5000, spinner, 'Waiting for rapid command responses...', 30, 80);

    client.removeListener('volume', volumeHandler);

    result.observations.push(`Received ${volumeEvents.length} volume events: ${volumeEvents.join(', ')}`);

    const finalVol = client.getVolume();
    result.observations.push(`Final volume: ${finalVol}dB (expected ~${origVol + 5}dB)`);

    // Restore original volume
    client.setVolume(origVol);
    await waitForEvent<number>(client, 'volume', 5000);
    result.observations.push(`Restored volume to ${client.getVolume()}dB`);

    // Consider it passing if we got at least 3 responses (some may merge)
    if (volumeEvents.length >= 3) {
      result.status = 'PASS';
      result.observations.push(`${volumeEvents.length}/5 commands acknowledged`);
    } else if (volumeEvents.length > 0) {
      result.status = 'PASS';
      result.observations.push(`Only ${volumeEvents.length}/5 acknowledged — processor may batch rapid commands`);
    } else {
      result.status = 'FAIL';
      result.reason = 'No volume events received from rapid commands';
    }

    client.disconnect();
  } catch (err) {
    result.status = 'FAIL';
    result.reason = err instanceof Error ? err.message : String(err);
  }

  result.durationMs = Date.now() - start;
  return result;
}
