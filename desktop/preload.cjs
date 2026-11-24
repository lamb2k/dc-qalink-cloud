// Preload (sandboxed, context-isolated): exposes window.qalink, the one typed interface (src/platform/desktop.ts),
// and nothing else. The page never sees ipcRenderer. Channel names must match IPC_CHANNELS / IPC_EVENTS
// (tests/desktop.test.ts reads this file and checks).
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const inv = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
const listen = (ch, map) => (cb) => {
  if (typeof cb !== 'function') throw new TypeError('callback must be a function');
  const f = (_e, v) => map(cb, v);
  ipcRenderer.on(ch, f);
  return () => ipcRenderer.removeListener(ch, f);
};

contextBridge.exposeInMainWorld('qalink', Object.freeze({
  version: 1,
  info: () => inv('app:info'),
  openFiles: (purpose, multi = false) => inv('file:open', String(purpose), !!multi),
  readDropped: (file, purpose) => {
    const path = webUtils.getPathForFile(file); // '' for a File the page made itself: refused in main
    return inv('file:read-dropped', path, String(purpose));
  },
  reread: (handle) => inv('file:reread', String(handle)),
  saveFile: (purpose, name, data) => inv('file:save', String(purpose), String(name), typeof data === 'string' ? data : new Uint8Array(data)),
  watch: (handle) => inv('file:watch', String(handle)),
  unwatch: (handle) => inv('file:unwatch', String(handle)),
  onFileChanged: listen('file:changed', (cb, v) => cb(v.handle, v.name)),
  networkInterfaces: () => inv('net:interfaces'),
  programs: () => inv('prog:list'),
  startProgram: (id) => inv('prog:start', String(id)),
  stopProgram: (id) => inv('prog:stop', String(id)),
  onProgram: listen('prog:status', (cb, v) => cb(v)),
  chooseFlycast: () => inv('prog:choose-flycast'),
  prepareFlycast: () => inv('prog:prepare-flycast'),
  builds: () => inv('builds:info'),
  chooseBuilds: () => inv('builds:choose'),
  useSample: () => inv('builds:use-sample'),
  readBuild: (name) => inv('builds:read', String(name)),
  swapSampleTexture: () => inv('builds:swap-sample-texture'),
  settings: () => inv('settings:get'),
  setSetting: (key, value) => inv('settings:set', String(key), value),
  bridgePython: () => inv('bridge:python'),
  chooseBridgePython: () => inv('bridge:choose-python'),
  defaultBridgePython: () => inv('bridge:default-python'),
  firewallCheck: () => inv('firewall:check'),
  firewallAllow: () => inv('firewall:allow'),
}));
