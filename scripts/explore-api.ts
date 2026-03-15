/**
 * StormAudio ISP API Explorer
 *
 * Diagnostic tool for live TCP exploration of the StormAudio ISP API.
 * Connects to the processor, logs all incoming data verbatim with timestamps,
 * and accepts commands from stdin.
 *
 * Usage: npx ts-node scripts/explore-api.ts <host> <port>
 *   e.g. npx ts-node scripts/explore-api.ts 192.168.1.100 4999
 *
 * Commands:
 *   Type any ssp.* command and press Enter to send it
 *   Type "quit" or press Ctrl+C to disconnect and exit
 *   Type "dump" to re-request a full state dump (sends common query commands)
 */

import * as net from 'net';
import * as readline from 'readline';

const host = process.argv[2];
const port = parseInt(process.argv[3], 10);

if (!host || isNaN(port)) {
  console.error('Usage: npx ts-node scripts/explore-api.ts <host> <port>');
  process.exit(1);
}

function timestamp(): string {
  return new Date().toISOString();
}

function logRecv(line: string): void {
  console.log(`[${timestamp()}] RECV: ${line}`);
}

function logSend(cmd: string): void {
  console.log(`[${timestamp()}] SEND: ${cmd}`);
}

function logInfo(msg: string): void {
  console.log(`[${timestamp()}] INFO: ${msg}`);
}

// Full state dump: query commands that request current state without modifying anything
const DUMP_COMMANDS = [
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

const socket = net.createConnection({ host, port }, () => {
  logInfo(`Connected to ${host}:${port}`);
  logInfo('Capturing initial state dump... Type commands or "dump" for full query, "quit" to exit.');
});

socket.on('data', (data: Buffer) => {
  buffer += data.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) {
      logRecv(trimmed);
    }
  }
});

socket.on('error', (err: Error) => {
  logInfo(`Connection error: ${err.message}`);
  process.exit(1);
});

socket.on('close', () => {
  logInfo('Connection closed.');
  process.exit(0);
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '> ',
});

rl.on('line', (line: string) => {
  const cmd = line.trim();
  if (!cmd) {
    rl.prompt();
    return;
  }

  if (cmd === 'quit') {
    logInfo('Disconnecting...');
    socket.write('ssp.close\n');
    socket.destroy();
    rl.close();
    return;
  }

  if (cmd === 'dump') {
    logInfo(`Sending ${DUMP_COMMANDS.length} query commands...`);
    for (const q of DUMP_COMMANDS) {
      logSend(q);
      socket.write(q + '\n');
    }
    rl.prompt();
    return;
  }

  logSend(cmd);
  socket.write(cmd + '\n');
  rl.prompt();
});

rl.on('close', () => {
  socket.destroy();
  process.exit(0);
});

rl.prompt();
