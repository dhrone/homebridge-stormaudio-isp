import { EventEmitter } from 'events';
import type * as net from 'net';

export class MockSocket extends EventEmitter {
  written: string[] = [];
  destroyed = false;

  write(data: string | Buffer): boolean {
    this.written.push(typeof data === 'string' ? data : data.toString());
    return true;
  }

  destroy(): void {
    this.destroyed = true;
    this.emit('close');
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
}

// Type alias for casting in tests
export type MockSocketAsNet = MockSocket & net.Socket;
