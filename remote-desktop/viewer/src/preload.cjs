const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("viewerAPI", {
  signalingUrl: () => ipcRenderer.invoke("viewer:signaling-url"),
  hashPasscode: (passcode) => ipcRenderer.invoke("viewer:hash-passcode", passcode),
});
