import { EventEmitter } from 'events';
import * as net from 'net';

import { ErrorCategory, ProcessorState } from './types';
import type { StormAudioConfig, StormAudioError, StormAudioEvents, StormAudioState } from './types';

interface Logger {
  info(message: string, ...parameters: unknown[]): void;
  warn(message: string, ...parameters: unknown[]): void;
  error(message: string, ...parameters: unknown[]): void;
  debug(message: string, ...parameters: unknown[]): void;
}

type SocketFactory = (host: string, port: number) => net.Socket;

const defaultSocketFactory: SocketFactory = (host, port) =>
  net.createConnection({ host, port });

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class StormAudioClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private connected = false;
  private buffer = '';
  private readonly state: StormAudioState = {
    power: false,
    volume: -40,
    mute: false,
    input: 0,
    processorState: ProcessorState.Sleep,
  };

  constructor(
    private readonly config: StormAudioConfig,
    private readonly log: Logger,
    private readonly socketFactory: SocketFactory = defaultSocketFactory,
  ) {
    super();
  }

  connect(): void {
    const host = this.config.host;
    const port = this.config.port;

    this.socket = this.socketFactory(host, port);

    this.socket.on('connect', () => {
      this.connected = true;
      this.log.info(`[TCP] Connected to ${host}:${port}`);
      this.emit('connected');
    });

    this.socket.on('data', (data: Buffer) => {
      this.onData(data);
    });

    this.socket.on('error', (err: Error) => {
      this.connected = false;
      this.log.error(
        `[TCP] Could not connect to StormAudio at ${host}:${port}. Verify the IP address and that the processor is powered on.`,
      );
      const stormError: StormAudioError = {
        category: ErrorCategory.Recoverable,
        message: err.message,
        originalError: err,
      };
      this.emit('error', stormError);
    });

    this.socket.on('close', () => {
      this.connected = false;
      this.emit('disconnected');
    });
  }

  disconnect(): void {
    if (this.socket) {
      if (this.connected) {
        this.socket.write('ssp.close\n');
      }
      this.connected = false;
      this.socket.destroy();
      this.socket = null;
    }
  }

  setPower(on: boolean): void {
    this.sendCommand(on ? 'ssp.power.on\n' : 'ssp.power.off\n');
  }

  setVolume(dB: number): void {
    this.sendCommand(`ssp.vol.${dB}\n`);
  }

  setInput(id: number): void {
    this.sendCommand(`ssp.input.${id}\n`);
  }

  setMute(muted: boolean): void {
    this.sendCommand(muted ? 'ssp.mute.on\n' : 'ssp.mute.off\n');
  }

  private sendCommand(command: string): void {
    if (!this.socket || !this.connected) {
      this.log.warn(`[Command] Cannot send ${command.trim()}: not connected`);
      return;
    }
    this.log.debug(`[Command] Sent: ${command.trim()}`);
    this.socket.write(command);
  }

  private onData(data: Buffer): void {
    this.buffer += data.toString();
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        this.parseMessage(trimmed);
      }
    }
  }

  private parseMessage(message: string): void {
    const parts = message.split('.');
    if (parts.length < 3 || parts[0] !== 'ssp') {
      this.log.debug('[Command] Unrecognized message: ' + message);
      return;
    }

    const category = parts[1];
    const value = parts.slice(2).join('.');

    switch (category) {
      case 'power':
        if (value === 'on' || value === 'off') {
          this.state.power = value === 'on';
          this.emit('power', this.state.power);
        } else {
          this.log.debug('[Command] Unrecognized message: ' + message);
        }
        break;
      case 'vol': {
        const dB = parseInt(value, 10);
        if (!isNaN(dB)) {
          this.state.volume = dB;
          this.emit('volume', dB);
        } else {
          this.log.debug('[Command] Unrecognized message: ' + message);
        }
        break;
      }
      case 'mute':
        if (value === 'on' || value === 'off') {
          this.state.mute = value === 'on';
          this.emit('mute', this.state.mute);
        } else {
          this.log.debug('[Command] Unrecognized message: ' + message);
        }
        break;
      case 'input': {
        const inputId = parseInt(value, 10);
        if (!isNaN(inputId)) {
          this.state.input = inputId;
          this.emit('input', inputId);
        } else {
          this.log.debug('[Command] Unrecognized message: ' + message);
        }
        break;
      }
      case 'procstate': {
        const procState = parseInt(value, 10);
        if (procState >= 0 && procState <= 2) {
          this.state.processorState = procState as ProcessorState;
          this.emit('processorState', this.state.processorState);
        } else {
          this.log.debug('[Command] Unrecognized message: ' + message);
        }
        break;
      }
      default:
        this.log.debug('[Command] Unrecognized message: ' + message);
    }
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
