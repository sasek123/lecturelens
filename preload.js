const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lectureLens", {
  getConfig: () => ipcRenderer.invoke("get-config"),
  saveApiKeys: (keys) => ipcRenderer.invoke("save-api-keys", keys),
  transcribeAudio: (payload) => ipcRenderer.invoke("transcribe-audio", payload),
  summarizeText: (payload) => ipcRenderer.invoke("summarize-text", payload),
  updateRecording: (state) => ipcRenderer.send("recording:update", state),
  stopRecording: () => ipcRenderer.send("recording:stop"),
  openMainWindow: () => ipcRenderer.send("recording:open"),
  onRecordingState: (callback) => ipcRenderer.on("recording:state", (_event, state) => callback(state)),
  onRecordingControl: (callback) => ipcRenderer.on("recording:control", (_event, action) => callback(action)),
  onNewLecture: (callback) => ipcRenderer.on("app:new-lecture", callback),
  onOpenSettings: (callback) => ipcRenderer.on("app:settings", callback)
});
