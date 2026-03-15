/**
 * Quick capture of additional read-only commands not in the main dump.
 */

import * as net from 'net';

const host = process.argv[2];
const port = parseInt(process.argv[3], 10);

function ts(): string {
  return new Date().toISOString();
}

const EXTRA_COMMANDS = [
  'ssp.keepalive',
  'ssp.osd.info',
  'ssp.display.toggle',
];

let buffer = '';

const socket = net.createConnection({ host, port }, () => {
  console.log(`[${ts()}] INFO: Connected — skipping initial dump, sending extra commands in 3s...`);

  // Skip initial dump
  setTimeout(() => {
    for (const cmd of EXTRA_COMMANDS) {
      console.log(`[${ts()}] SEND: ${cmd}`);
      socket.write(cmd + '\n');
    }

    setTimeout(() => {
      console.log(`[${ts()}] INFO: Done. Disconnecting.`);
      socket.write('ssp.close\n');
      socket.destroy();
      process.exit(0);
    }, 5000);
  }, 3000);
});

socket.on('data', (data: Buffer) => {
  buffer += data.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) {
      console.log(`[${ts()}] RECV: ${trimmed}`);
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
