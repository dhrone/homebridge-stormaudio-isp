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
  zone2AudioInId: number;
  type?: string;
}

export interface Zone2Config {
  zoneId: number;
  name: string;
  volumeCeiling: number;
  volumeFloor: number;
  volumeControl: 'fan' | 'lightbulb' | 'none';
}

export interface StormAudioConfig {
  host: string;
  port: number;
  name: string;
  volumeCeiling: number;
  volumeFloor: number;
  volumeControl: 'fan' | 'lightbulb' | 'none';
  wakeTimeout: number;
  commandInterval: number;
  inputs: Record<string, string>;
  // IMPORTANT: keys are string representations of numeric IDs
  // e.g., { "3": "TV", "5": "PS5" }
  // When looking up by numeric inputId, always convert:
  //   config.inputs[String(inputId)]
  zone2?: Zone2Config;
}

// --- Grouped state sub-interfaces (all fields required — validated output types) ---

export interface IdentityInfo {
  version: string;
  brand: string;
  model: string;
}

export interface StreamInfoState {
  stream: string;     // e.g., "None", "PCM", "Dolby Atmos"
  sampleRate: string; // e.g., "", "44.1 kHz"
  format: string;     // e.g., "", "Stereo"
}

export interface AudioState {
  dim: boolean;
  loudness: number;          // 0-3
  bass: number;              // -6 to 6
  treble: number;            // -6 to 6
  centerEnhance: number;     // -6 to 6
  surroundEnhance: number;   // -6 to 6
  lfeEnhance: number;        // -6 to 6
  lipsync: number;           // ms (float on wire)
  drc: 'on' | 'off' | 'auto';
  centerSpread: boolean;
  dialogControl: { available: boolean; level: number }; // available: 0/1, level: 0-6
  dialogNorm: boolean;
  imaxMode: 'on' | 'off' | 'auto';
  stormxt: boolean | null;   // null if license-gated error
  dolbyMode: number;         // 0-3
  dolbyVirtualizer: boolean;
  sphereAudioEffect: number | null; // null if license-gated error
  lfeDim: boolean;
  auroStrength: number;      // 0-15
}

export interface DeviceState {
  brightness: number;  // -6 to 6
  generator: boolean;
  frontPanel: {
    color: string;
    standbyBrightness: number;
    activeBrightness: number;
    standbyTimeout: number;
  };
}

export interface PresetInfo {
  id: number;
  name: string;
}

export interface SurroundModeInfo {
  id: number;
  name: string;
}

export interface AudioConfigState {
  preset: number;                        // active preset ID
  presetCustom: boolean;                 // whether settings deviate from preset
  surroundMode: number;                  // preferred surround mode ID
  allowedMode: number;                   // active (actual) surround mode ID
  speaker: number;                       // speaker config ID
  presetList: PresetInfo[];
  surroundModeList: SurroundModeInfo[];
  auroPreset: number;
  auroPresetList: PresetInfo[];
  inputHdmiPassThru: number;
}

export interface ZoneState {
  id: number;
  name: string;
  layout: number;
  type: number;
  useZone2Source: boolean;
  volume: number;
  delay: number;
  eq: number;
  lipsync: number;
  mode: number;
  mute: boolean;
  loudness: number;
  avzones: number;
  bass: number;
  treble: number;
}

export interface ZoneProfileInfo {
  zoneId: number;
  profileId: number;
  name: string;
  active: boolean;
}

export interface HdmiOutputState {
  input: string;
  sync: string;
  timing: string;
  hdr: string;
  copyProtection: string;
  colorspace: string;
  colorDepth: string;
  mode: string;
}

export interface TriggerInfo {
  name: string;
}

export interface StormAudioState {
  // Existing (unchanged — backward compatible)
  power: boolean;
  volume: number;  // raw dB value (float on wire, stored as number)
  mute: boolean;
  input: number;   // input ID
  inputZone2: number; // Zone 2 active input ID
  processorState: ProcessorState;
  // New grouped state
  identity: IdentityInfo;
  streamInfo: StreamInfoState;
  audio: AudioState;
  device: DeviceState;
  audioConfig: AudioConfigState;
  zones: Map<number, ZoneState>;
  hdmi: Map<number, HdmiOutputState>;
  msgStatus: number;
  triggerStates: Map<number, boolean>;
  triggerManual: Map<number, boolean>;
  zoneProfiles: ZoneProfileInfo[];
}

// EventEmitter typed event contract — StormAudioClient ↔ StormAudioAccessory
export interface StormAudioEvents {
  // Existing (unchanged)
  power: (on: boolean) => void;
  volume: (dB: number) => void;
  mute: (muted: boolean) => void;
  input: (inputId: number) => void;
  processorState: (state: ProcessorState) => void;
  inputList: (inputs: InputInfo[]) => void;
  connected: () => void;
  disconnected: () => void;
  error: (error: StormAudioError) => void;
  // New events — identity
  identity: (info: IdentityInfo) => void;
  // New events — stream info
  streamInfo: (info: StreamInfoState) => void;
  // New events — audio config
  preset: (id: number) => void;
  presetList: (presets: PresetInfo[]) => void;
  surroundMode: (id: number) => void;
  surroundModeList: (modes: SurroundModeInfo[]) => void;
  allowedMode: (id: number) => void;
  speaker: (id: number) => void;
  auroPreset: (id: number) => void;
  auroPresetList: (presets: PresetInfo[]) => void;
  // New events — audio control
  audio: (state: AudioState) => void;
  // New events — device config
  device: (state: DeviceState) => void;
  // New events — zones
  zoneList: (zones: ZoneState[]) => void;
  zoneUpdate: (zoneId: number, field: string, value: unknown) => void;
  zoneProfileList: (profiles: ZoneProfileInfo[]) => void;
  // New events — HDMI
  hdmiUpdate: (output: number, info: HdmiOutputState) => void;
  // New events — triggers
  triggerList: (triggers: TriggerInfo[]) => void;
  triggerState: (triggerId: number, on: boolean) => void;
  // New events — misc
  msgStatus: (id: number) => void;
  // Zone 2 input tracking
  inputZone2: (inputId: number) => void;
}
