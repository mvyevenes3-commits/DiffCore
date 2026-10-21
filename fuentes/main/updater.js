const { app, ipcMain } = require('electron');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

let isUpdating = false;
let activeRequest = null;

/**
 * Fetches the latest release metadata from GitHub Releases API.
 */
function fetchLatestReleaseJson(repo = 'mvyevenes3-commits/DiffCore') {
  return new Promise((resolve, reject) => {
    function getReq(url, redirects = 0) {
      if (redirects > 5) return reject(new Error('Demasiadas redirecciones HTTP'));
      const options = {
        headers: {
          'User-Agent': 'DiffCore-App-Updater',
          'Accept': 'application/vnd.github.v3+json'
        }
      };
      const req = https.get(url, options, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return getReq(res.headers.location, redirects + 1);
        }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(e);
            }
          } else {
            reject(new Error(`GitHub API HTTP ${res.statusCode}`));
          }
        });
      });
      req.on('error', reject);
    }
    getReq(`https://api.github.com/repos/${repo}/releases/latest`);
  });
}

/**
 * Compares two semantic version strings (e.g. "1.0.1" vs "1.0.0").
 * Returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal.
 */
function compareVersions(v1, v2) {
  const clean = (v) => (v || '').replace(/^v/, '').trim().split('.').map(n => parseInt(n, 10) || 0);
  const p1 = clean(v1);
  const p2 = clean(v2);
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const a = p1[i] || 0;
    const b = p2[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

/**
 * Downloads a file from a URL with live progress reporting and HTTP redirect tracking.
 */
function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    function follow(currentUrl, redirectCount = 0) {
      if (redirectCount > 6) {
        return reject(new Error('Demasiadas redirecciones HTTP'));
      }

      const req = https.get(currentUrl, (res) => {
        // Follow 301, 302, 307, 308 redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return follow(res.headers.location, redirectCount + 1);
        }

        if (res.statusCode !== 200) {
          return reject(new Error(`Error del servidor al descargar (HTTP ${res.statusCode})`));
        }

        const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        let downloadedBytes = 0;
        let lastTime = Date.now();
        let lastBytes = 0;
        let speedMb = '0.0';

        const fileStream = fs.createWriteStream(destPath);

        res.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          const now = Date.now();
          if (now - lastTime >= 250) {
            const timeDiff = (now - lastTime) / 1000;
            if (timeDiff > 0) {
              speedMb = ((downloadedBytes - lastBytes) / timeDiff / (1024 * 1024)).toFixed(1);
            }
            lastTime = now;
            lastBytes = downloadedBytes;
            const percent = totalBytes > 0 ? Math.min(99, Math.round((downloadedBytes / totalBytes) * 100)) : 0;
            onProgress({
              status: 'downloading',
              percent,
              downloadedBytes,
              totalBytes,
              speedMb
            });
          }
        });

        res.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close(() => {
            onProgress({
              status: 'downloading',
              percent: 100,
              downloadedBytes: totalBytes || downloadedBytes,
              totalBytes: totalBytes || downloadedBytes,
              speedMb: '0.0'
            });
            resolve();
          });
        });

        fileStream.on('error', (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
      });

      req.on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });

      activeRequest = req;
    }

    follow(url);
  });
}

/**
 * Executes the update process:
 * 1. Downloads the DMG for the host architecture.
 * 2. Spawns a detached replacement script.
 * 3. Quits the current app so it can be replaced and reopened.
 */
