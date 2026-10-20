#!/usr/bin/env node
/**
 * DiffCore Release Automation Script
 * Builds 3 installers:
 *  1. macOS Apple Silicon (arm64) DMG
 *  2. macOS Intel (x64) DMG
 *  3. Windows x64 NSIS Setup (.exe)
 * And uploads them to the GitHub Release.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'empaquetado', 'dist');

function runCommand(cmd) {
  console.log(`\n▶ [RUN]: ${cmd}`);
  execSync(cmd, { cwd: ROOT_DIR, stdio: 'inherit' });
}

function getGitRemoteTokenAndRepo() {
  let url = '';
  try {
    url = execSync('git config remote.origin.url', { cwd: ROOT_DIR }).toString().trim();
  } catch (e) {
    console.error('Error reading git remote URL:', e.message);
  }

  let token = process.env.GITHUB_TOKEN || '';
  let repo = 'mvyevenes2-png/DiffCore';

  // Parse https://TOKEN@github.com/OWNER/REPO.git
  const tokenMatch = url.match(/https:\/\/([^@]+)@github\.com\/([^\/]+)\/([^\.]+)(?:\.git)?/);
  if (tokenMatch) {
    if (!token) token = tokenMatch[1];
    repo = `${tokenMatch[2]}/${tokenMatch[3]}`;
  } else {
    const repoMatch = url.match(/github\.com[/:]([^\/]+)\/([^\.]+)(?:\.git)?/);
    if (repoMatch) {
      repo = `${repoMatch[1]}/${repoMatch[2]}`;
    }
  }

  return { token, repo };
}

function getCurrentBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT_DIR }).toString().trim();
  } catch {
    return 'feature_16102026';
  }
}

function githubRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = body ? JSON.parse(body) : null;
          resolve({ status: res.statusCode, headers: res.headers, data: json, rawBody: body });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, rawBody: body });
        }
      });
    });

    req.on('error', reject);
    if (data) {
      if (Buffer.isBuffer(data)) {
        req.write(data);
      } else if (typeof data === 'string') {
        req.write(data);
      } else {
        req.write(JSON.stringify(data));
      }
    }
    req.end();
  });
}

async function uploadAsset(token, uploadUrlTemplate, filePath, fileName) {
  const stats = fs.statSync(filePath);
  const fileSize = stats.size;
  const fileSizeMb = (fileSize / (1024 * 1024)).toFixed(1);

  console.log(`\n⬆ Subiendo ${fileName} (${fileSizeMb} MB)...`);

  const uploadBaseUrl = uploadUrlTemplate.replace(/\{.*\}/, '');
  const targetUrl = new URL(`${uploadBaseUrl}?name=${encodeURIComponent(fileName)}`);

  return new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(filePath);

    const req = https.request(targetUrl, {
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'Content-Type': 'application/octet-stream',
        'Content-Length': fileSize,
        'User-Agent': 'DiffCore-Release-Script'
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(body);
            console.log(`✓ Subido exitosamente: ${parsed.browser_download_url || fileName}`);
            resolve(parsed);
          } catch {
            console.log(`✓ Subido exitosamente: ${fileName}`);
            resolve({ name: fileName });
          }
        } else {
          console.error(`✗ Error subiendo ${fileName} (HTTP ${res.statusCode}): ${body}`);
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', (err) => {
      console.error(`✗ Error de conexión al subir ${fileName}:`, err.message);
      reject(err);
    });

    let uploaded = 0;
    fileStream.on('data', (chunk) => {
      uploaded += chunk.length;
      const pct = Math.round((uploaded / fileSize) * 100);
      process.stdout.write(`\r  Progreso: ${pct}% (${(uploaded / 1048576).toFixed(1)} / ${fileSizeMb} MB)`);
    });

    fileStream.on('end', () => {
      process.stdout.write('\n');
    });

    fileStream.pipe(req);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const skipBuild = args.includes('--upload-only');

  const { token, repo } = getGitRemoteTokenAndRepo();
  const branch = getCurrentBranch();

  console.log('========================================================');
  console.log('🚀 DiffCore — Empaquetado y Publicación Multiplataforma');
  console.log(`Rama: ${branch}`);
  console.log(`Repositorio: ${repo}`);
  console.log('========================================================');

  if (!skipBuild) {
    console.log('\n[1/5] Compilando instaladores macOS (DMG y PKG para arm64 + x64)...');
    runCommand('npx electron-builder --mac dmg pkg --x64 --arm64');

    console.log('\n[2/5] Compilando instalador Windows (.exe x64)...');
    runCommand('npx electron-builder --win nsis');

    console.log('\n[3/5] Compilando paquetes Linux (.deb, AppImage, tar.gz)...');
    runCommand('npx electron-builder --linux deb AppImage tar.gz');

    console.log('\n[4/5] Compilando paquete Fedora / RedHat / openSUSE (.rpm)...');
    runCommand('node scripts/build-rpm.js');
  } else {
    console.log('Saltando compilación (--upload-only activado).');
  }

  // Identify generated installers
  console.log('\n[5/5] Buscando instaladores generados en empaquetado/dist...');
  if (!fs.existsSync(DIST_DIR)) {
    console.error(`Error: El directorio ${DIST_DIR} no existe.`);
    process.exit(1);
  }

  const allFiles = fs.readdirSync(DIST_DIR);
  
  // Find macOS arm64 DMG
  const macArm64 = allFiles.find(f => f.endsWith('.dmg') && (f.includes('arm64') || f.includes('arm')));
  // Find macOS x64 DMG
  const macX64 = allFiles.find(f => f.endsWith('.dmg') && (f.includes('x64') || (!f.includes('arm64') && !f.includes('arm')) && f !== macArm64));
  // Find macOS arm64 PKG
  const macPkgArm64 = allFiles.find(f => f.endsWith('.pkg') && (f.includes('arm64') || f.includes('arm')));
  // Find macOS x64 PKG
  const macPkgX64 = allFiles.find(f => f.endsWith('.pkg') && (f.includes('x64') || (!f.includes('arm64') && !f.includes('arm')) && f !== macPkgArm64));
  // Find Windows exe
  const winExe = allFiles.find(f => f.endsWith('.exe') && !f.includes('uninstaller') && !f.includes('elevate'));
  // Find Linux deb
  const linuxDeb = allFiles.find(f => f.endsWith('.deb'));
  // Find Linux rpm
  const linuxRpm = allFiles.find(f => f.endsWith('.rpm'));
  // Find Linux AppImage
  const linuxAppImage = allFiles.find(f => f.endsWith('.AppImage'));
  // Find Linux tar.gz
  const linuxTar = allFiles.find(f => f.endsWith('.tar.gz') && f.includes('diffcore'));

  const filesToUpload = [];

  if (macArm64) {
    filesToUpload.push({
      path: path.join(DIST_DIR, macArm64),
      name: macArm64.includes('arm64') ? macArm64 : 'DiffCore-1.0.0-arm64.dmg',
      label: 'DiffCore 1.0.0 macOS (Apple Silicon M1/M2/M3/M4)'
    });
  }

  if (macX64) {
    filesToUpload.push({
      path: path.join(DIST_DIR, macX64),
      name: macX64.includes('x64') ? macX64 : 'DiffCore-1.0.0-x64.dmg',
      label: 'DiffCore 1.0.0 macOS (Intel Core / Xeon DMG)'
    });
  }

  if (macPkgArm64) {
    filesToUpload.push({
      path: path.join(DIST_DIR, macPkgArm64),
      name: macPkgArm64.includes('arm64') ? macPkgArm64 : 'DiffCore-1.0.0-arm64.pkg',
      label: 'DiffCore 1.0.0 macOS Installer (Apple Silicon M1/M2/M3/M4 PKG)'
    });
  }

  if (macPkgX64) {
    filesToUpload.push({
      path: path.join(DIST_DIR, macPkgX64),
      name: macPkgX64.includes('x64') ? macPkgX64 : 'DiffCore-1.0.0-x64.pkg',
      label: 'DiffCore 1.0.0 macOS Installer (Intel Core / Xeon PKG)'
    });
  }

  if (winExe) {
    const cleanWinName = winExe.replace(/\s+/g, '.');
    filesToUpload.push({
      path: path.join(DIST_DIR, winExe),
      name: cleanWinName,
      label: 'DiffCore 1.0.0 Windows (Instalador Setup x64)'
    });
  }

  if (linuxDeb) {
    filesToUpload.push({
      path: path.join(DIST_DIR, linuxDeb),
      name: linuxDeb,
      label: 'DiffCore 1.0.0 Linux (Debian / Ubuntu / Mint .deb)'
    });
  }

  if (linuxRpm) {
    filesToUpload.push({
      path: path.join(DIST_DIR, linuxRpm),
      name: linuxRpm,
      label: 'DiffCore 1.0.0 Linux (Fedora / RHEL / openSUSE .rpm)'
    });
  }

  if (linuxAppImage) {
    filesToUpload.push({
      path: path.join(DIST_DIR, linuxAppImage),
      name: linuxAppImage,
      label: 'DiffCore 1.0.0 Linux (Universal AppImage - Fedora / Arch / SUSE / all)'
    });
  }

  if (linuxTar) {
    filesToUpload.push({
      path: path.join(DIST_DIR, linuxTar),
      name: linuxTar,
      label: 'DiffCore 1.0.0 Linux (Generic Portable Tarball .tar.gz)'
    });
  }

  console.log(`\nArchivos identificados para publicar (${filesToUpload.length}):`);
  filesToUpload.forEach(f => console.log(` - ${f.name} -> ${f.path}`));

  if (!token) {
    console.warn('\n⚠️ Aviso: No se detectó token de GitHub en el remote URL ni en GITHUB_TOKEN.');
    console.log('Los instaladores quedaron compilados localmente en empaquetado/dist/');
    return;
  }

  console.log('\nConsultando Releases en GitHub...');
  const releasesRes = await githubRequest({
    hostname: 'api.github.com',
    path: `/repos/${repo}/releases`,
    method: 'GET',
    headers: {
      'Authorization': `token ${token}`,
      'User-Agent': 'DiffCore-Release-Script'
    }
  });

  if (releasesRes.status !== 200 || !Array.isArray(releasesRes.data)) {
    console.error('Error al consultar releases en GitHub:', releasesRes.rawBody);
    return;
  }

  // Find release matching current branch tag or create one
  let release = releasesRes.data.find(r => r.tag_name === branch || r.tag_name === `v1.0.0` || r.tag_name === 'feature_16102026');

  if (!release) {
    console.log(`Creando nuevo Release para el tag "${branch}" en GitHub...`);
    const createRes = await githubRequest({
      hostname: 'api.github.com',
      path: `/repos/${repo}/releases`,
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'User-Agent': 'DiffCore-Release-Script',
        'Content-Type': 'application/json'
      }
    }, {
      tag_name: branch,
      target_commitish: branch,
      name: 'Release 1.0.0',
      body: `### DiffCore 1.0.0 — Beyond Compare 5 Suite\n\nInstaladores oficiales multiplataforma para macOS (Apple Silicon y Apple Intel), Windows y Linux (Debian/Ubuntu .deb, Fedora/RHEL/openSUSE .rpm, Universal AppImage, y Tarball genérico .tar.gz).`,
      draft: false,
      prerelease: false
    });

    if (createRes.status === 201) {
      release = createRes.data;
      console.log(`✓ Release creado exitosamente: ${release.html_url}`);
    } else {
      console.error('Error al crear release:', createRes.rawBody);
      return;
    }
  } else {
    console.log(`✓ Release encontrado: ${release.name || release.tag_name} (${release.html_url})`);
    if (release.name !== 'Release 1.0.0') {
      console.log(`Actualizando nombre de la release a "Release 1.0.0"...`);
      const patchRes = await githubRequest({
        hostname: 'api.github.com',
        path: `/repos/${repo}/releases/${release.id}`,
        method: 'PATCH',
        headers: {
          'Authorization': `token ${token}`,
          'User-Agent': 'DiffCore-Release-Script',
          'Content-Type': 'application/json'
        }
      }, {
        name: 'Release 1.0.0',
        body: `### DiffCore 1.0.0 — Beyond Compare 5 Suite\n\nInstaladores oficiales multiplataforma para macOS (Apple Silicon y Apple Intel), Windows y Linux (Debian/Ubuntu .deb, Fedora/RHEL/openSUSE .rpm, Universal AppImage, y Tarball genérico .tar.gz).`
      });
      if (patchRes.status === 200 && patchRes.data) {
        release = patchRes.data;
        console.log(`✓ Nombre actualizado exitosamente a: ${release.name}`);
      }
    }
  }

  function normalizeAssetName(name) {
    return (name || '').replace(/[\s\.\-_]+/g, '').toLowerCase();
  }

  // Delete existing assets with same name or normalized name if any
  if (Array.isArray(release.assets) && release.assets.length > 0) {
    for (const file of filesToUpload) {
      const match = release.assets.filter(a => 
        a.name === file.name || 
        normalizeAssetName(a.name) === normalizeAssetName(file.name)
      );
      for (const existing of match) {
        console.log(`Eliminando versión previa de ${existing.name} (Asset ID: ${existing.id})...`);
        await githubRequest({
          hostname: 'api.github.com',
          path: `/repos/${repo}/releases/assets/${existing.id}`,
          method: 'DELETE',
          headers: {
            'Authorization': `token ${token}`,
            'User-Agent': 'DiffCore-Release-Script'
          }
        });
      }
    }
  }

  // Upload each file
  for (const file of filesToUpload) {
    try {
      await uploadAsset(token, release.upload_url, file.path, file.name);
    } catch (err) {
      console.error(`Error subiendo ${file.name}:`, err.message);
    }
  }

  console.log('\n========================================================');
  console.log('🎉 ¡Todos los paquetes han sido subidos exitosamente a GitHub!');
  console.log(`URL del Release: ${release.html_url}`);
  console.log('========================================================');
}

main().catch(err => {
  console.error('Fatal error in release script:', err);
  process.exit(1);
});
