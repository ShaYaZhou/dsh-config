const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("fixture", {
  report: (value) => ipcRenderer.send("review-result", value),
  resize: (value) => ipcRenderer.invoke("review-resize", value),
  proof: (name) => ipcRenderer.invoke("review-proof", name),
  input: (events) => ipcRenderer.invoke("review-input", events),
  type: (text) => ipcRenderer.invoke("review-type", text),
});
