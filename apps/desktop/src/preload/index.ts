// Bundled preload (sandboxed: only `electron` may be required at runtime).
// 1) The SDK's own private MessagePort bridge, exactly as the SDK designed it.
import '@smartspectra/node-sdk/preload';
// 2) Witness's minimal, frozen API.
import { contextBridge, ipcRenderer } from 'electron';

const invoke = (ch: string, ...a: unknown[]) => ipcRenderer.invoke(ch, ...a);

const api = Object.freeze({
  key: Object.freeze({
    status: () => invoke('key:status'),
    set: (key: string, allowPlain = false) => invoke('key:set', key, allowPlain),
    clear: () => invoke('key:clear'),
  }),
  session: Object.freeze({ getKey: () => invoke('session:getKey') }),
  store: Object.freeze({
    save: (checkin: unknown) => invoke('store:save', checkin),
    list: () => invoke('store:list'),
    exportAll: () => invoke('store:exportAll'),
    deleteAll: () => invoke('store:deleteAll'),
  }),
  settings: Object.freeze({ get: () => invoke('settings:get'), set: (patch: unknown) => invoke('settings:set', patch) }),
  open: Object.freeze({ external: (id: string) => invoke('open:external', id) }),
  app: Object.freeze({ info: () => invoke('app:info') }),
  onHidden: (cb: () => void) => {
    const l = () => cb();
    ipcRenderer.on('window:hidden', l);
    return () => ipcRenderer.removeListener('window:hidden', l);
  },
});

contextBridge.exposeInMainWorld('witness', api);
