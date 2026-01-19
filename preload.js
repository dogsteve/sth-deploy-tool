const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    loadConfig: () => ipcRenderer.invoke('load-config'),
    saveConfig: (config) => ipcRenderer.invoke('save-config', config),
    selectFile: () => ipcRenderer.invoke('select-file'),
    runDeploy: (data) => ipcRenderer.send('run-deploy', data),
    onLog: (callback) => ipcRenderer.on('log-output', (event, msg) => callback(msg)),
    onDeployComplete: (callback) => ipcRenderer.on('deploy-complete', (event, data) => callback(data))
});
