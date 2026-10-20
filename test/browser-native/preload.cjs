const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("fixture", {
  report: (value) => ipcRenderer.send("review-result", value),
  resize: (value) => ipcRenderer.invoke("review-resize", value),
  proof: () => ipcRenderer.invoke("review-proof"),
});
