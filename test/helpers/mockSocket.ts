import { EventEmitter } from 'events';
import type * as net from 'net';

export class MockSocket extends EventEmitter {
  written: string[] = [];
  destroyed = false;

  write(data: string | Buffer): boolean {
    this.written.push(typeof data === 'string' ? data : data.toString());
    return true;
  }

  destroy(err?: Error): void {
    this.destroyed = true;
    if (err) {
      this.emit('error', err);
    }
    this.emit('close');
  }

  // No-op stub so socket.setTimeout(ms) and socket.setTimeout(0) don't throw.
  // Tests that need to verify timeout behavior use simulateTimeout() directly.
  setTimeout(_ms: number): this {
    return this;
  }

  simulateData(raw: string): void {
    this.emit('data', Buffer.from(raw));
  }

  simulateConnect(): void {
    this.emit('connect');
  }

  simulateError(err: Error): void {
    this.emit('error', err);
  }

  simulateClose(): void {
    this.emit('close');
  }

  // Fires the 'timeout' event, mimicking Node's socket.setTimeout() firing.
  simulateTimeout(): void {
    this.emit('timeout');
  }
}

// Type alias for casting in tests
export type MockSocketAsNet = MockSocket & net.Socket;
