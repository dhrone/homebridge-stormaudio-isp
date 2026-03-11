import { EventEmitter } from 'events';
import type { StormAudioEvents } from './types';

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class StormAudioClient extends EventEmitter {
  connect(): void {
    // TODO: implement in Story 1.2
  }

  disconnect(): void {
    // TODO: implement in Story 1.2
  }

  setPower(_on: boolean): void {
    // TODO: implement in Story 1.2
  }

  setVolume(_dB: number): void {
    // TODO: implement in Story 1.2
  }

  setInput(_id: number): void {
    // TODO: implement in Story 1.2
  }

  setMute(_muted: boolean): void {
    // TODO: implement in Story 1.2
  }
}

// Declaration merging block — typed EventEmitter overloads
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export declare interface StormAudioClient {
  on<K extends keyof StormAudioEvents>(event: K, listener: StormAudioEvents[K]): this;
  emit<K extends keyof StormAudioEvents>(event: K, ...args: Parameters<StormAudioEvents[K]>): boolean;
  once<K extends keyof StormAudioEvents>(event: K, listener: StormAudioEvents[K]): this;
  removeListener<K extends keyof StormAudioEvents>(event: K, listener: StormAudioEvents[K]): this;
}
