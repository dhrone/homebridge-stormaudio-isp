/**
 * Non-interactive capture: connect, grab initial state dump,
 * then send all read-only query commands and log everything.
 * Output goes to stdout — redirect to a file to save.
 *
 * Usage: npx ts-node scripts/capture-dump.ts <host> <port> [wait_seconds]
 */

import * as net from 'net';

const host = process.argv[2];
const port = parseInt(process.argv[3], 10);
const waitMs = (parseInt(process.argv[4], 10) || 10) * 1000;

if (!host || isNaN(port)) {
  console.error('Usage: npx ts-node scripts/capture-dump.ts <host> <port> [wait_seconds]');
  process.exit(1);
}

function ts(): string {
  return new Date().toISOString();
}

const QUERY_COMMANDS = [
  'ssp.version',
  'ssp.brand',
  'ssp.model',
  'ssp.procstate',
  'ssp.power',
  'ssp.vol',
  'ssp.mute',
  'ssp.input',
  'ssp.input.list',
  'ssp.preset',
  'ssp.preset.list',
  'ssp.surroundmode',
  'ssp.surroundmode.list',
  'ssp.allowedmode',
  'ssp.speaker',
  'ssp.stream',
  'ssp.fs',
  'ssp.format',
  'ssp.dim',
  'ssp.loudness',
  'ssp.bass',
  'ssp.treble',
  'ssp.brightness',
  'ssp.c_en',
  'ssp.s_en',
  'ssp.lfe_en',
  'ssp.lipsync',
  'ssp.drc',
  'ssp.cspread',
  'ssp.dialogcontrol',
  'ssp.dialognorm',
  'ssp.IMAXMode',
  'ssp.stormxt',
  'ssp.dolbymode',
  'ssp.dolbyvirtualizer',
  'ssp.sphereaudioeffect',
  'ssp.lfedim',
  'ssp.aurostrength',
  'ssp.auropreset',
  'ssp.auropreset.list',
  'ssp.zones.list',
  'ssp.zones.profiles.list',
  'ssp.hdmi1.input',
  'ssp.hdmi1.sync',
  'ssp.hdmi1.timing',
  'ssp.hdmi1.hdr',
  'ssp.hdmi1.cp',
  'ssp.hdmi1.colorspace',
  'ssp.hdmi1.colordepth',
  'ssp.hdmi1.mode',
  'ssp.hdmi2.input',
  'ssp.hdmi2.sync',
  'ssp.hdmi2.timing',
  'ssp.hdmi2.hdr',
  'ssp.hdmi2.cp',
  'ssp.hdmi2.colorspace',
  'ssp.hdmi2.colordepth',
  'ssp.hdmi2.mode',
  'ssp.trigger.list',
  'ssp.frontpanel.color',
  'ssp.frontpanel.stbybright',
  'ssp.frontpanel.actbright',
  'ssp.frontpanel.stbytime',
  'ssp.msgstatus',
  'ssp.inputZone2',
  'ssp.inputHdmiMatrixMode',
];

let buffer = '';
let phase = 'initial-dump';

const socket = net.createConnection({ host, port }, () => {
  console.log(`[${ts()}] INFO: Connected to ${host}:${port}`);
  console.log(`[${ts()}] INFO: Phase 1 — capturing initial state dump for 5s...`);

  // Wait 5s for initial dump, then send queries
  setTimeout(() => {
    phase = 'query';
    console.log(`\n[${ts()}] INFO: Phase 2 — sending ${QUERY_COMMANDS.length} query commands...`);
    for (const cmd of QUERY_COMMANDS) {
      console.log(`[${ts()}] SEND: ${cmd}`);
      socket.write(cmd + '\n');
    }

    // Wait for responses then disconnect
    console.log(`[${ts()}] INFO: Waiting ${waitMs / 1000}s for responses...`);
    setTimeout(() => {
      console.log(`\n[${ts()}] INFO: Capture complete. Disconnecting.`);
      socket.write('ssp.close\n');
      socket.destroy();
      process.exit(0);
    }, waitMs);
  }, 5000);
});

socket.on('data', (data: Buffer) => {
  buffer += data.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) {
      console.log(`[${ts()}] RECV [${phase}]: ${trimmed}`);
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
