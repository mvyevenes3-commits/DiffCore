const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Host OS Platform ('darwin', 'win32', 'linux')
  platform: process.platform,

  // Cross-Platform Drag and Drop file resolver (macOS, Windows, Linux)
  getPathForFile: (file) => {
    try {
      if (webUtils && typeof webUtils.getPathForFile === 'function') {
        return webUtils.getPathForFile(file);
      }
    } catch (e) {
      console.warn('webUtils.getPathForFile error:', e);
    }
    return file ? (file.path || '') : '';
  },

  // Folder & File Selection
  selectFolder: (defaultPath) => ipcRenderer.invoke('dialog:selectFolder', defaultPath),
  selectFile: (defaultPath) => ipcRenderer.invoke('dialog:selectFile', defaultPath),
  listDirectory: (dirPath) => ipcRenderer.invoke('fs:listDirectory', dirPath),
  
  // Folder Comparison
  compareFolders: (leftPath, rightPath, rules) => ipcRenderer.invoke('diff:compareFolders', { leftPath, rightPath, rules }),
  
  // Deep Compare Modal Action (=?)
  compareSelectionDeep: (leftPath, rightPath, items, method, skipBinary) => 
    ipcRenderer.invoke('diff:compareSelectionDeep', { leftPath, rightPath, items, method, skipBinary }),

  // DiffCore Myers Diff Alignment
  computeAlignedDiff: (leftText, rightText) => 
    ipcRenderer.invoke('diff:computeAlignedDiff', { leftText, rightText }),
  
  // Sessions Management (Dynamic DiffCore + DiffCore)
  loadSessions: () => ipcRenderer.invoke('sessions:load'),
  saveSession: (sessionData) => ipcRenderer.invoke('sessions:save', sessionData),
  recordAutoSavedSession: (sessionData) => ipcRenderer.invoke('sessions:autoSave', sessionData),
  deleteSession: (sessionId) => ipcRenderer.invoke('sessions:delete', sessionId),
  
  // File Operations (Copy, Delete, Move, Rename, Reveal, Touch, Attributes)
  copyItem: (src, dest) => ipcRenderer.invoke('fs:copyItem', { src, dest }),
  moveItem: (src, dest) => ipcRenderer.invoke('fs:moveItem', { src, dest }),
  deleteItem: (targetPath) => ipcRenderer.invoke('fs:deleteItem', targetPath),
  renameItem: (oldPath, newPath) => ipcRenderer.invoke('fs:renameItem', { oldPath, newPath }),
  createFolder: (folderPath) => ipcRenderer.invoke('fs:createFolder', folderPath),
  touchItem: (targetPath) => ipcRenderer.invoke('fs:touchItem', targetPath),
  getAttributes: (targetPath) => ipcRenderer.invoke('fs:getAttributes', targetPath),
  openDefaultApp: (targetPath) => ipcRenderer.invoke('fs:openDefaultApp', targetPath),
  openTerminal: (targetPath) => ipcRenderer.invoke('fs:openTerminal', targetPath),
  revealInFinder: (targetPath) => ipcRenderer.invoke('fs:reveal', targetPath),
  
  // Text Compare Operations
  readTextFile: (filePath) => ipcRenderer.invoke('fs:readText', filePath),
  writeTextFile: (filePath, content) => ipcRenderer.invoke('fs:writeText', { filePath, content }),
  watchFiles: (filePaths) => ipcRenderer.invoke('fs:watchFiles', filePaths),
  unwatchFiles: () => ipcRenderer.invoke('fs:unwatchFiles'),
  getFileMtime: (filePath) => ipcRenderer.invoke('fs:getMtime', filePath),
  
  // Hex Compare Operations
  readHexDump: (filePath, offset, length) => ipcRenderer.invoke('fs:readHex', { filePath, offset, length }),

  // Table Compare Operations (Excel, CSV, TSV, HTML)
  readTableFile: (filePath) => ipcRenderer.invoke('table:read', filePath),

  // Media Compare Operations (ID3, MP3, FLAC, M4A, WAV)
  readMediaMetadata: (filePath) => ipcRenderer.invoke('media:readTags', filePath),

  // Folder Sync Operations
  executeFolderSync: (tasks) => ipcRenderer.invoke('sync:execute', tasks),

  // 3-Way Folder Merge Operations
  compareFolderMergeTrees: (left, base, right) => ipcRenderer.invoke('merge:folderMerge', { left, base, right }),

  // 3-Way Text Merge Operations
  computeThreeWayTextMerge: (left, base, right) => ipcRenderer.invoke('merge:textMerge', { left, base, right }),

  // System Info
  getSystemInfo: () => ipcRenderer.invoke('system:getInfo'),
  getTelemetry: () => ipcRenderer.invoke('system:getTelemetry'),

  // Application Menu Integration
  setMenuLanguage: (lang) => ipcRenderer.invoke('menu:setLanguage', lang),
  setActiveView: (viewName) => ipcRenderer.invoke('menu:setActiveView', viewName),
  
  // Listeners
  onLogMessage: (callback) => ipcRenderer.on('log:message', (_event, msg) => callback(msg)),
  onCliLaunch: (callback) => ipcRenderer.on('cli:launch', (_event, data) => callback(data)),
  onOpenSettings: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('menu:openSettings', handler);
    return () => ipcRenderer.removeListener('menu:openSettings', handler);
  },
  onOpenAbout: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('menu:openAbout', handler);
    return () => ipcRenderer.removeListener('menu:openAbout', handler);
  },
  onNewTab: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('menu:newTab', handler);
    return () => ipcRenderer.removeListener('menu:newTab', handler);
  },
  onCloseTab: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('menu:closeTab', handler);
    return () => ipcRenderer.removeListener('menu:closeTab', handler);
  },
  onCompareProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('diff:compareProgress', handler);
    return () => ipcRenderer.removeListener('diff:compareProgress', handler);
  },
  // Help Documentation
  openHelp: (topic) => ipcRenderer.invoke('help:open', topic),
  openHelpInBrowser: (topic) => ipcRenderer.invoke('help:openInBrowser', topic),
  onOpenHelp: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('menu:openHelp', handler);
    return () => ipcRenderer.removeListener('menu:openHelp', handler);
  },
  onNavigateHelp: (callback) => {
    const handler = (_event, topic) => callback(topic);
    ipcRenderer.on('help:navigateTo', handler);
    return () => ipcRenderer.removeListener('help:navigateTo', handler);
  },

  // Auto-Update API
  startUpdate: (force = false) => ipcRenderer.invoke('updater:start', force),
  cancelUpdate: () => ipcRenderer.invoke('updater:cancel'),
  onUpdateProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('updater:progress', handler);
    return () => ipcRenderer.removeListener('updater:progress', handler);
  },
  onMenuCheckForUpdates: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('menu:checkForUpdates', handler);
    return () => ipcRenderer.removeListener('menu:checkForUpdates', handler);
  },

  onFileChanged: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('file:changed', handler);
    return () => ipcRenderer.removeListener('file:changed', handler);
  }
});
