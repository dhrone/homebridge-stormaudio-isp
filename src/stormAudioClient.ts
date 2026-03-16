import { EventEmitter } from 'events';
import * as net from 'net';

import {
  KEEPALIVE_INTERVAL_MS,
  KEEPALIVE_TIMEOUT_MS,
  PROCESSOR_WAKE_TIMEOUT_MS,
  RECONNECT_CONNECT_TIMEOUT_MS,
  RECONNECT_INITIAL_DELAY_MS,
  RECONNECT_LONG_POLL_INTERVAL_MS,
  RECONNECT_MAX_DELAY_MS,
  RECONNECT_MAX_RETRIES,
  RECONNECT_MULTIPLIER,
} from './settings';
import { ErrorCategory, ProcessorState } from './types';
import type {
  AudioConfigState, AudioState, DeviceState, HdmiOutputState,
  IdentityInfo, InputInfo, PresetInfo, StormAudioConfig, StormAudioError,
  StormAudioEvents, StormAudioState, StreamInfoState, SurroundModeInfo,
  TriggerInfo, ZoneProfileInfo, ZoneState,
} from './types';

interface Logger {
  info(message: string, ...parameters: unknown[]): void;
  warn(message: string, ...parameters: unknown[]): void;
  error(message: string, ...parameters: unknown[]): void;
  debug(message: string, ...parameters: unknown[]): void;
}

type SocketFactory = (host: string, port: number) => net.Socket;

const defaultSocketFactory: SocketFactory = (host, port) =>
  net.createConnection({ host, port });

