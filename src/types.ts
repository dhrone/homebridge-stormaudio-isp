export enum ProcessorState {
  Sleep = 0,
  Initializing = 1,
  Active = 2,
}

export enum ErrorCategory {
  Transient = 'transient',
  Recoverable = 'recoverable',
  Fatal = 'fatal',
}

export interface StormAudioError {
  category: ErrorCategory;
  message: string;
  originalError?: Error;
}

export interface InputInfo {
  id: number;
  name: string;
  type?: string;
}

export interface StormAudioConfig {
  host: string;
  port?: number; // default 23
  name?: string; // default "StormAudio"
  volumeCeiling?: number; // default -20, range -100 to 0
  volumeFloor?: number; // default -100, range -100 to 0, must be < ceiling
  volumeControl?: 'lightbulb' | 'none'; // default 'lightbulb'
  inputs?: Record<string, string>; // map of input ID → alias name
  // IMPORTANT: keys are string representations of numeric IDs
  // e.g., { "3": "TV", "5": "PS5" }
  // When looking up by numeric inputId, always convert:
  //   config.inputs?.[String(inputId)]
}

export interface StormAudioState {
  power: boolean;
  volume: number; // raw dB value
  mute: boolean;
  input: number; // input ID
  processorState: ProcessorState;
}

// EventEmitter typed event contract — StormAudioClient ↔ StormAudioAccessory
export interface StormAudioEvents {
  power: (on: boolean) => void;
  volume: (dB: number) => void;
  mute: (muted: boolean) => void;
  input: (inputId: number) => void;
  processorState: (state: ProcessorState) => void;
  inputList: (inputs: InputInfo[]) => void;
  connected: () => void;
  disconnected: () => void;
  error: (error: StormAudioError) => void;
}
