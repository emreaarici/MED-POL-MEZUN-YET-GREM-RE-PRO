const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getStreamId: () => ipcRenderer.invoke('get-stream-id'),
  recordingComplete: (arrayBuffer) => ipcRenderer.send('recording-complete', arrayBuffer)
});
