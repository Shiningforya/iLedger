const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("iLedgerNative", {
  webDavRequest: (request) => ipcRenderer.invoke("iledger:webdav-request", request),
  loadWebDavLogin: () => ipcRenderer.invoke("iledger:webdav-auth:load"),
  saveWebDavLogin: (credentials) => ipcRenderer.invoke("iledger:webdav-auth:save", credentials),
  clearWebDavLogin: () => ipcRenderer.invoke("iledger:webdav-auth:clear"),
});