// Log prefix convention and level policy:
//   [TCP]     Connection lifecycle     → info (connect/reconnect success, graceful close)
//                                        warn (connection lost, reconnect attempt failed, keepalive timeout)
//                                        error (max retries exhausted, initial connect failure)
//                                        debug (keepalive sent)
//   [Command] Message traffic          → debug (Sent, Received, Cannot send, Unrecognized, Informational)
//                                        warn (Command rejected)
//   [State]   Processor state changes  → info (sleep, initializing, active, waking, input list)
//                                        warn (wake timeout)
//                                        debug (malformed list entry skipped)

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class StormAudioClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private connected = false;
  private buffer = '';
  private pendingInputList: InputInfo[] | null = null;
  private pendingPresetList: PresetInfo[] | null = null;
  private pendingSurroundModeList: SurroundModeInfo[] | null = null;
  private pendingAuroPresetList: PresetInfo[] | null = null;
  private pendingZoneList: ZoneState[] | null = null;
  private pendingZoneProfileList: ZoneProfileInfo[] | null = null;
  private pendingTriggerList: TriggerInfo[] | null = null;
  private wakePromise: Promise<boolean> | null = null;
  private wakeCancel: (() => void) | null = null;
  private reconnecting = false;
  private inLongPoll = false;
  private intentionalDisconnect = false;
  private retryCount = 0;
  private backoffDelay = RECONNECT_INITIAL_DELAY_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private keepaliveInterval: ReturnType<typeof setInterval> | null = null;
  private keepaliveTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly state: StormAudioState = {
    power: false,
    volume: -40,
    mute: false,
    input: 0,
    processorState: ProcessorState.Sleep,
    identity: { version: '', brand: '', model: '' },
    streamInfo: { stream: '', sampleRate: '', format: '' },
    audio: {
      dim: false, loudness: 0, bass: 0, treble: 0,
      centerEnhance: 0, surroundEnhance: 0, lfeEnhance: 0,
      lipsync: 0, drc: 'off', centerSpread: false,
      dialogControl: { available: false, level: 0 },
      dialogNorm: false, imaxMode: 'off', stormxt: null,
      dolbyMode: 0, dolbyVirtualizer: false,
      sphereAudioEffect: null, lfeDim: false, auroStrength: 0,
    },
    device: {
      brightness: 0, generator: false,
      frontPanel: { color: '', standbyBrightness: 0, activeBrightness: 0, standbyTimeout: 0 },
    },
    audioConfig: {
      preset: 0, presetCustom: false, surroundMode: 0, allowedMode: 0,
      speaker: 0, presetList: [], surroundModeList: [],
      auroPreset: 0, auroPresetList: [], inputHdmiPassThru: 0,
    },
    zones: new Map(),
    hdmi: new Map(),
    msgStatus: 0,
    triggerStates: new Map(),
    triggerManual: new Map(),
    zoneProfiles: [],
  };

  constructor(
    private readonly config: StormAudioConfig,
    private readonly log: Logger,
    private readonly socketFactory: SocketFactory = defaultSocketFactory,
  ) {
    super();
  }

  private scheduleReconnect(): void {
    // Idempotency guard — prevents double-scheduling if close fires twice
    if (this.reconnectTimer !== null) {
      return;
    }

    // Max retries exhausted — enter long-poll recovery (every 30s indefinitely)
    if (this.retryCount >= RECONNECT_MAX_RETRIES) {
      if (!this.inLongPoll) {
        this.inLongPoll = true;
        this.log.error(
          '[TCP] Max reconnection retries exhausted. Processor may need reboot. Check network and power cycle the StormAudio.',
        );
        const stormError: StormAudioError = {
          category: ErrorCategory.Fatal,
          message: 'Max reconnection retries exhausted',
        };
        this.emit('error', stormError);
      }
      this.reconnecting = true;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, RECONNECT_LONG_POLL_INTERVAL_MS);
      return;
    }

    this.reconnecting = true;
    this.retryCount++;

    // Clear stale parsing state
    this.buffer = '';
    this.pendingInputList = null;
    this.pendingPresetList = null;
    this.pendingSurroundModeList = null;
    this.pendingAuroPresetList = null;
    this.pendingZoneList = null;
    this.pendingZoneProfileList = null;
    this.pendingTriggerList = null;

    const delay = this.backoffDelay;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);

    // Update backoff for next attempt
    this.backoffDelay = Math.min(this.backoffDelay * RECONNECT_MULTIPLIER, RECONNECT_MAX_DELAY_MS);
  }

  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepaliveInterval = setInterval(() => {
      this.sendCommand('ssp.keepalive\n');
      this.log.debug('[TCP] Keepalive sent');
      this.keepaliveTimeout = setTimeout(() => {
        this.log.warn('[TCP] Keepalive timeout — connection appears stale');
        // Set connected=false and emit 'disconnected' synchronously so HomeKit
        // shows "Not Responding" immediately — before the async 'close' event fires.
        this.connected = false;
        this.emit('disconnected');
        this.socket?.destroy();
      }, KEEPALIVE_TIMEOUT_MS);
    }, KEEPALIVE_INTERVAL_MS);
  }

  private stopKeepalive(): void {
    if (this.keepaliveInterval !== null) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
    }
    if (this.keepaliveTimeout !== null) {
      clearTimeout(this.keepaliveTimeout);
      this.keepaliveTimeout = null;
    }
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnecting = false;
    this.inLongPoll = false;
  }

  private resetBackoff(): void {
    this.retryCount = 0;
    this.backoffDelay = RECONNECT_INITIAL_DELAY_MS;
    this.inLongPoll = false;
  }

  connect(): void {
    const host = this.config.host;
    const port = this.config.port;

    if (this.socket) {
      this.log.warn('[TCP] Already connected or connecting — ignoring duplicate connect()');
      return;
    }

    // On first call (not reconnection), clear intentionalDisconnect
    if (!this.reconnecting) {
      this.intentionalDisconnect = false;
    }

    this.socket = this.socketFactory(host, port);

    // Cap the connect-phase wait so each attempt fails fast instead of waiting
    // for the OS TCP SYN timeout (~2 min). Cleared immediately on success.
    this.socket.setTimeout(RECONNECT_CONNECT_TIMEOUT_MS);
    this.socket.once('timeout', () => { this.socket?.destroy(new Error('Connection timed out')); });

    this.socket.on('connect', () => {
      this.socket?.setTimeout(0); // Disable connect-phase timeout — keepalive owns timing now
      this.connected = true;
      if (this.reconnecting) {
        this.log.info(`[TCP] Reconnected to ${host}:${port}`);
        this.reconnecting = false;
        this.resetBackoff();
      } else {
        this.log.info(`[TCP] Connected to ${host}:${port}`);
      }
      this.emit('connected');
      this.startKeepalive();
    });

    this.socket.on('data', (data: Buffer) => {
      this.onData(data);
    });

    this.socket.on('error', (err: Error) => {
      if (this.wakeCancel) {
        this.wakeCancel();
      }
      if (this.connected) {
        // Active connection dropped
        this.log.warn(`[TCP] Connection lost. Reconnecting...`);
      } else if (this.reconnecting) {
        if (this.inLongPoll) {
          this.log.warn(`[TCP] Processor still unreachable. Will retry in ${RECONNECT_LONG_POLL_INTERVAL_MS / 1000}s.`);
        } else if (this.retryCount >= RECONNECT_MAX_RETRIES) {
          this.log.warn(`[TCP] Reconnection attempt ${this.retryCount}/${RECONNECT_MAX_RETRIES} failed. Reconnection effort has failed.`);
        } else {
          this.log.warn(
            `[TCP] Reconnection attempt ${this.retryCount}/${RECONNECT_MAX_RETRIES} failed. Retrying in ${(this.backoffDelay + RECONNECT_CONNECT_TIMEOUT_MS) / 1000}s.`,
          );
        }
      } else {
        // Initial connection failure
        this.log.error(
          `[TCP] Could not connect to StormAudio at ${host}:${port}. Verify the IP address and that the processor is powered on.`,
        );
        const stormError: StormAudioError = {
          category: ErrorCategory.Recoverable,
          message: err.message,
          originalError: err,
        };
        this.emit('error', stormError);
      }
      // CRITICAL: Do NOT set this.connected = false here — that's the close handler's
      // responsibility. Setting it here would cause wasConnected to always be false in
      // the close handler for active-connection drops.
    });

    this.socket.on('close', () => {
      const wasConnected = this.connected;
      this.connected = false;
      this.socket = null;

      if (this.wakeCancel) {
        this.wakeCancel();
      }

      this.stopKeepalive();

      this.emit('disconnected');

      if (!this.intentionalDisconnect) {
        this.scheduleReconnect();
      }
    });
  }

  disconnect(): void {
    // Suppress reconnection — must be set FIRST
    this.intentionalDisconnect = true;
    this.cancelReconnect();

    // Cancel any pending wake — resolve false before socket teardown.
    if (this.wakeCancel) {
      this.wakeCancel();
    }

    this.stopKeepalive();

    // Reset in-flight parsing state.
    // NOTE: if a new streaming list field is added to this class (e.g. pendingFooList),
    // it must also be reset here to prevent stale-state leaks across reconnections.
    this.buffer = '';
    this.pendingInputList = null;
    this.pendingPresetList = null;
    this.pendingSurroundModeList = null;
    this.pendingAuroPresetList = null;
    this.pendingZoneList = null;
    this.pendingZoneProfileList = null;
    this.pendingTriggerList = null;

    // Tear down socket
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
    this.sendCommand(`ssp.vol.[${dB}]\n`);
  }

  setInput(id: number): void {
    this.sendCommand(`ssp.input.[${id}]\n`);
  }

  setMute(muted: boolean): void {
    this.sendCommand(muted ? 'ssp.mute.on\n' : 'ssp.mute.off\n');
  }

  volumeUp(): void {
    this.sendCommand('ssp.vol.up\n');
  }

  volumeDown(): void {
    this.sendCommand('ssp.vol.down\n');
  }

  getVolume(): number {
    return this.state.volume;
  }

  getMute(): boolean {
    return this.state.mute;
  }

  getProcessorState(): ProcessorState {
    return this.state.processorState;
  }

  getPower(): boolean {
    return this.state.power;
  }

  getInput(): number {
    return this.state.input;
  }

  getIdentity(): IdentityInfo {
    return { ...this.state.identity };
  }

  getStreamInfo(): StreamInfoState {
    return { ...this.state.streamInfo };
  }

  getAudio(): AudioState {
    return { ...this.state.audio };
  }

  getDevice(): DeviceState {
    return { ...this.state.device };
  }

  getAudioConfig(): AudioConfigState {
    return {
      ...this.state.audioConfig,
      presetList: [...this.state.audioConfig.presetList],
      surroundModeList: [...this.state.audioConfig.surroundModeList],
      auroPresetList: [...this.state.audioConfig.auroPresetList],
    };
  }

  getZones(): Map<number, ZoneState> {
    return this.state.zones;
  }

  getHdmi(): Map<number, HdmiOutputState> {
    return this.state.hdmi;
  }

  getZoneProfiles(): ZoneProfileInfo[] {
    return [...this.state.zoneProfiles];
  }

  async ensureActive(timeout = PROCESSOR_WAKE_TIMEOUT_MS): Promise<boolean> {
    if (this.state.processorState === ProcessorState.Active) {
      return true;
    }

    // If a wake is already in progress, piggyback on it — avoids duplicate
    // power-on commands when multiple HomeKit handlers fire simultaneously
    if (this.wakePromise) {
      return this.wakePromise;
    }

    if (this.state.processorState === ProcessorState.Sleep) {
      this.log.info('[State] Waking processor... waiting for active state');
      this.sendCommand('ssp.power.on\n');
    } else {
      this.log.info('[State] Processor initializing... waiting for active state');
    }

    this.wakePromise = new Promise<boolean>((resolve) => {
      let resolved = false;
      // eslint-disable-next-line prefer-const
      let timer!: ReturnType<typeof setTimeout>;

      const onStateChange = (state: ProcessorState): void => {
        if (state === ProcessorState.Active) {
          if (resolved) return;
          resolved = true;
          clearTimeout(timer);
          this.removeListener('processorState', onStateChange);
          this.wakePromise = null;
          this.wakeCancel = null;
          this.log.info('[State] Processor active — ready for commands');
          resolve(true);
        }
      };

      timer = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        this.removeListener('processorState', onStateChange);
        this.wakePromise = null;
        this.wakeCancel = null;
        this.log.warn('[State] Processor did not reach active state within timeout');
        resolve(false);
      }, timeout);

      this.wakeCancel = () => {
        // Guard is load-bearing: disconnect(), error handler, and close handler all
        // call wakeCancel() unconditionally (via `if (this.wakeCancel)`). Without
        // this check, a call arriving after success or timeout (which set resolved=true
        // and cleared this.wakeCancel) would double-resolve the promise. Do not remove.
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        this.removeListener('processorState', onStateChange);
        this.wakePromise = null;
        this.wakeCancel = null;
        resolve(false);
      };

      this.on('processorState', onStateChange);
    });

    return this.wakePromise;
  }

  private sendCommand(command: string): void {
    if (!this.socket || !this.connected) {
      this.log.debug(`[Command] Cannot send ${command.trim()}: not connected`);
      return;
    }
    this.log.debug(`[Command] Sent: ${command.trim()}`);
    this.socket.write(command);
  }

  private onData(data: Buffer): void {
    if (this.keepaliveTimeout !== null) {
      clearTimeout(this.keepaliveTimeout);
      this.keepaliveTimeout = null;
    }
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

  // Lookup maps for audio toggle and numeric categories
  private static readonly AUDIO_TOGGLES: Record<string, keyof AudioState> = {
    dim: 'dim',
    cspread: 'centerSpread',
    dialognorm: 'dialogNorm',
    dolbyvirtualizer: 'dolbyVirtualizer',
    lfedim: 'lfeDim',
  };

  private static readonly AUDIO_THREE_VALUE: Record<string, keyof AudioState> = {
    drc: 'drc',
    IMAXMode: 'imaxMode',
  };

  private static readonly AUDIO_NUMERICS: Record<string, keyof AudioState> = {
    loudness: 'loudness',
    bass: 'bass',
    treble: 'treble',
    c_en: 'centerEnhance',
    s_en: 'surroundEnhance',
    lfe_en: 'lfeEnhance',
    dolbymode: 'dolbyMode',
    aurostrength: 'auroStrength',
  };

  private static readonly HDMI_FIELDS: Record<string, keyof HdmiOutputState> = {
    input: 'input',
    sync: 'sync',
    timing: 'timing',
    hdr: 'hdr',
    cp: 'copyProtection',
    colorspace: 'colorspace',
    colordepth: 'colorDepth',
    mode: 'mode',
  };

  private static readonly ZONE_BOOL_FIELDS: Record<string, keyof ZoneState> = {
    mute: 'mute', useZone2: 'useZone2Source',
  };

  private static readonly ZONE_NUM_FIELDS: Record<string, keyof ZoneState> = {
    volume: 'volume', bass: 'bass', treble: 'treble', eq: 'eq',
    mode: 'mode', lipsync: 'lipsync', loudness: 'loudness',
  };

  private parseMessage(message: string): void {
    this.log.debug('[Command] Received: ' + message);

    if (message === 'error') {
      this.log.warn('[Command] Command rejected by processor (invalid command or out of range)');
      return;
    }

    // Special case: ssp.keepalive has only 2 dot-segments
    if (message === 'ssp.keepalive') {
      this.log.debug('[Command] keepalive received');
      return;
    }

    const parts = message.split('.');
    if (parts.length < 3 || parts[0] !== 'ssp') {
      this.log.debug('[Command] Unrecognized message: ' + message);
      return;
    }

    const category = parts[1];
    const value = parts.slice(2).join('.').replace(/^\[|\]$/g, '');

    // --- Check audio toggle map ---
    if (category in StormAudioClient.AUDIO_TOGGLES) {
      const field = StormAudioClient.AUDIO_TOGGLES[category];
      if (value === 'on' || value === 'off') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.state.audio as any)[field] = value === 'on';
        this.emit('audio', { ...this.state.audio });
      } else {
        this.log.debug('[Command] Unrecognized message: ' + message);
      }
      return;
    }

    // --- Check audio three-value toggle map ---
    if (category in StormAudioClient.AUDIO_THREE_VALUE) {
      const field = StormAudioClient.AUDIO_THREE_VALUE[category];
      if (value === 'on' || value === 'off' || value === 'auto') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.state.audio as any)[field] = value;
        this.emit('audio', { ...this.state.audio });
      } else {
        this.log.debug('[Command] Unrecognized message: ' + message);
      }
      return;
    }

    // --- Check audio numeric map ---
    if (category in StormAudioClient.AUDIO_NUMERICS) {
      const field = StormAudioClient.AUDIO_NUMERICS[category];
      const num = parseInt(value, 10);
      if (!isNaN(num)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.state.audio as any)[field] = num;
        this.emit('audio', { ...this.state.audio });
      } else {
        this.log.debug('[Command] Unrecognized message: ' + message);
      }
      return;
    }

    // --- Check trigger categories (trig1, trig2, ...) ---
    if (category.startsWith('trig') && category !== 'trigger') {
      this.parseTriggerState(category, parts, message);
      return;
    }

    // --- Check HDMI categories (hdmi1, hdmi2) ---
    if (category.startsWith('hdmi')) {
      this.parseHdmiInfo(category, parts, message);
      return;
    }

    switch (category) {
      // --- Existing categories (unchanged behavior) ---
      case 'power':
        if (value === 'on' || value === 'off') {
          this.state.power = value === 'on';
          this.emit('power', this.state.power);
        } else {
          this.log.debug('[Command] Unrecognized message: ' + message);
        }
        break;
      case 'vol': {
        const dB = parseFloat(value);
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
      case 'input':
        this.parseInput(value, message);
        break;
      case 'procstate': {
        const procState = parseInt(value, 10);
        if (procState >= 0 && procState <= 2) {
          this.state.processorState = procState as ProcessorState;
          if (procState === ProcessorState.Sleep) {
            this.log.info('[State] Processor entered sleep mode');
          } else if (procState === ProcessorState.Initializing) {
            this.log.info('[State] Processor initializing');
          } else {
            this.log.info('[State] Processor active');
          }
          this.emit('processorState', this.state.processorState);
        } else {
          this.log.debug('[Command] Unrecognized message: ' + message);
        }
        break;
      }

      // --- Identity & control ---
      case 'version':
        this.state.identity.version = value;
        this.emit('identity', { ...this.state.identity });
        break;
      case 'brand':
        this.state.identity.brand = value.replace(/^"|"$/g, '');
        this.emit('identity', { ...this.state.identity });
        break;
      case 'model':
        this.state.identity.model = value.replace(/^"|"$/g, '');
        this.emit('identity', { ...this.state.identity });
        break;
      case 'msgstatus': {
        const id = parseInt(value, 10);
        if (!isNaN(id)) {
          this.state.msgStatus = id;
          this.emit('msgStatus', id);
        } else {
          this.log.debug('[Command] Unrecognized message: ' + message);
        }
        break;
      }
      case 'msgstatusTxt':
        this.log.info('[State] Status message: ' + value);
        break;

      // --- Stream info ---
      case 'stream':
        this.state.streamInfo.stream = value;
        this.emit('streamInfo', { ...this.state.streamInfo });
        break;
      case 'fs':
        this.state.streamInfo.sampleRate = value;
        this.emit('streamInfo', { ...this.state.streamInfo });
        break;
      case 'format':
        this.state.streamInfo.format = value;
        this.emit('streamInfo', { ...this.state.streamInfo });
        break;

      // --- Audio config (with streaming lists) ---
      case 'preset':
        this.parsePreset(parts, value, message);
        break;
      case 'surroundmode':
        this.parseSurroundMode(parts, value, message);
        break;
      case 'allowedmode': {
        const modeId = parseInt(value, 10);
        if (!isNaN(modeId)) {
          this.state.audioConfig.allowedMode = modeId;
          this.emit('allowedMode', modeId);
        } else {
          this.log.debug('[Command] Unrecognized message: ' + message);
        }
        break;
      }
      case 'speaker': {
        const spkId = parseInt(value, 10);
        if (!isNaN(spkId)) {
          this.state.audioConfig.speaker = spkId;
          this.emit('speaker', spkId);
        } else {
          this.log.debug('[Command] Unrecognized message: ' + message);
        }
        break;
      }
      case 'auropreset':
        this.parseAuroPreset(parts, value, message);
        break;

      // --- Audio control: license-gated ---
      case 'stormxt':
        if (value === 'on' || value === 'off') {
          this.state.audio.stormxt = value === 'on';
          this.emit('audio', { ...this.state.audio });
        } else {
          this.log.debug('[Command] Unrecognized message: ' + message);
        }
        break;
      case 'sphereaudioeffect': {
        const effectVal = parseInt(value, 10);
        if (!isNaN(effectVal)) {
          this.state.audio.sphereAudioEffect = effectVal;
          this.emit('audio', { ...this.state.audio });
        } else {
          this.log.debug('[Command] Unrecognized message: ' + message);
        }
        break;
      }

      // --- Audio control: float ---
      case 'lipsync': {
        const ms = parseFloat(value);
        if (!isNaN(ms)) {
          this.state.audio.lipsync = ms;
          this.emit('audio', { ...this.state.audio });
        } else {
          this.log.debug('[Command] Unrecognized message: ' + message);
        }
        break;
      }

      // --- Audio control: compound ---
      case 'dialogcontrol':
        this.parseDialogControl(value, message);
        break;

      // --- Zones ---
      case 'zones':
        this.parseZones(parts, message);
        break;

      // --- Triggers (streaming list) ---
      case 'trigger':
        this.parseTriggerList(parts, value, message);
        break;

      // --- Device config ---
      case 'brightness': {
        const bright = parseInt(value, 10);
        if (!isNaN(bright)) {
          this.state.device.brightness = bright;
          this.emit('device', { ...this.state.device });
        } else {
          this.log.debug('[Command] Unrecognized message: ' + message);
        }
        break;
      }
      case 'generator':
        if (value === 'on' || value === 'off') {
          this.state.device.generator = value === 'on';
          this.emit('device', { ...this.state.device });
        } else {
          this.log.debug('[Command] Unrecognized message: ' + message);
        }
        break;
      case 'frontpanel':
        this.parseFrontPanel(parts, message);
        break;

      // --- Informational: store in audioConfig ---
      case 'inputHdmiPassThru': {
        const passThru = parseInt(value, 10);
        if (!isNaN(passThru)) {
          this.state.audioConfig.inputHdmiPassThru = passThru;
        } else {
          this.log.debug('[Command] Unrecognized message: ' + message);
        }
        break;
      }

      // --- Informational: log debug only ---
      case 'inputZone2':
      case 'inputHdmiMatrixMode':
      case 'display':
      case 'osd':
      case 'nav':
      case 'treb':
      case 'sub_en':
      case 'close':
        this.log.debug('[Command] Informational: ' + message);
        break;

      default:
        this.log.debug('[Command] Unrecognized message: ' + message);
    }
  }

  private parseInput(value: string, message: string): void {
    if (value === 'start') {
      this.pendingInputList = [];
    } else if (value === 'end') {
      if (this.pendingInputList) {
        const inputs = this.pendingInputList;
        this.pendingInputList = null;
        this.log.info(`[State] Received input list: ${inputs.length} inputs`);
        this.emit('inputList', inputs);
      }
    } else if (value.startsWith('list')) {
      const raw = value.slice(5) + ']';
      const entry = this.parseListEntryNameId(raw);
      if (entry) {
        if (!this.pendingInputList) {
          this.pendingInputList = [];
        }
        this.pendingInputList.push(entry);
      }
    } else {
      const inputId = parseInt(value, 10);
      if (!isNaN(inputId)) {
        this.state.input = inputId;
        this.emit('input', inputId);
      } else {
        this.log.debug('[Command] Unrecognized message: ' + message);
      }
    }
  }

  private parsePreset(parts: string[], value: string, message: string): void {
    const sub = parts[2];
    if (sub === 'start') {
      this.pendingPresetList = [];
    } else if (sub === 'end') {
      if (this.pendingPresetList) {
        const presets = this.pendingPresetList;
        this.pendingPresetList = null;
        this.state.audioConfig.presetList = presets;
        this.emit('presetList', presets);
      }
    } else if (sub === 'list') {
      const raw = parts.slice(3).join('.');
      const entry = this.parseListEntryNameId(raw);
      if (entry) {
        if (!this.pendingPresetList) {
          this.pendingPresetList = [];
        }
        this.pendingPresetList.push(entry);
      }
    } else if (sub === 'custom') {
      const customVal = parts[3];
      if (customVal === 'on' || customVal === 'off') {
        this.state.audioConfig.presetCustom = customVal === 'on';
      }
      this.log.debug('[Command] Informational: ' + message);
    } else {
      const presetId = parseInt(value, 10);
      if (!isNaN(presetId)) {
        this.state.audioConfig.preset = presetId;
        this.emit('preset', presetId);
      } else {
        this.log.debug('[Command] Unrecognized message: ' + message);
      }
    }
  }

  private parseSurroundMode(parts: string[], value: string, message: string): void {
    const sub = parts[2];
    if (sub === 'start') {
      this.pendingSurroundModeList = [];
    } else if (sub === 'end') {
      if (this.pendingSurroundModeList) {
        const modes = this.pendingSurroundModeList;
        this.pendingSurroundModeList = null;
        this.state.audioConfig.surroundModeList = modes;
        this.emit('surroundModeList', modes);
      }
    } else if (sub === 'list') {
      const raw = parts.slice(3).join('.');
      const entry = this.parseListEntryNameId(raw);
      if (entry) {
        if (!this.pendingSurroundModeList) {
          this.pendingSurroundModeList = [];
        }
        this.pendingSurroundModeList.push(entry);
      }
    } else {
      const modeId = parseInt(value, 10);
      if (!isNaN(modeId)) {
        this.state.audioConfig.surroundMode = modeId;
        this.emit('surroundMode', modeId);
      } else {
        this.log.debug('[Command] Unrecognized message: ' + message);
      }
    }
  }

  private parseAuroPreset(parts: string[], value: string, message: string): void {
    const sub = parts[2];
    if (sub === 'start') {
      this.pendingAuroPresetList = [];
    } else if (sub === 'end') {
      if (this.pendingAuroPresetList) {
        const presets = this.pendingAuroPresetList;
        this.pendingAuroPresetList = null;
        this.state.audioConfig.auroPresetList = presets;
        this.emit('auroPresetList', presets);
      }
    } else if (sub === 'list') {
      const raw = parts.slice(3).join('.');
      const entry = this.parseListEntryNameId(raw);
      if (entry) {
        if (!this.pendingAuroPresetList) {
          this.pendingAuroPresetList = [];
        }
        this.pendingAuroPresetList.push(entry);
      }
    } else {
      const presetId = parseInt(value, 10);
      if (!isNaN(presetId)) {
        this.state.audioConfig.auroPreset = presetId;
        this.emit('auroPreset', presetId);
      } else {
        this.log.debug('[Command] Unrecognized message: ' + message);
      }
    }
  }

  private parseDialogControl(value: string, message: string): void {
    // Wire format: "0, 0" or "1, 3" (after bracket stripping)
    const match = value.match(/^(\d+),\s*(\d+)$/);
    if (match) {
      this.state.audio.dialogControl = {
        available: match[1] === '1',
        level: parseInt(match[2], 10),
      };
      this.emit('audio', { ...this.state.audio });
    } else {
      this.log.debug('[Command] Unrecognized message: ' + message);
    }
  }

  private parseZones(parts: string[], message: string): void {
    // parts: ['ssp', 'zones', sub, ...]
    if (parts.length < 3) {
      this.log.debug('[Command] Unrecognized message: ' + message);
      return;
    }
    const sub = parts[2];

    if (sub === 'start') {
      this.pendingZoneList = [];
    } else if (sub === 'end') {
      if (this.pendingZoneList) {
        const zones = this.pendingZoneList;
        this.pendingZoneList = null;
        for (const z of zones) {
          this.state.zones.set(z.id, z);
        }
        this.emit('zoneList', zones);
      }
    } else if (sub === 'list') {
      const raw = parts.slice(3).join('.');
      const entry = this.parseZoneListEntry(raw);
      if (entry) {
        if (!this.pendingZoneList) {
          this.pendingZoneList = [];
        }
        this.pendingZoneList.push(entry);
      }
    } else if (sub === 'profiles') {
      this.parseZoneProfiles(parts, message);
    } else {
      // Zone-specific update: ssp.zones.<field>.[ID, value]
      this.parseZoneUpdate(sub, parts, message);
    }
  }

  private parseZoneProfiles(parts: string[], message: string): void {
    // parts: ['ssp', 'zones', 'profiles', sub, ...]
    if (parts.length < 4) {
      this.log.debug('[Command] Unrecognized message: ' + message);
      return;
    }
    const sub = parts[3];
    if (sub === 'start') {
      this.pendingZoneProfileList = [];
    } else if (sub === 'end') {
      if (this.pendingZoneProfileList) {
        const profiles = this.pendingZoneProfileList;
        this.pendingZoneProfileList = null;
        this.state.zoneProfiles = profiles;
        this.emit('zoneProfileList', profiles);
      }
    } else if (sub === 'list') {
      const raw = parts.slice(4).join('.');
      const entry = this.parseZoneProfileEntry(raw);
      if (entry) {
        if (!this.pendingZoneProfileList) {
          this.pendingZoneProfileList = [];
        }
        this.pendingZoneProfileList.push(entry);
      }
    } else {
      this.log.debug('[Command] Unrecognized message: ' + message);
    }
  }

  private parseZoneUpdate(field: string, parts: string[], message: string): void {
    // Wire: ssp.zones.volume.[1, -30] → parts = ['ssp','zones','volume','[1, -30]']
    const raw = parts.slice(3).join('.');
    const match = raw.match(/^\[(\d+),\s*(.+)\]$/);
    if (!match) {
      this.log.debug('[Command] Unrecognized message: ' + message);
      return;
    }
    const zoneId = parseInt(match[1], 10);
    const rawVal = match[2].trim();

    // Get or create zone entry
    let zone = this.state.zones.get(zoneId);
    if (!zone) {
      zone = {
        id: zoneId, name: '', layout: 0, type: 0, useZone2Source: false,
        volume: 0, delay: 0, eq: 0, lipsync: 0, mode: 0,
        mute: false, loudness: 0, avzones: 0, bass: 0, treble: 0,
      };
      this.state.zones.set(zoneId, zone);
    }

    if (field in StormAudioClient.ZONE_BOOL_FIELDS) {
      if (rawVal === 'on' || rawVal === 'off' || rawVal === '1' || rawVal === '0') {
        const boolVal = rawVal === 'on' || rawVal === '1';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (zone as any)[StormAudioClient.ZONE_BOOL_FIELDS[field]] = boolVal;
        this.emit('zoneUpdate', zoneId, field, boolVal);
      } else {
        this.log.debug('[Command] Unrecognized message: ' + message);
      }
    } else if (field in StormAudioClient.ZONE_NUM_FIELDS) {
      const num = parseFloat(rawVal);
      if (!isNaN(num)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (zone as any)[StormAudioClient.ZONE_NUM_FIELDS[field]] = num;
        this.emit('zoneUpdate', zoneId, field, num);
      } else {
        this.log.debug('[Command] Unrecognized message: ' + message);
      }
    } else {
      this.log.debug('[Command] Unrecognized message: ' + message);
    }
  }

  private parseTriggerState(category: string, parts: string[], message: string): void {
    const trigNum = parseInt(category.slice(4), 10);
    if (isNaN(trigNum) || trigNum <= 0) {
      this.log.debug('[Command] Unrecognized message: ' + message);
      return;
    }
    // Check for manual sub-state: ssp.trig1.manual.on/off
    if (parts[2] === 'manual') {
      const manualVal = parts[3];
      if (manualVal === 'on' || manualVal === 'off') {
        this.state.triggerManual.set(trigNum, manualVal === 'on');
      } else {
        this.log.debug('[Command] Unrecognized message: ' + message);
      }
      return;
    }
    const val = parts[2];
    if (val === 'on' || val === 'off') {
      this.state.triggerStates.set(trigNum, val === 'on');
      this.emit('triggerState', trigNum, val === 'on');
    } else {
      this.log.debug('[Command] Unrecognized message: ' + message);
    }
  }

  private parseTriggerList(parts: string[], value: string, message: string): void {
    if (value === 'start') {
      this.pendingTriggerList = [];
    } else if (value === 'end') {
      if (this.pendingTriggerList) {
        const triggers = this.pendingTriggerList;
        this.pendingTriggerList = null;
        this.emit('triggerList', triggers);
      }
    } else if (value.startsWith('list')) {
      // ssp.trigger.list.["Trigger 1"] → after bracket strip: list.["Trigger 1"
      // Restore ] and extract name
      const raw = value.slice(5) + ']';
      const name = this.extractQuotedString(raw);
      if (name !== null) {
        if (!this.pendingTriggerList) {
          this.pendingTriggerList = [];
        }
        this.pendingTriggerList.push({ name });
      } else {
        this.log.debug('[State] Skipped malformed list entry: ' + raw);
      }
    } else {
      this.log.debug('[Command] Unrecognized message: ' + message);
    }
  }

  private parseHdmiInfo(category: string, parts: string[], message: string): void {
    // category: 'hdmi1' or 'hdmi2' → extract output number
    const outputNum = parseInt(category.slice(4), 10);
    if (isNaN(outputNum)) {
      this.log.debug('[Command] Unrecognized message: ' + message);
      return;
    }
    const field = parts[2];
    if (!(field in StormAudioClient.HDMI_FIELDS)) {
      this.log.debug('[Command] Unrecognized message: ' + message);
      return;
    }
    // Value is bracket+quote-wrapped: ["HDMI_3"] → after bracket strip: "HDMI_3"
    const rawValue = parts.slice(3).join('.').replace(/^\[|\]$/g, '');
    const strValue = rawValue.replace(/^"|"$/g, '');

    let hdmiState = this.state.hdmi.get(outputNum);
    if (!hdmiState) {
      hdmiState = {
        input: '', sync: '', timing: '', hdr: '',
        copyProtection: '', colorspace: '', colorDepth: '', mode: '',
      };
      this.state.hdmi.set(outputNum, hdmiState);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (hdmiState as any)[StormAudioClient.HDMI_FIELDS[field]] = strValue;
    this.emit('hdmiUpdate', outputNum, { ...hdmiState });
  }

  private parseFrontPanel(parts: string[], message: string): void {
    if (parts.length < 4) {
      this.log.debug('[Command] Unrecognized message: ' + message);
      return;
    }
    const sub = parts[2];
    const rawValue = parts.slice(3).join('.').replace(/^\[|\]$/g, '');

    switch (sub) {
      case 'color':
        this.state.device.frontPanel.color = rawValue;
        this.emit('device', { ...this.state.device });
        break;
      case 'stbybright': {
        const val = parseInt(rawValue, 10);
        if (!isNaN(val)) {
          this.state.device.frontPanel.standbyBrightness = val;
          this.emit('device', { ...this.state.device });
        } else {
          this.log.debug('[Command] Unrecognized message: ' + message);
        }
        break;
      }
      case 'actbright': {
        const val = parseInt(rawValue, 10);
        if (!isNaN(val)) {
          this.state.device.frontPanel.activeBrightness = val;
          this.emit('device', { ...this.state.device });
        } else {
          this.log.debug('[Command] Unrecognized message: ' + message);
        }
        break;
      }
      case 'stbytime': {
        const val = parseInt(rawValue, 10);
        if (!isNaN(val)) {
          this.state.device.frontPanel.standbyTimeout = val;
          this.emit('device', { ...this.state.device });
        } else {
          this.log.debug('[Command] Unrecognized message: ' + message);
        }
        break;
      }
      default:
        this.log.debug('[Command] Unrecognized message: ' + message);
    }
  }

  // --- List entry parsers ---

  private parseListEntryNameId(raw: string): { id: number; name: string } | null {
    // raw: '["name", id, ...]' — JSON array, extract name (index 0) and id (index 1)
    // First try JSON.parse (works for simple entries like surround mode lists)
    try {
      const arr = JSON.parse(raw) as unknown[];
      if (Array.isArray(arr) && typeof arr[0] === 'string' && typeof arr[1] === 'number') {
        return { id: arr[1], name: arr[0] };
      }
    } catch {
      // JSON.parse fails for preset lists with nested quotes like ["Theater 1", 9, "["1"]", ...]
      // Fall back to regex extraction of first two fields
      const match = raw.match(/^\["([^"]*)",\s*(\d+)/);
      if (match) {
        return { id: parseInt(match[2], 10), name: match[1] };
      }
    }
    this.log.debug('[State] Skipped malformed list entry: ' + raw);
    return null;
  }

  private parseZoneListEntry(raw: string): ZoneState | null {
    // raw: '[1, "Downmix", 2000, 1, 0, -78, 0.0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]'
    try {
      const arr = JSON.parse(raw) as unknown[];
      if (Array.isArray(arr) && arr.length >= 15 && typeof arr[0] === 'number' && typeof arr[1] === 'string') {
        return {
          id: arr[0] as number,
          name: arr[1] as string,
          layout: arr[2] as number,
          type: arr[3] as number,
          useZone2Source: (arr[4] as number) === 1,
          volume: arr[5] as number,
          delay: arr[6] as number,
          eq: arr[7] as number,
          lipsync: arr[8] as number,
          mode: arr[9] as number,
          mute: (arr[10] as number) === 1,
          loudness: arr[11] as number,
          avzones: arr[12] as number,
          bass: arr[13] as number,
          treble: arr[14] as number,
        };
      }
    } catch {
      // Not valid JSON
    }
    this.log.debug('[State] Skipped malformed zone list entry: ' + raw);
    return null;
  }

  private parseZoneProfileEntry(raw: string): ZoneProfileInfo | null {
    // raw: '[1, 1, "Downmix", 1, 0, 0, 0, 0]'
    try {
      const arr = JSON.parse(raw) as unknown[];
      if (Array.isArray(arr) && arr.length >= 4 && typeof arr[0] === 'number' &&
          typeof arr[1] === 'number' && typeof arr[2] === 'string') {
        return {
          zoneId: arr[0] as number,
          profileId: arr[1] as number,
          name: arr[2] as string,
          active: (arr[3] as number) === 1,
        };
      }
    } catch {
      // Not valid JSON
    }
    this.log.debug('[State] Skipped malformed zone profile entry: ' + raw);
    return null;
  }

  private extractQuotedString(raw: string): string | null {
    // raw: '["Trigger 1"]' → extract "Trigger 1"
    try {
      const arr = JSON.parse(raw) as unknown[];
      if (Array.isArray(arr) && typeof arr[0] === 'string') {
        return arr[0];
      }
    } catch {
      // Not valid JSON
    }
    return null;
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
