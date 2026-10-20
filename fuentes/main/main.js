process.env.UV_THREADPOOL_SIZE = '64';
const { app, BrowserWindow, ipcMain, dialog, nativeImage, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const url = require('url');
const { compareFolderTrees, compareFolderTreesAsync, compareFilesDeep, compareFilesDeepAsync, computeAlignedDiff, compareFolderMergeTrees, computeThreeWayTextMerge } = require('./diffEngine');
const sessionManager = require('./sessionManager');
const fileOps = require('./fileOps');
const archiveHandler = require('./archiveHandler');
const javaDecompiler = require('./javaDecompiler');
const { setupApplicationMenu, updateMenuLanguage, updateActiveView, getContextMenuForEditable, getContextMenuForSelection, setHelpOpener, setHelpBrowserOpener } = require('./menu');

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
    title: 'DiffCore',
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

  // Universal native context menu for editable inputs (Cut, Copy, Paste, Select All)
  mainWindow.webContents.on('context-menu', (_event, params) => {
    if (params.isEditable) {
      const menu = getContextMenuForEditable();
      menu.popup({ window: mainWindow });
    } else if (params.selectionText && params.selectionText.trim().length > 0) {
      const menu = getContextMenuForSelection();
      menu.popup({ window: mainWindow });
    }
  });

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
  setHelpOpener(openHelpWindow);
  setHelpBrowserOpener(openHelpInBrowser);

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

let lastBrowsedDir = '';

function resolveDefaultPath(requestedPath) {
  try {
    if (requestedPath && typeof requestedPath === 'string' && requestedPath.trim()) {
      const clean = requestedPath.trim();
      if (fs.existsSync(clean)) {
        const stat = fs.statSync(clean);
        return stat.isDirectory() ? clean : path.dirname(clean);
      }
      const parent = path.dirname(clean);
      if (fs.existsSync(parent)) {
        return parent;
      }
    }
  } catch {}

  try {
    if (lastBrowsedDir && fs.existsSync(lastBrowsedDir)) {
      return lastBrowsedDir;
    }
  } catch {}

  try {
    const projDir = path.join(os.homedir(), '01.-PROGRAMACION');
    if (fs.existsSync(projDir)) return projDir;
    const docs = app.getPath('documents');
    if (fs.existsSync(docs)) return docs;
    const downloads = app.getPath('downloads');
    if (fs.existsSync(downloads)) return downloads;
  } catch {}

  return os.homedir();
}

// Quick Picker: Ultra-Fast In-App Directory Listing (0.3ms)
ipcMain.handle('fs:listDirectory', async (_event, targetPath) => {
  try {
    const dir = resolveDefaultPath(targetPath);
    let resolvedDir = dir;
    let isArchive = false;
    let resolvedArchive = null;

    try {
      if (fs.existsSync(dir)) {
        if (archiveHandler.isArchiveFile(dir)) {
          isArchive = true;
          resolvedArchive = archiveHandler.resolveFolderOrArchive(dir);
        } else {
          const st = fs.statSync(dir);
          if (!st.isDirectory()) {
            resolvedDir = path.dirname(dir);
          }
        }
      } else {
        resolvedDir = path.join(os.homedir(), '01.-PROGRAMACION');
        if (!fs.existsSync(resolvedDir)) resolvedDir = os.homedir();
      }
    } catch {
      resolvedDir = os.homedir();
    }

    const targetDir = (isArchive && resolvedArchive) ? resolvedArchive.expandedPath : resolvedDir;

    lastBrowsedDir = targetDir;

    const entries = fs.readdirSync(targetDir, { withFileTypes: true });
    const items = [];

    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue; // ignore hidden items

      try {
        const full = path.join(targetDir, ent.name);
        let isDir = false;
        let size = 0;
        let mtimeMs = 0;

        try {
          const st = fs.statSync(full);
          isDir = st.isDirectory();
          size = isDir ? 0 : st.size;
          mtimeMs = st.mtimeMs;
        } catch {
          isDir = ent.isDirectory();
        }

        const ext = path.extname(ent.name).toLowerCase();
        const isChildArchive = archiveHandler.isArchiveFile(full);

        items.push({
          name: ent.name,
          fullPath: full,
          isDirectory: isDir,
          isArchive: isChildArchive,
          size,
          mtimeMs,
          ext
        });
      } catch {}
    }

    // Sort: directories first (alphabetical), then files (alphabetical)
    items.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });

    const parentDir = path.dirname(resolvedDir);

    const shortcuts = [
      { name: '01.-PROGRAMACION', path: path.join(os.homedir(), '01.-PROGRAMACION'), icon: '💻' },
      { name: 'Documentos', path: app.getPath('documents'), icon: '📄' },
      { name: 'Descargas', path: app.getPath('downloads'), icon: '⬇️' },
      { name: 'Escritorio', path: app.getPath('desktop'), icon: '🖥️' },
      { name: 'Inicio (~)', path: os.homedir(), icon: '🏠' }
    ].filter(s => {
      try { return fs.existsSync(s.path); } catch { return false; }
    });

    return {
      success: true,
      currentPath: resolvedDir,
      parentPath: parentDir !== resolvedDir ? parentDir : null,
      items,
      shortcuts
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Folder Picker Dialog (Instant Standalone OpenPanel with Path Memory)
ipcMain.handle('dialog:selectFolder', async (_event, defaultPath) => {
  const resolvedPath = resolveDefaultPath(defaultPath);
  const result = await dialog.showOpenDialog({
    title: 'Select Folder or Archive',
    defaultPath: resolvedPath,
    properties: ['openDirectory', 'openFile', 'dontAddToRecent', 'noResolveAliases']
  });
  if (!result.canceled && result.filePaths.length > 0) {
    const selected = result.filePaths[0];
    lastBrowsedDir = selected;
    return selected;
  }
  return null;
});

// File Picker Dialog (Instant Standalone OpenPanel with Path Memory)
ipcMain.handle('dialog:selectFile', async (_event, defaultPath) => {
  const resolvedPath = resolveDefaultPath(defaultPath);
  const result = await dialog.showOpenDialog({
    title: 'Select File',
    defaultPath: resolvedPath,
    properties: ['openFile', 'dontAddToRecent', 'noResolveAliases']
  });
  if (!result.canceled && result.filePaths.length > 0) {
    const selected = result.filePaths[0];
    try {
      lastBrowsedDir = path.dirname(selected);
    } catch {}
    return selected;
  }
  return null;
});

// Compare Folders (Fast Tree Walk with DiffCore Rules, supports .jar, .war, .ear, .zip)
ipcMain.handle('diff:compareFolders', async (_event, { leftPath, rightPath, rules }) => {
  sendLog(`Load comparison: ${leftPath || '(none)'} <-> ${rightPath || '(none)'}`);
  try {
    const leftRes = archiveHandler.resolveFolderOrArchive(leftPath);
    const rightRes = archiveHandler.resolveFolderOrArchive(rightPath);

    const actualLeft = leftRes.expandedPath;
    const actualRight = rightRes.expandedPath;

    const items = await compareFolderTreesAsync(actualLeft, actualRight, rules);
    return {
      success: true,
      items,
      leftOriginal: leftRes.originalPath,
      rightOriginal: rightRes.originalPath,
      leftExpanded: leftRes.expandedPath,
      rightExpanded: rightRes.expandedPath,
      leftIsArchive: leftRes.isArchive,
      rightIsArchive: rightRes.isArchive
    };
  } catch (err) {
    sendLog(`Error comparing folders: ${err.message}`);
    return { success: false, error: err.message };
  }
});

// Compare Selection Deep (Modal =? DiffCore Parallel Engine)
ipcMain.handle('diff:compareSelectionDeep', async (event, { leftPath, rightPath, items, method, skipBinary = true }) => {
  const startTime = performance.now();
  const total = items.length;
  const results = new Array(total);
  let matchCount = 0;
  let diffCount = 0;
  let processedCount = 0;

  const leftRes = archiveHandler.resolveFolderOrArchive(leftPath);
  const rightRes = archiveHandler.resolveFolderOrArchive(rightPath);
  const effectiveLeft = leftRes.expandedPath;
  const effectiveRight = rightRes.expandedPath;

  const CONCURRENCY = 64; // DiffCore multi-threaded parallel comparison
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
        const fullLeft = path.join(effectiveLeft, item.relativePath);
        const fullRight = path.join(effectiveRight, item.relativePath);

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

// DiffCore Myers Diff Alignment
ipcMain.handle('diff:computeAlignedDiff', async (_event, { leftText, rightText }) => {
  return computeAlignedDiff(leftText, rightText);
});

// Session Management (Dynamic DiffCore + DiffCore)
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

// Cross-Platform Native File Watchers (macOS: FSEvents, Linux: inotify, Windows: ReadDirectoryChangesW)
const activeWatchers = new Map();

function unwatchAllFiles() {
  for (const [p, item] of activeWatchers.entries()) {
    if (item.debounceTimer) clearTimeout(item.debounceTimer);
    try { item.watcher.close(); } catch (_) {}
  }
  activeWatchers.clear();
}

function watchFile(filePath) {
  if (!filePath || typeof filePath !== 'string') return;
  const resolved = path.resolve(filePath);
  if (activeWatchers.has(resolved)) return;

  try {
    if (!fs.existsSync(resolved)) return;
    let lastMtimeMs = 0;
    try { lastMtimeMs = fs.statSync(resolved).mtimeMs; } catch (_) {}

    const item = {
      lastMtimeMs,
      debounceTimer: null,
      watcher: null
    };

    const attachWatcher = () => {
      try {
        if (!fs.existsSync(resolved)) return;
        item.watcher = fs.watch(resolved, (eventType) => {
          clearTimeout(item.debounceTimer);
          item.debounceTimer = setTimeout(() => {
            try {
              if (!fs.existsSync(resolved)) {
                // Potential atomic save (write temp file + replace/rename)
                setTimeout(() => {
                  if (fs.existsSync(resolved)) {
                    attachWatcher();
                    notifyFileChanged(resolved);
                  }
                }, 150);
                return;
              }
              const stat = fs.statSync(resolved);
              if (stat.mtimeMs !== item.lastMtimeMs) {
                item.lastMtimeMs = stat.mtimeMs;
                notifyFileChanged(resolved, stat.mtimeMs);
              }
            } catch (_) {}
          }, 200);
        });

        item.watcher.on('error', () => {
          try { item.watcher.close(); } catch (_) {}
          setTimeout(() => attachWatcher(), 300);
        });
      } catch (e) {
        console.warn('attachWatcher error:', e);
      }
    };

    attachWatcher();
    activeWatchers.set(resolved, item);
  } catch (err) {
    console.warn('watchFile failed for:', resolved, err);
  }
}

function notifyFileChanged(filePath, mtimeMs) {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
    mainWindow.webContents.send('file:changed', { filePath, mtimeMs: mtimeMs || Date.now() });
  }
}

ipcMain.handle('fs:watchFiles', async (_event, filePaths) => {
  unwatchAllFiles();
  if (Array.isArray(filePaths)) {
    for (const p of filePaths) {
      if (p) watchFile(p);
    }
  }
  return true;
});

ipcMain.handle('fs:unwatchFiles', async () => {
  unwatchAllFiles();
  return true;
});

ipcMain.handle('fs:getMtime', async (_event, filePath) => {
  try {
    if (filePath && fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      return { success: true, mtimeMs: stat.mtimeMs, size: stat.size };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
  return { success: false, error: 'File not found' };
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

// Help Window Management (Dedicated Independent Documentation Window)
let helpWindow = null;

function openHelpWindow(topic = '') {
  if (helpWindow && !helpWindow.isDestroyed()) {
    if (topic) {
      helpWindow.webContents.send('help:navigateTo', topic);
    }
    helpWindow.show();
    helpWindow.focus();
    return;
  }

  const appIcon = getAppIcon();

  helpWindow = new BrowserWindow({
    width: 1060,
    height: 740,
    minWidth: 800,
    minHeight: 520,
    title: 'Manual de Usuario - DiffCore Help',
    backgroundColor: '#181b20',
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (appIcon && process.platform !== 'darwin') {
    helpWindow.setIcon(appIcon);
  }

  helpWindow.loadFile(path.join(__dirname, '../renderer/help.html'), {
    query: topic ? { topic } : {}
  });

  helpWindow.on('closed', () => {
    helpWindow = null;
  });
}

// Local HTTP Server & File Exporter for external browser access
let helpHttpServer = null;
let helpHttpPort = null;

function ensureHelpHttpServer() {
  if (helpHttpServer && helpHttpPort) {
    return Promise.resolve(helpHttpPort);
  }
  return new Promise((resolve) => {
    helpHttpServer = http.createServer((req, res) => {
      let reqPath = (req.url || '').split('?')[0];
      if (!reqPath || reqPath === '/' || reqPath === '/help' || reqPath === '/help.html') {
        reqPath = 'help.html';
      } else if (reqPath.startsWith('/')) {
        reqPath = reqPath.slice(1);
      }

      const rendererDir = path.join(__dirname, '../renderer');
      const filePath = path.join(rendererDir, reqPath);
      if (!filePath.startsWith(rendererDir)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      let contentType = 'text/html; charset=utf-8';
      if (filePath.endsWith('.css')) contentType = 'text/css; charset=utf-8';
      else if (filePath.endsWith('.js')) contentType = 'application/javascript; charset=utf-8';
      else if (filePath.endsWith('.svg')) contentType = 'image/svg+xml';
      else if (filePath.endsWith('.png')) contentType = 'image/png';

      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
      });
    });

    helpHttpServer.listen(0, '127.0.0.1', () => {
      try {
        helpHttpPort = helpHttpServer.address().port;
        console.log(`[Help] Documentation web server running at http://127.0.0.1:${helpHttpPort}`);
        resolve(helpHttpPort);
      } catch (err) {
        console.error('[Help] Error getting server port:', err);
        resolve(null);
      }
    });

    helpHttpServer.on('error', (err) => {
      console.error('[Help] Error on documentation HTTP server:', err);
      resolve(null);
    });
  });
}

function getExtractedHelpUrl(topic = '') {
  try {
    const helpDir = path.join(app.getPath('userData'), 'help');
    const cssDir = path.join(helpDir, 'css');
    const jsDir = path.join(helpDir, 'js');
    fs.mkdirSync(cssDir, { recursive: true });
    fs.mkdirSync(jsDir, { recursive: true });

    const srcHelp = path.join(__dirname, '../renderer/help.html');
    const srcCss = path.join(__dirname, '../renderer/css/help.css');
    const srcJs = path.join(__dirname, '../renderer/js/help.js');

    const destHelp = path.join(helpDir, 'help.html');
    const destCss = path.join(cssDir, 'help.css');
    const destJs = path.join(jsDir, 'help.js');

    fs.writeFileSync(destHelp, fs.readFileSync(srcHelp));
    fs.writeFileSync(destCss, fs.readFileSync(srcCss));
    fs.writeFileSync(destJs, fs.readFileSync(srcJs));

    const fileUrl = url.pathToFileURL(destHelp);
    if (topic) fileUrl.searchParams.set('topic', topic);
    return fileUrl.href;
  } catch (err) {
    console.error('[Help] Error extracting help to userData:', err);
    return null;
  }
}

async function openHelpInBrowser(topic = '') {
  try {
    const port = await ensureHelpHttpServer();
    if (port) {
      const targetUrl = topic
        ? `http://127.0.0.1:${port}/help.html?topic=${encodeURIComponent(topic)}`
        : `http://127.0.0.1:${port}/help.html`;
      await shell.openExternal(targetUrl);
      return { success: true, url: targetUrl };
    }
  } catch (err) {
    console.warn('[Help] Could not launch HTTP server, using extracted file fallback:', err);
  }

  // Fallback: extract to userData folder where external browsers have full read access
  const fallbackUrl = getExtractedHelpUrl(topic);
  if (fallbackUrl) {
    await shell.openExternal(fallbackUrl);
    return { success: true, url: fallbackUrl };
  }

  return { success: false, error: 'Could not open help in browser' };
}

// Help IPC Handlers
ipcMain.handle('help:open', (_event, topic) => {
  openHelpWindow(topic);
  return { success: true };
});

ipcMain.handle('help:openInBrowser', async (_event, topic) => {
  return await openHelpInBrowser(topic);
});

module.exports = {
  openHelpWindow,
  openHelpInBrowser
};



