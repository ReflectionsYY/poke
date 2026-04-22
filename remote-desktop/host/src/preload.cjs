const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hostAPI", {
  newCredentials: () => ipcRenderer.invoke("host:new-credentials"),
  signalingUrl: () => ipcRenderer.invoke("host:signaling-url"),
  listSources: () => ipcRenderer.invoke("host:list-sources"),
  primaryDisplaySize: () => ipcRenderer.invoke("host:primary-display-size"),
  inject: (event) => ipcRenderer.invoke("host:inject", event),
});
