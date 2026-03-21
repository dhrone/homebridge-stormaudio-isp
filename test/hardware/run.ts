#!/usr/bin/env npx ts-node
/**
 * Hardware Integration Test Harness
 *
 * Exercises the StormAudioClient against a REAL StormAudio ISP processor.
 * Produces a structured report (console + optional JSON file).
 *
 * Usage:
 *   npm run test:hardware                  # interactive (prompts for confirmation)
 *   npm run test:hardware -- --yes         # skip confirmation prompt
 *   npm run test:hardware -- --scenario 1  # run only scenario 1
 *   npm run test:hardware -- --skip-destructive  # skip tests that change state
 *
 * Configuration:
 *   Set environment variables or create test/hardware/config.json.
 *   See test/hardware/config.example.json for the template.
 *
 * Environment variables (override config.json):
 *   STORM_HOST         - processor IP or hostname (required if no config.json)
 *   STORM_PORT         - TCP port (default: 23)
 *   STORM_VOLUME_FLOOR - volume floor in dB (default: -80)
 *   STORM_VOLUME_CEILING - volume ceiling in dB (default: -20)
 *   STORM_TEST_VOLUME  - dB level for volume tests (default: -60)
 *   STORM_TEST_INPUT   - input ID for input tests (default: auto)
 *   STORM_SKIP_DESTRUCTIVE - set to "true" to skip state-changing tests
 *   STORM_REPORT_PATH  - path for JSON report output
 *   STORM_TEST_PRESET_ID - preset ID for preset command tests (default: skip)
 *   STORM_TEST_TRIGGER_ID - trigger ID (1-4) for trigger command tests (default: skip)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

import { HarnessLogger } from './logger';
import {
  scenarioCommandRoundTrip,
  scenarioConnectionLifecycle,
  scenarioInputListRetrieval,
  scenarioKeepalive,
  scenarioRapidCommands,
  scenarioReconnection,
  scenarioStateConsistency,
  scenarioWakeFromSleep,
} from './scenarios';
import { Spinner } from './spinner';
import type { HardwareTestConfig, HarnessReport, ResponseTimeStat, ScenarioResult } from './types';
import {
  scenarioPresetCommandRoundTrip,
  scenarioPresetListRetrieval,
  scenarioPresetWakeFromSleep,
  scenarioTriggerBidirectionalSync,
  scenarioTriggerCommandRoundTrip,
  scenarioTriggerStateRetrieval,
} from './presetTriggerScenarios';
import {
  scenarioBidirectionalMute,
  scenarioBidirectionalSource,
  scenarioBidirectionalVolume,
  scenarioFollowMain,
  scenarioIndependentSource,
  scenarioInvalidZoneId,
  scenarioSleepZone2Inactive,
  scenarioWakeZone2Restored,
  scenarioZone2InputDetection,
  scenarioZone2MuteCommand,
  scenarioZone2VolumeCommand,
  scenarioZone2VolumeMapping,
  scenarioZoneListParsing,
  scenarioZoneListPersistence,
  scenarioZonePersistenceOnReconnect,
} from './zone2Scenarios';

// ---------------------------------------------------------------------------
// Configuration loading
// ---------------------------------------------------------------------------

function loadConfig(): HardwareTestConfig {
  const configPath = path.resolve(__dirname, 'config.json');
  let fileConfig: Partial<HardwareTestConfig> = {};

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      fileConfig = JSON.parse(raw) as Partial<HardwareTestConfig>;
      console.log(`Loaded config from ${configPath}`);
    } catch (err) {
      console.warn(`Failed to parse ${configPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const config: HardwareTestConfig = {
    host: process.env.STORM_HOST ?? fileConfig.host ?? '',
    port: parseInt(process.env.STORM_PORT ?? '', 10) || (fileConfig.port ?? 23),
    volumeFloor: parseFloat(process.env.STORM_VOLUME_FLOOR ?? '') || (fileConfig.volumeFloor ?? -80),
    volumeCeiling: parseFloat(process.env.STORM_VOLUME_CEILING ?? '') || (fileConfig.volumeCeiling ?? -20),
    testInputId:
      process.env.STORM_TEST_INPUT !== undefined
        ? parseInt(process.env.STORM_TEST_INPUT, 10)
        : (fileConfig.testInputId ?? null),
    testVolumeDb: parseFloat(process.env.STORM_TEST_VOLUME ?? '') || (fileConfig.testVolumeDb ?? -60),
    skipDestructive: process.env.STORM_SKIP_DESTRUCTIVE === 'true' || fileConfig.skipDestructive === true,
    reportPath: process.env.STORM_REPORT_PATH ?? fileConfig.reportPath ?? null,
    zone2ZoneId:
      process.env.STORM_ZONE2_ZONE_ID !== undefined
        ? parseInt(process.env.STORM_ZONE2_ZONE_ID, 10)
        : (fileConfig.zone2ZoneId ?? null),
    testZone2InputId:
      process.env.STORM_ZONE2_INPUT_ID !== undefined
        ? parseInt(process.env.STORM_ZONE2_INPUT_ID, 10)
        : (fileConfig.testZone2InputId ?? null),
    zone2VolumeFloor:
      parseFloat(process.env.STORM_ZONE2_VOLUME_FLOOR ?? '') || (fileConfig.zone2VolumeFloor ?? -80),
    zone2VolumeCeiling:
      parseFloat(process.env.STORM_ZONE2_VOLUME_CEILING ?? '') || (fileConfig.zone2VolumeCeiling ?? -20),
    testPresetId:
      process.env.STORM_TEST_PRESET_ID !== undefined
        ? parseInt(process.env.STORM_TEST_PRESET_ID, 10)
        : (fileConfig.testPresetId ?? null),
    testTriggerId:
      process.env.STORM_TEST_TRIGGER_ID !== undefined
        ? parseInt(process.env.STORM_TEST_TRIGGER_ID, 10)
        : (fileConfig.testTriggerId ?? null),
  };

  if (!config.host) {
    console.error(
      'ERROR: No host configured.\n' +
        'Set STORM_HOST environment variable or create test/hardware/config.json.\n' +
        'See test/hardware/config.example.json for the template.',
    );
    process.exit(1);
  }

  return config;
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface CliOptions {
  yes: boolean;
  scenario: number | null;
  skipDestructive: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    yes: false,
    scenario: null,
    skipDestructive: false,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--yes' || args[i] === '-y') {
      options.yes = true;
    } else if (args[i] === '--scenario' || args[i] === '-s') {
      const next = args[++i];
      if (next !== undefined) {
        options.scenario = parseInt(next, 10);
      }
    } else if (args[i] === '--skip-destructive') {
      options.skipDestructive = true;
    }
  }

  return options;
}

// ---------------------------------------------------------------------------
// Confirmation prompt
// ---------------------------------------------------------------------------

async function confirmRun(config: HardwareTestConfig): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    console.log('\n========================================');
    console.log(' Hardware Integration Test Harness');
    console.log('========================================');
    console.log(`Target:  ${config.host}:${config.port}`);
    console.log(`Volume:  floor=${config.volumeFloor}dB, ceiling=${config.volumeCeiling}dB`);
    console.log(`Test vol: ${config.testVolumeDb}dB`);
    console.log(
      `Zone 2:  ${config.zone2ZoneId !== null ? `zoneId=${config.zone2ZoneId}, floor=${config.zone2VolumeFloor}dB, ceiling=${config.zone2VolumeCeiling}dB` : 'DISABLED (no zone2ZoneId)'}`,
    );
    console.log(
      `Presets: ${config.testPresetId !== null ? `testPresetId=${config.testPresetId}` : 'SKIP command tests (no testPresetId)'}`,
    );
    console.log(
      `Triggers: ${config.testTriggerId !== null ? `testTriggerId=${config.testTriggerId}` : 'SKIP command tests (no testTriggerId)'}`,
    );
    console.log(`Destructive tests: ${config.skipDestructive ? 'SKIPPED' : 'ENABLED'}`);
    console.log('');
    console.log('This harness will connect to a REAL StormAudio processor and');
    console.log('send commands including power on/off, volume changes, mute,');
    console.log('and input switching. State will be restored after each test.');
    console.log('');

    rl.question('Proceed? [y/N] ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

// ---------------------------------------------------------------------------
// Report formatting
// ---------------------------------------------------------------------------

function printReport(report: HarnessReport): void {
  console.log('\n');
  console.log('================================================================');
  console.log('  HARDWARE INTEGRATION TEST REPORT');
  console.log(`  ${report.timestamp}`);
  console.log(`  Target: ${report.config.host}:${report.config.port}`);
  console.log('================================================================');
  console.log('');

  for (const scenario of report.scenarios) {
    const statusIcon = scenario.status === 'PASS' ? '[PASS]' : scenario.status === 'FAIL' ? '[FAIL]' : '[SKIP]';
    console.log(`${statusIcon} ${scenario.name} (${scenario.durationMs}ms)`);

    if (scenario.reason) {
      console.log(`       Reason: ${scenario.reason}`);
    }

    for (const obs of scenario.observations) {
      console.log(`       ${obs}`);
    }

    if (scenario.unexpectedBroadcasts.length > 0) {
      console.log(`       Unexpected broadcasts: ${scenario.unexpectedBroadcasts.length}`);
      for (const b of scenario.unexpectedBroadcasts) {
        console.log(`         ${b}`);
      }
    }

    console.log('');
  }

  // Summary
  console.log('----------------------------------------------------------------');
  console.log(
    `  SUMMARY: ${report.summary.pass} pass, ${report.summary.fail} fail, ${report.summary.skip} skip (${report.summary.total} total)`,
  );
  console.log('----------------------------------------------------------------');

  // Connection metrics
  console.log('');
  console.log('  Connection Metrics:');
  if (report.connectionMetrics.initialConnectMs !== null) {
    console.log(`    Initial connect: ${report.connectionMetrics.initialConnectMs}ms`);
  }
  if (report.connectionMetrics.reconnectMs !== null) {
    console.log(`    Reconnect: ${report.connectionMetrics.reconnectMs}ms`);
  }
  console.log(`    Keepalives observed: ${report.connectionMetrics.keepalivesObserved}`);

  // Response time stats
  if (report.responseTimeStats.length > 0) {
    console.log('');
    console.log('  Response Times:');
    for (const stat of report.responseTimeStats) {
      console.log(`    ${stat.command}: ${stat.roundTripMs}ms`);
    }
  }

  console.log('');
  console.log(`  Raw protocol log: ${report.rawProtocolLog.length} entries`);
  console.log('================================================================');
}

function writeJsonReport(report: HarnessReport, reportPath: string): void {
  const resolvedPath = path.resolve(reportPath);
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(resolvedPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\nJSON report written to: ${resolvedPath}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const options = parseArgs();
  const config = loadConfig();

  if (options.skipDestructive) {
    config.skipDestructive = true;
  }

  // Confirmation prompt (unless --yes)
  if (!options.yes) {
    const confirmed = await confirmRun(config);
    if (!confirmed) {
      console.log('Aborted.');
      process.exit(0);
    }
  }

  console.log('\nStarting hardware integration tests...\n');

  const log = new HarnessLogger();
  const allResults: ScenarioResult[] = [];
  const allResponseStats: ResponseTimeStat[] = [];
  let initialConnectMs: number | null = null;
  let reconnectMs: number | null = null;
  let keepalivesObserved = 0;

  const spinner = new Spinner();

  // Define scenario registry
  const scenarioRunners: Array<{
    id: number;
    name: string;
    run: () => Promise<void>;
  }> = [
    {
      id: 1,
      name: 'Connection Lifecycle',
      run: async () => {
        const { result, connectMs } = await scenarioConnectionLifecycle(config, log, spinner);
        allResults.push(result);
        initialConnectMs = connectMs;
      },
    },
    {
      id: 2,
      name: 'Command Round-Trip',
      run: async () => {
        const { result, responseStats } = await scenarioCommandRoundTrip(config, log, spinner);
        allResults.push(result);
        allResponseStats.push(...responseStats);
      },
    },
    {
      id: 3,
      name: 'Input List Retrieval',
      run: async () => {
        const result = await scenarioInputListRetrieval(config, log, spinner);
        allResults.push(result);
      },
    },
    {
      id: 4,
      name: 'Wake from Sleep',
      run: async () => {
        const result = await scenarioWakeFromSleep(config, log, spinner);
        allResults.push(result);
      },
    },
    {
      id: 5,
      name: 'Reconnection',
      run: async () => {
        const { result, reconnectMs: rMs } = await scenarioReconnection(config, log, spinner);
        allResults.push(result);
        reconnectMs = rMs;
      },
    },
    {
      id: 6,
      name: 'Keepalive',
      run: async () => {
        const { result, keepalivesObserved: k } = await scenarioKeepalive(config, log, spinner);
        allResults.push(result);
        keepalivesObserved = k;
      },
    },
    {
      id: 7,
      name: 'State Consistency',
      run: async () => {
        const result = await scenarioStateConsistency(config, log, spinner);
        allResults.push(result);
      },
    },
    {
      id: 8,
      name: 'Rapid Commands',
      run: async () => {
        const result = await scenarioRapidCommands(config, log, spinner);
        allResults.push(result);
      },
    },

    // --- Zone 2 scenarios (A1-A15 from Epic 5 smoke test) ---

    {
      id: 9,
      name: 'Zone List Parsing (A1)',
      run: async () => {
        const result = await scenarioZoneListParsing(config, log, spinner);
        allResults.push(result);
      },
    },
    {
      id: 10,
      name: 'Zone 2 Mute Command (A2)',
      run: async () => {
        const { result, responseStats } = await scenarioZone2MuteCommand(config, log, spinner);
        allResults.push(result);
        allResponseStats.push(...responseStats);
      },
    },
    {
      id: 11,
      name: 'Zone 2 Volume Command (A3)',
      run: async () => {
        const { result, responseStats } = await scenarioZone2VolumeCommand(config, log, spinner);
        allResults.push(result);
        allResponseStats.push(...responseStats);
      },
    },
    {
      id: 12,
      name: 'Zone 2 Volume Mapping (A4)',
      run: async () => {
        const result = await scenarioZone2VolumeMapping(config, log, spinner);
        allResults.push(result);
      },
    },
    {
      id: 13,
      name: 'Follow Main Command (A5)',
      run: async () => {
        const result = await scenarioFollowMain(config, log, spinner);
        allResults.push(result);
      },
    },
    {
      id: 14,
      name: 'Independent Source (A6)',
      run: async () => {
        const result = await scenarioIndependentSource(config, log, spinner);
        allResults.push(result);
      },
    },
    {
      id: 15,
      name: 'Bidirectional Sync — Mute (A7)',
      run: async () => {
        const result = await scenarioBidirectionalMute(config, log, spinner);
        allResults.push(result);
      },
    },
    {
      id: 16,
      name: 'Bidirectional Sync — Volume (A8)',
      run: async () => {
        const result = await scenarioBidirectionalVolume(config, log, spinner);
        allResults.push(result);
      },
    },
    {
      id: 17,
      name: 'Bidirectional Sync — Source (A9)',
      run: async () => {
        const result = await scenarioBidirectionalSource(config, log, spinner);
        allResults.push(result);
      },
    },
    {
      id: 18,
      name: 'Zone List Persistence (A10)',
      run: async () => {
        const result = await scenarioZoneListPersistence(config, log, spinner);
        allResults.push(result);
      },
    },
    {
      id: 19,
      name: 'Sleep → Zone 2 Inactive (A11)',
      run: async () => {
        const result = await scenarioSleepZone2Inactive(config, log, spinner);
        allResults.push(result);
      },
    },
    {
      id: 20,
      name: 'Wake → Zone 2 Restored (A12)',
      run: async () => {
        const result = await scenarioWakeZone2Restored(config, log, spinner);
        allResults.push(result);
      },
    },
    {
      id: 21,
      name: 'Invalid Zone ID (A13)',
      run: async () => {
        const result = await scenarioInvalidZoneId(config, log, spinner);
        allResults.push(result);
      },
    },
    {
      id: 22,
      name: 'Zone 2 Input Detection (A14)',
      run: async () => {
        const result = await scenarioZone2InputDetection(config, log, spinner);
        allResults.push(result);
      },
    },
    {
      id: 23,
      name: 'Zone Persistence on Reconnect (A15)',
      run: async () => {
        const result = await scenarioZonePersistenceOnReconnect(config, log, spinner);
        allResults.push(result);
      },
    },

    // --- Preset & Trigger scenarios (P1-P6 from Epic 6 smoke test) ---

    {
      id: 24,
      name: 'Preset List Retrieval (P1)',
      run: async () => {
        const result = await scenarioPresetListRetrieval(config, log, spinner);
        allResults.push(result);
      },
    },
    {
      id: 25,
      name: 'Trigger State Retrieval (P2)',
      run: async () => {
        const result = await scenarioTriggerStateRetrieval(config, log, spinner);
        allResults.push(result);
      },
    },
    {
      id: 26,
      name: 'Preset Command Round-Trip (P3)',
      run: async () => {
        const { result, responseStats } = await scenarioPresetCommandRoundTrip(config, log, spinner);
        allResults.push(result);
        allResponseStats.push(...responseStats);
      },
    },
    {
      id: 27,
      name: 'Preset Wake from Sleep (P4)',
      run: async () => {
        const result = await scenarioPresetWakeFromSleep(config, log, spinner);
        allResults.push(result);
      },
    },
    {
      id: 28,
      name: 'Trigger Command Round-Trip (P5)',
      run: async () => {
        const { result, responseStats } = await scenarioTriggerCommandRoundTrip(config, log, spinner);
        allResults.push(result);
        allResponseStats.push(...responseStats);
      },
    },
    {
      id: 29,
      name: 'Trigger Bidirectional Sync (P6)',
      run: async () => {
        const result = await scenarioTriggerBidirectionalSync(config, log, spinner);
        allResults.push(result);
      },
    },
  ];

  // Filter to specific scenario if requested
  const scenariosToRun =
    options.scenario !== null ? scenarioRunners.filter((s) => s.id === options.scenario) : scenarioRunners;

  if (scenariosToRun.length === 0) {
    console.error(`No scenario found with ID ${options.scenario}`);
    process.exit(1);
  }

  for (let i = 0; i < scenariosToRun.length; i++) {
    const scenario = scenariosToRun[i];
    const basePct = Math.round((i / scenariosToRun.length) * 100);
    const label = `Scenario ${scenario.id}: ${scenario.name}`;

    spinner.start(label, basePct);

    try {
      await scenario.run();
      spinner.stop();

      const lastResult = allResults[allResults.length - 1];
      const icon = lastResult.status === 'PASS' ? '[PASS]' : lastResult.status === 'FAIL' ? '[FAIL]' : '[SKIP]';
      console.log(`${icon} ${label} (${lastResult.durationMs}ms)`);
    } catch (err) {
      spinner.stop();
      console.log(`[FAIL] ${label} (crashed)`);
      console.error(`  ${err instanceof Error ? err.message : String(err)}`);
      allResults.push({
        name: `${label} (crashed)`,
        status: 'FAIL',
        durationMs: 0,
        reason: err instanceof Error ? err.message : String(err),
        observations: [],
        unexpectedBroadcasts: [],
      });
    }
  }

  // Build report
  const report: HarnessReport = {
    timestamp: new Date().toISOString(),
    config: { host: config.host, port: config.port },
    scenarios: allResults,
    summary: {
      total: allResults.length,
      pass: allResults.filter((r) => r.status === 'PASS').length,
      fail: allResults.filter((r) => r.status === 'FAIL').length,
      skip: allResults.filter((r) => r.status === 'SKIP').length,
    },
    responseTimeStats: allResponseStats,
    connectionMetrics: {
      initialConnectMs,
      reconnectMs,
      keepalivesObserved,
    },
    rawProtocolLog: log.messages,
  };

  printReport(report);

  if (config.reportPath) {
    writeJsonReport(report, config.reportPath);
  }

  // Exit with non-zero if any failures
  if (report.summary.fail > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(2);
});
