/**
 * Test state-modifying commands: send each, capture response, restore original value.
 * Each test pair has a 1.5s gap to capture any cascade broadcasts.
 */

import * as net from 'net';

const host = process.argv[2];
const port = parseInt(process.argv[3], 10);

if (!host || isNaN(port)) {
  console.error('Usage: npx ts-node scripts/test-modifiers.ts <host> <port>');
  process.exit(1);
}

function ts(): string {
  return new Date().toISOString();
}

// Each test: [label, set_command, restore_command]
const TESTS: [string, string, string][] = [
  // --- Toggles (on/off) ---
  ['dim toggle', 'ssp.dim.on', 'ssp.dim.off'],
  ['cspread toggle', 'ssp.cspread.on', 'ssp.cspread.off'],
  ['dialognorm toggle', 'ssp.dialognorm.on', 'ssp.dialognorm.off'],
  ['lfedim toggle', 'ssp.lfedim.on', 'ssp.lfedim.off'],
  ['mute toggle', 'ssp.mute.on', 'ssp.mute.off'],
  ['dolbyvirtualizer toggle', 'ssp.dolbyvirtualizer.on', 'ssp.dolbyvirtualizer.off'],
  ['stormxt toggle', 'ssp.stormxt.on', 'ssp.stormxt.off'],

  // --- 3-value toggles (on/off/auto) ---
  ['drc on', 'ssp.drc.on', 'ssp.drc.off'],
  ['drc auto', 'ssp.drc.auto', 'ssp.drc.off'],
  ['IMAXMode on', 'ssp.IMAXMode.on', 'ssp.IMAXMode.auto'],
  ['IMAXMode off', 'ssp.IMAXMode.off', 'ssp.IMAXMode.auto'],

  // --- Numeric ranges (set +1 then restore) ---
  ['bass +1', 'ssp.bass.[1]', 'ssp.bass.[0]'],
  ['treble +1', 'ssp.treble.[1]', 'ssp.treble.[0]'],
  ['c_en +1', 'ssp.c_en.[1]', 'ssp.c_en.[0]'],
  ['s_en +1', 'ssp.s_en.[1]', 'ssp.s_en.[0]'],
  ['lfe_en +1', 'ssp.lfe_en.[1]', 'ssp.lfe_en.[0]'],
  ['loudness 1', 'ssp.loudness.[1]', 'ssp.loudness.[0]'],
  ['brightness +1', 'ssp.brightness.[1]', 'ssp.brightness.[0]'],
  ['dolbymode 1', 'ssp.dolbymode.[1]', 'ssp.dolbymode.[0]'],
  ['aurostrength 10', 'ssp.aurostrength.[10]', 'ssp.aurostrength.[15]'],
  ['lipsync 10', 'ssp.lipsync.[10]', 'ssp.lipsync.[0]'],
  ['auropreset 1', 'ssp.auropreset.[1]', 'ssp.auropreset.[2]'],

  // --- Relative volume ---
  ['vol up', 'ssp.vol.up', 'ssp.vol.down'],

  // --- Input switch (watch for cascade: stream/format/hdmi changes) ---
  ['input switch to 5', 'ssp.input.[5]', 'ssp.input.[4]'],

  // --- Preset switch ---
  ['preset switch to 10', 'ssp.preset.[10]', 'ssp.preset.[9]'],

  // --- Surround mode ---
  ['surroundmode 1', 'ssp.surroundmode.[1]', 'ssp.surroundmode.[0]'],

  // --- Trigger manual toggle ---
  ['trig1 manual on', 'ssp.trig1.manual.on', 'ssp.trig1.manual.off'],
];

let buffer = '';
let skipInitialDump = true;

const socket = net.createConnection({ host, port }, () => {
  console.log(`[${ts()}] INFO: Connected to ${host}:${port}`);
  console.log(`[${ts()}] INFO: Skipping initial dump, starting tests in 4s...`);
  console.log(`[${ts()}] INFO: ${TESTS.length} test pairs to run\n`);

  // Skip initial dump then run tests
  setTimeout(() => {
    skipInitialDump = false;
    runTests(0);
  }, 4000);
});

socket.on('data', (data: Buffer) => {
  buffer += data.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !skipInitialDump) {
      console.log(`[${ts()}]   RECV: ${trimmed}`);
    }
  }
});

socket.on('error', (err: Error) => {
  console.error(`[${ts()}] ERROR: ${err.message}`);
  process.exit(1);
});

socket.on('close', () => {
  console.log(`[${ts()}] INFO: Connection closed.`);
  process.exit(0);
});

function runTests(index: number): void {
  if (index >= TESTS.length) {
    console.log(`\n[${ts()}] INFO: All tests complete. Disconnecting.`);
    socket.write('ssp.close\n');
    setTimeout(() => {
      socket.destroy();
      process.exit(0);
    }, 1000);
    return;
  }

  const [label, setCmd, restoreCmd] = TESTS[index];
  console.log(`\n[${ts()}] TEST ${index + 1}/${TESTS.length}: ${label}`);
  console.log(`[${ts()}]   SEND: ${setCmd}`);
  socket.write(setCmd + '\n');

  // Wait for response + any cascades, then restore
  setTimeout(() => {
    console.log(`[${ts()}]   SEND (restore): ${restoreCmd}`);
    socket.write(restoreCmd + '\n');

    // Wait for restore response, then next test
    setTimeout(() => {
      runTests(index + 1);
    }, 1500);
  }, 1500);
}
