const { app, ipcMain } = require('electron');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

let isUpdating = false;
let activeRequest = null;

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
async function startUpdate(mainWindow) {
  if (isUpdating) {
    return { success: false, error: 'Ya hay una actualización en curso' };
  }

  isUpdating = true;

  /*
  // =========================================================================
  // TODO: VALIDACIÓN AUTOMÁTICA DE VERSIONES (Comentado para pruebas locales)
  // Cuando se publiquen versiones incrementales en GitHub Releases, descomentar:
  // =========================================================================
  // const currentVersion = app.getVersion();
  // const remoteRelease = await fetchLatestReleaseJson();
  // if (remoteRelease.tag_name === `v${currentVersion}` || remoteRelease.tag_name === currentVersion) {
  //   mainWindow.webContents.send('updater:noUpdateAvailable');
  //   isUpdating = false;
  //   return { success: true, updated: false };
  // }
  // =========================================================================
  */

  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const dmgName = `DiffCore-1.0.0-${arch}.dmg`;
  const downloadUrl = `https://github.com/mvyevenes3-commits/DiffCore/releases/download/1.0.0/${dmgName}`;
  const tempDmgPath = path.join('/tmp', dmgName);

  try {
    mainWindow.webContents.send('updater:progress', {
      status: 'downloading',
      percent: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      speedMb: '0.0'
    });

    await downloadFile(downloadUrl, tempDmgPath, (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('updater:progress', progress);
      }
    });

    // Notify that download is complete and installation is beginning
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:progress', {
        status: 'installing',
        percent: 100
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
  ipcMain.handle('updater:start', async () => {
    return await startUpdate(mainWindow);
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