async function startUpdate(mainWindow, force = false) {
  if (isUpdating) {
    return { success: false, error: 'Ya hay una actualización en curso' };
  }

  isUpdating = true;

  try {
    const currentVersion = app.getVersion() || '1.0.0';

    // 1. Informar al renderer que estamos comprobando actualizaciones
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:progress', {
        status: 'checking',
        currentVersion
      });
    }

    // 2. Consultar la última versión disponible en GitHub Releases
    let remoteRelease = null;
    try {
      remoteRelease = await fetchLatestReleaseJson('mvyevenes3-commits/DiffCore');
    } catch (apiErr) {
      console.warn('[Updater] No se pudo consultar la API de GitHub:', apiErr.message);
    }

    if (remoteRelease && remoteRelease.tag_name) {
      const remoteVersion = remoteRelease.tag_name.replace(/^v/, '').trim();
      const isNewer = compareVersions(remoteVersion, currentVersion) > 0;

      // Si la versión actual es igual o mayor a la remota (y no se forzó)
      if (!isNewer && !force) {
        isUpdating = false;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('updater:progress', {
            status: 'up-to-date',
            currentVersion,
            remoteVersion
          });
        }
        return { success: true, isLatest: true };
      }
    }

    // 3. Determinar el instalador DMG según arquitectura de la máquina
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    let targetVersion = (remoteRelease && remoteRelease.tag_name) ? remoteRelease.tag_name.replace(/^v/, '').trim() : '1.0.0';
    let downloadUrl = `https://github.com/mvyevenes3-commits/DiffCore/releases/download/${targetVersion}/DiffCore-${targetVersion}-${arch}.dmg`;

    // Si la release remota tiene assets específicos, buscar el DMG correspondiente
    if (remoteRelease && remoteRelease.assets && remoteRelease.assets.length > 0) {
      const match = remoteRelease.assets.find(a => a.name.includes(`-${arch}.dmg`) || (arch === 'x64' && a.name.includes('x64.dmg')) || (arch === 'arm64' && a.name.includes('arm64.dmg')));
      if (match && match.browser_download_url) {
        downloadUrl = match.browser_download_url;
      }
    }

    const dmgName = `DiffCore-${targetVersion}-${arch}.dmg`;
    const tempDmgPath = path.join('/tmp', dmgName);

    mainWindow.webContents.send('updater:progress', {
      status: 'downloading',
      percent: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      speedMb: '0.0',
      targetVersion
    });

    await downloadFile(downloadUrl, tempDmgPath, (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('updater:progress', { ...progress, targetVersion });
      }
    });

    // Notify that download is complete and installation is beginning
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:progress', {
        status: 'installing',
        percent: 100,
        targetVersion
      });
    }

    // Detached background bash script: mounts DMG, replaces /Applications/DiffCore.app, and relaunches
    const helperScript = `
sleep 1.2
TMP_DMG="${tempDmgPath}"
MOUNT_DIR="/tmp/diffcore-mount-$$"
mkdir -p "$MOUNT_DIR"
if hdiutil attach "$TMP_DMG" -mountpoint "$MOUNT_DIR" -nobrowse -quiet; then
  rm -rf /Applications/DiffCore.app
  cp -R "$MOUNT_DIR/DiffCore.app" /Applications/
  hdiutil detach "$MOUNT_DIR" -quiet || true
  rm -rf "$MOUNT_DIR" "$TMP_DMG"
  xattr -cr /Applications/DiffCore.app 2>/dev/null || true
  open /Applications/DiffCore.app
fi
`;

    const child = spawn('/bin/bash', ['-c', helperScript], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();

    // Give renderer 800ms to show the final message, then quit DiffCore cleanly
    setTimeout(() => {
      app.quit();
    }, 800);

    return { success: true };
  } catch (err) {
    console.error('[Updater] Error during update:', err);
    isUpdating = false;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:progress', {
        status: 'error',
        error: err.message
      });
    }
    return { success: false, error: err.message };
  }
}

function cancelUpdate() {
  if (activeRequest) {
    try {
      activeRequest.destroy();
    } catch {}
    activeRequest = null;
  }
  isUpdating = false;
}

function setupUpdaterIPC(mainWindow) {
  ipcMain.handle('updater:start', async (_event, force = false) => {
    return await startUpdate(mainWindow, force);
  });

  ipcMain.handle('updater:cancel', () => {
    cancelUpdate();
    return { success: true };
  });
}

module.exports = {
  startUpdate,
  cancelUpdate,
  setupUpdaterIPC
};
