// The desktop app's powers, as the UI sees them: one typed interface, `window.qalink`, put there by the Electron
// preload (desktop/preload.cjs) and absent on the hosted web page. The UI asks `desktop()` and hides desktop-only
// actions when it answers null. Every call is checked again in the main process (desktop/main.mjs): the renderer never
// names a path or a command line; it gets handles for files the user picked or dropped, and starts programs by id.

export const QALINK_DESKTOP_VERSION = 1;

/** what a picked or dropped file is for: decides the dialog's filters, the allowed extensions and the size limit */
export type FilePurpose = 'session' | 'build' | 'asset' | 'presets' | 'padscript' | 'loader';
export interface OpenedFile { handle: string; name: string; size: number; modified: number; bytes: Uint8Array }
export interface NetIf { name: string; address: string; family: 'IPv4' | 'IPv6'; netmask: string; internal: boolean; virtual: boolean; lan: boolean }
export type ProgramId = 'bridge' | 'flycast';
export interface ProgramStatus { id: ProgramId; label: string; configured: boolean; running: boolean; pid: number | null; detail: string; lastExit: number | null; output: string[] }
export interface McpLaunch { command: string; args: string[]; env: Record<string, string> }
export interface AppInfo { app: string; version: string; electron: string; chrome: string; node: string; platform: string; packaged: boolean; dataDir: string; mcp: McpLaunch; capture: boolean }
export type Connection = 'bba' | 'modem' | 'flycast';
export interface AppSettings { version: 1; startBridgeOnLaunch: boolean; bridgeAddress: string; flycastPath: string; mcpLocal: boolean; flycastPrepared: string; consoleOnNetwork?: boolean; autoconnect?: boolean; connection?: Connection | ''; buildsRoot?: string }
export type SettingKey = 'startBridgeOnLaunch' | 'bridgeAddress' | 'mcpLocal' | 'consoleOnNetwork' | 'autoconnect' | 'connection';
/** the builds folder: the one folder the bridge shares with the console (files, network disc overlay, asset root) */
export interface BuildsInfo { root: string; sample: boolean; sampleAvailable: boolean; connection: Connection | ''; programs: string[]; shared: string }

export interface QalinkDesktop {
  readonly version: number;
  info(): Promise<AppInfo>;
  /** shows the system Open dialog; [] when cancelled */
  openFiles(purpose: FilePurpose, multi?: boolean): Promise<OpenedFile[]>;
  /** reads a file the user dropped on the window (the File object from the drop event) */
  readDropped(file: File, purpose: FilePurpose): Promise<OpenedFile>;
  /** reads a granted file again (after it changed) */
  reread(handle: string): Promise<OpenedFile>;
  /** shows the system Save dialog and writes the data; false when cancelled */
  saveFile(purpose: FilePurpose, suggestedName: string, data: Uint8Array | string): Promise<{ saved: boolean; name?: string }>;
  watch(handle: string): Promise<void>;
  unwatch(handle: string): Promise<void>;
  onFileChanged(cb: (handle: string, name: string) => void): () => void;
  networkInterfaces(): Promise<NetIf[]>;
  programs(): Promise<ProgramStatus[]>;
  startProgram(id: ProgramId): Promise<ProgramStatus>;
  stopProgram(id: ProgramId): Promise<ProgramStatus>;
  onProgram(cb: (s: ProgramStatus) => void): () => void;
  /** asks the user for flycast.exe with the system dialog; the main process keeps the path */
  chooseFlycast(): Promise<ProgramStatus>;
  /** makes the app's own Flycast settings folder (never the user's); returns its path */
  prepareFlycast(): Promise<{ ok: boolean; dir: string; note: string }>;
  builds(): Promise<BuildsInfo>;
  /** the system folder dialog; the main process keeps the folder and restarts a running bridge with it */
  chooseBuilds(): Promise<BuildsInfo>;
  /** copies the bundled sample game into the app's data folder (once) and makes it the builds folder */
  useSample(): Promise<BuildsInfo>;
  /** a program (.elf, .bin) by its plain name in the builds folder; anything else is refused */
  readBuild(name: string): Promise<{ name: string; size: number; modified: number; bytes: Uint8Array }>;
  /** the sample's texture swap (FLOOR.BMP and extras/FLOOR_ALT.BMP trade places) */
  swapSampleTexture(): Promise<{ changed: string; bytes: number }>;
  settings(): Promise<AppSettings>;
  setSetting(key: SettingKey, value: boolean | string): Promise<AppSettings>;
}

/** The IPC channels the preload uses; the main process handles exactly these (tests/desktop.test.ts checks both). */
export const IPC_CHANNELS = ['app:info', 'file:open', 'file:read-dropped', 'file:reread', 'file:save', 'file:watch', 'file:unwatch', 'net:interfaces',
  'prog:list', 'prog:start', 'prog:stop', 'prog:choose-flycast', 'prog:prepare-flycast', 'builds:info', 'builds:choose', 'builds:use-sample', 'builds:read',
  'builds:swap-sample-texture', 'settings:get', 'settings:set'] as const;
export const IPC_EVENTS = ['file:changed', 'prog:status'] as const;

declare global { interface Window { qalink?: QalinkDesktop } }

/** the desktop interface, or null on the web */
export function desktop(): QalinkDesktop | null {
  const q = typeof window !== 'undefined' ? window.qalink : undefined;
  return q && q.version === QALINK_DESKTOP_VERSION ? q : null;
}
export const isDesktop = (): boolean => desktop() !== null;
