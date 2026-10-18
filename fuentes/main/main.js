process.env.UV_THREADPOOL_SIZE = '64';
const { app, BrowserWindow, ipcMain, dialog, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { compareFolderTrees, compareFolderTreesAsync, compareFilesDeep, compareFilesDeepAsync, computeAlignedDiff, compareFolderMergeTrees, computeThreeWayTextMerge } = require('./diffEngine');
const sessionManager = require('./sessionManager');
const fileOps = require('./fileOps');
const { setupApplicationMenu, updateMenuLanguage, updateActiveView } = require('./menu');

// Set application identity
app.name = 'DiffCore';

if (process.platform === 'darwin') {
  app.setAboutPanelOptions({
    applicationName: 'DiffCore',
    applicationVersion: '1.0.0',
    version: '1.0.0',
    copyright: 'Copyright © 2026 Miguel Vergara. All rights reserved.'
  });
}

let mainWindow;

function getAppIcon() {
  try {
    if (process.platform === 'win32') {
      const icoPath = path.join(__dirname, '../../iconos/icon.ico');
      if (fs.existsSync(icoPath)) {
        return nativeImage.createFromPath(icoPath);
      }
    }
    const pngPath = path.join(__dirname, '../../iconos/icon.png');
    if (fs.existsSync(pngPath)) {
      return nativeImage.createFromPath(pngPath);
    }
  } catch (e) {
    console.warn('Error loading app icon:', e);
  }
  return undefined;
}

function createWindow() {
  const appIcon = getAppIcon();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    title: 'DiffCore - Beyond Compare Edition',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#1e1e1e',
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (appIcon && process.platform !== 'darwin') {
    mainWindow.setIcon(appIcon);
  }

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.webContents.on('did-finish-load', () => {
    sendLog(`DiffCore started. Username: ${os.userInfo().username}`);

    // Check CLI arguments for direct compare
    const args = process.argv.slice(app.isPackaged ? 1 : 2);
    const validPaths = args.filter(a => !a.startsWith('-') && fs.existsSync(a));
    if (validPaths.length >= 2) {
      const left = validPaths[0];
      const right = validPaths[1];
      const isFile = fs.statSync(left).isFile() && fs.statSync(right).isFile();
      mainWindow.webContents.send('cli:launch', {
        left,
        right,
        type: isFile ? 'text_compare' : 'folder_compare'
      });
      sendLog(`Launched via CLI: ${left} ⇄ ${right}`);
    }
  });
}

function sendLog(text) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = String(now.getFullYear()).slice(-2);
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const timeStr = `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
    mainWindow.webContents.send('log:message', `${timeStr} ${text}`);
  }
}

app.whenReady().then(() => {
  // Set Windows taskbar AppUserModelID
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.miguelvergara.diffcore');
  }

  // Set macOS dock icon
  if (process.platform === 'darwin' && app.dock) {
    const dockIconPath = path.join(__dirname, '../../iconos/icon.png');
    if (fs.existsSync(dockIconPath)) {
      app.dock.setIcon(dockIconPath);
    }
  }

  createWindow();
  setupApplicationMenu(mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (mainWindow && mainWindow.webContents) {
    try {
      const stat = fs.statSync(filePath);
      mainWindow.webContents.send('cli:launch', {
        left: filePath,
        right: '',
        type: stat.isDirectory() ? 'folder_compare' : 'text_compare'
      });
    } catch {}
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- IPC HANDLERS ---

// Menu Language Update
ipcMain.handle('menu:setLanguage', async (_event, lang) => {
  updateMenuLanguage(mainWindow, lang);
  return true;
});

// Menu Active View Update (Controls visibility of Edit menu)
ipcMain.handle('menu:setActiveView', async (_event, viewName) => {
  updateActiveView(mainWindow, viewName);
  return true;
});

// Folder Picker Dialog
ipcMain.handle('dialog:selectFolder', async (_event, defaultPath) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    defaultPath: defaultPath && fs.existsSync(defaultPath) ? defaultPath : os.homedir()
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// File Picker Dialog (for Text / Hex Compare)
ipcMain.handle('dialog:selectFile', async (_event, defaultPath) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    defaultPath: defaultPath && fs.existsSync(defaultPath) ? defaultPath : os.homedir()
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// Compare Folders (Fast Tree Walk with Beyond Compare Rules)
ipcMain.handle('diff:compareFolders', async (_event, { leftPath, rightPath, rules }) => {
  sendLog(`Load comparison: ${leftPath || '(none)'} <-> ${rightPath || '(none)'}`);
  try {
    const items = await compareFolderTreesAsync(leftPath, rightPath, rules);
    return { success: true, items };
  } catch (err) {
    sendLog(`Error comparing folders: ${err.message}`);
    return { success: false, error: err.message };
  }
});

// Compare Selection Deep (Modal =? Beyond Compare 5 Parallel Engine)
ipcMain.handle('diff:compareSelectionDeep', async (event, { leftPath, rightPath, items, method, skipBinary = true }) => {
  const startTime = performance.now();
  const total = items.length;
  const results = new Array(total);
  let matchCount = 0;
  let diffCount = 0;
  let processedCount = 0;

  const CONCURRENCY = 64; // Beyond Compare multi-threaded parallel comparison
  let currentIndex = 0;
  let lastProgressTime = 0;

  async function worker() {
    while (currentIndex < total) {
      const idx = currentIndex++;
      const item = items[idx];

      let comp;
      if (!item.left || !item.right) {
        comp = {
          status: item.left ? 'orphan_left' : 'orphan_right',
          match: false
        };
        diffCount++;
      } else {
        const fullLeft = path.join(leftPath, item.relativePath);
        const fullRight = path.join(rightPath, item.relativePath);

        const knownLeftSize = (item.left && typeof item.left.size === 'number') ? item.left.size : undefined;
        const knownRightSize = (item.right && typeof item.right.size === 'number') ? item.right.size : undefined;

        comp = await compareFilesDeepAsync(fullLeft, fullRight, method, skipBinary, knownLeftSize, knownRightSize);
        if (comp.match) matchCount++;
        else diffCount++;
      }

      results[idx] = {
        relativePath: item.relativePath,
        ...comp
      };

      processedCount++;

      // Throttle progress events to ~35ms to ensure high-FPS smooth UI without IPC overhead
      const now = Date.now();
      if (now - lastProgressTime > 35 || processedCount === total) {
        lastProgressTime = now;
        const percentage = Math.round((processedCount / total) * 100);
        try {
          if (!event.sender.isDestroyed()) {
            event.sender.send('diff:compareProgress', {
              current: processedCount,
              total,
              percentage,
              currentFile: item.relativePath,
              matchCount,
              diffCount
            });
          }
        } catch {}
      }
    }
  }

  const workerCount = Math.min(CONCURRENCY, Math.max(1, total));
  const workers = [];
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  const elapsedSec = ((performance.now() - startTime) / 1000).toFixed(2);
  const elapsedFormatted = elapsedSec.replace('.', ',');
  sendLog(`Successfully compared ${total.toLocaleString('es-ES')} items. Completed in ${elapsedFormatted} seconds.`);
  return {
    success: true,
    method,
    matchCount,
    diffCount,
    elapsedSec,
    results
  };
});

// Beyond Compare 5 Myers Diff Alignment
ipcMain.handle('diff:computeAlignedDiff', async (_event, { leftText, rightText }) => {
  return computeAlignedDiff(leftText, rightText);
});

// Session Management (Dynamic BC5 + DiffCore)
ipcMain.handle('sessions:load', async () => {
  return sessionManager.getAllSessions();
});

ipcMain.handle('sessions:save', async (_event, sessionData) => {
  const res = sessionManager.saveSession(sessionData);
  if (res.success) {
    sendLog(`Saved session: ${sessionData.name}`);
  }
  return res;
});

ipcMain.handle('sessions:autoSave', async (_event, sessionData) => {
  return sessionManager.recordAutoSavedSession(sessionData);
});

ipcMain.handle('sessions:delete', async (_event, sessionId) => {
  const res = sessionManager.deleteSession(sessionId);
  if (res.success) {
    sendLog(`Deleted session: ${sessionId}`);
  }
  return res;
});

// File Operations (Copy, Delete, Reveal)
ipcMain.handle('fs:copyItem', async (_event, { src, dest }) => {
  sendLog(`Copying: ${src} -> ${dest}`);
  return fileOps.copyItem(src, dest);
});

ipcMain.handle('fs:deleteItem', async (_event, targetPath) => {
  sendLog(`Deleting: ${targetPath}`);
  return fileOps.deleteItem(targetPath);
});

ipcMain.handle('fs:renameItem', async (_event, { oldPath, newPath }) => {
  sendLog(`Renaming: ${oldPath} -> ${newPath}`);
  return fileOps.renameItem(oldPath, newPath);
});

ipcMain.handle('fs:moveItem', async (_event, { src, dest }) => {
  sendLog(`Moving: ${src} -> ${dest}`);
  return fileOps.moveItem(src, dest);
});

ipcMain.handle('fs:createFolder', async (_event, folderPath) => {
  sendLog(`Creating folder: ${folderPath}`);
  return fileOps.createFolder(folderPath);
});

ipcMain.handle('fs:touchItem', async (_event, targetPath) => {
  sendLog(`Touching: ${targetPath}`);
  return fileOps.touchItem(targetPath);
});

ipcMain.handle('fs:getAttributes', async (_event, targetPath) => {
  return fileOps.getItemAttributes(targetPath);
});

ipcMain.handle('fs:openDefaultApp', async (_event, targetPath) => {
  return fileOps.openInDefaultApp(targetPath);
});

ipcMain.handle('fs:openTerminal', async (_event, targetPath) => {
  return fileOps.openTerminal(targetPath);
});

ipcMain.handle('fs:reveal', async (_event, targetPath) => {
  return fileOps.revealInFinder(targetPath);
});

// Text Compare Operations
ipcMain.handle('fs:readText', async (_event, filePath) => {
  return fileOps.readTextFile(filePath);
});

ipcMain.handle('fs:writeText', async (_event, { filePath, content }) => {
  sendLog(`Saved file: ${filePath}`);
  return fileOps.writeTextFile(filePath, content);
});

// Hex Compare Operations
ipcMain.handle('fs:readHex', async (_event, { filePath, offset, length }) => {
  return fileOps.readHexDump(filePath, offset, length);
});

// Table Compare Operations (Excel, CSV, TSV, HTML)
ipcMain.handle('table:read', async (_event, filePath) => {
  sendLog(`Reading table: ${filePath}`);
  return fileOps.readTableFile(filePath);
});

// Media Compare Operations (ID3, MP3, FLAC, M4A, WAV)
ipcMain.handle('media:readTags', async (_event, filePath) => {
  sendLog(`Reading media metadata: ${filePath}`);
  return fileOps.readMediaMetadata(filePath);
});

// Folder Sync Operations
ipcMain.handle('sync:execute', async (_event, tasks) => {
  sendLog(`Executing folder sync with ${tasks.length} operations...`);
  return fileOps.executeFolderSync(tasks);
});

// 3-Way Folder Merge Operations
ipcMain.handle('merge:folderMerge', async (_event, { left, base, right }) => {
  sendLog(`3-Way Folder Merge: Left: ${left || '(none)'}, Base: ${base || '(none)'}, Right: ${right || '(none)'}`);
  return compareFolderMergeTrees(left, base, right);
});

// 3-Way Text Merge Operations
ipcMain.handle('merge:textMerge', async (_event, { left, base, right }) => {
  return computeThreeWayTextMerge(left, base, right);
});

// System Info
ipcMain.handle('system:getInfo', async () => {
  return {
    username: os.userInfo().username,
    platform: process.platform,
    arch: process.arch,
    freeMem: Math.round(os.freemem() / (1024 * 1024 * 1024)) + ' GB free'
  };
});

// System Telemetry for Home Dashboard
ipcMain.handle('system:getTelemetry', async () => {
  const mem = process.memoryUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  return {
    appMemoryMB: Math.round(mem.rss / (1024 * 1024)),
    heapUsedMB: Math.round(mem.heapUsed / (1024 * 1024)),
    totalMemoryGB: Math.round(totalMem / (1024 * 1024 * 1024)),
    freeMemoryGB: +(freeMem / (1024 * 1024 * 1024)).toFixed(1),
    platform: process.platform,
    arch: process.arch,
    uptime: Math.round(process.uptime())
  };
});

