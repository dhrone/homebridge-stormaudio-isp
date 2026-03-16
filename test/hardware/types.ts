/**
 * Types for the hardware integration test harness.
 */

export interface HardwareTestConfig {
  host: string;
  port: number;
  volumeFloor: number;
  volumeCeiling: number;
  /** Specific input ID to switch to during tests. null = auto-detect from input list. */
  testInputId: number | null;
  /** Volume level in dB to use for volume command tests. */
  testVolumeDb: number;
  /** Skip scenarios that change processor state (power, input, volume, mute). */
  skipDestructive: boolean;
  /** Path to write JSON report. null = console only. */
  reportPath: string | null;
}

export type ScenarioStatus = 'PASS' | 'FAIL' | 'SKIP';

export interface ScenarioResult {
  name: string;
  status: ScenarioStatus;
  durationMs: number;
  reason?: string;
  observations: string[];
  unexpectedBroadcasts: string[];
}

export interface ResponseTimeStat {
  command: string;
  roundTripMs: number;
}

export interface HarnessReport {
  timestamp: string;
  config: { host: string; port: number };
  scenarios: ScenarioResult[];
  summary: {
    total: number;
    pass: number;
    fail: number;
    skip: number;
  };
  responseTimeStats: ResponseTimeStat[];
  connectionMetrics: {
    initialConnectMs: number | null;
    reconnectMs: number | null;
    keepalivesObserved: number;
  };
  rawProtocolLog: string[];
}
