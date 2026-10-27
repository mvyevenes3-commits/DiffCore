#!/usr/bin/env node
/**
 * DiffCore RPM Packaging Script for Fedora / RHEL / openSUSE
 * Uses @goreleaser/nfpm to generate clean, native .rpm packages
 * for both x86_64 and aarch64 (ARM64) architectures.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'empaquetado', 'dist');

function run(cmd) {
  console.log(`\n▶ [RPM]: ${cmd}`);
  execSync(cmd, { cwd: ROOT_DIR, stdio: 'inherit' });
}

function buildRpmForArch(arch, unpackedDir, targetRpm, configFile) {
  if (!fs.existsSync(unpackedDir)) {
    console.log(`Generando binarios Linux desempacados para ${arch} (${path.basename(unpackedDir)})...`);
    const electronArch = (arch === 'aarch64') ? 'arm64' : 'x64';
    run(`npx electron-builder --linux dir --${electronArch}`);
  }

  const nfpmConfigPath = path.join(ROOT_DIR, 'empaquetado', configFile);
  const nfpmYaml = `name: "diffcore"
arch: "${arch}"
platform: "linux"
version: "1.0.0"
release: "1"
section: "devel"
maintainer: "Miguel Vergara <miguelvergara@diffcore.local>"
description: "DiffCore - High-Performance Cross-Platform Diff Suite"
vendor: "DiffCore"
homepage: "https://github.com/miguelvergara/diffcore"
license: "MIT"
contents:
  - src: ./empaquetado/dist/${path.basename(unpackedDir)}/
    dst: /opt/DiffCore
  - src: /opt/DiffCore/diffcore
    dst: /usr/bin/diffcore
    type: symlink
  - src: ./empaquetado/resources/diffcore.desktop
    dst: /usr/share/applications/diffcore.desktop
  - src: ./iconos/icons/16x16.png
    dst: /usr/share/icons/hicolor/16x16/apps/diffcore.png
  - src: ./iconos/icons/32x32.png
    dst: /usr/share/icons/hicolor/32x32/apps/diffcore.png
  - src: ./iconos/icons/48x48.png
    dst: /usr/share/icons/hicolor/48x48/apps/diffcore.png
  - src: ./iconos/icons/64x64.png
    dst: /usr/share/icons/hicolor/64x64/apps/diffcore.png
  - src: ./iconos/icons/128x128.png
    dst: /usr/share/icons/hicolor/128x128/apps/diffcore.png
  - src: ./iconos/icons/256x256.png
    dst: /usr/share/icons/hicolor/256x256/apps/diffcore.png
  - src: ./iconos/icons/512x512.png
    dst: /usr/share/icons/hicolor/512x512/apps/diffcore.png
`;

  fs.writeFileSync(nfpmConfigPath, nfpmYaml, 'utf8');

  console.log(`Compilando paquete RPM (${arch}) en: ${targetRpm}...`);
  run(`npx -y @goreleaser/nfpm package --packager rpm --config "${nfpmConfigPath}" --target "${targetRpm}"`);

  if (fs.existsSync(targetRpm)) {
    const stats = fs.statSync(targetRpm);
    const sizeMb = (stats.size / (1024 * 1024)).toFixed(1);
    console.log(`✅ Paquete RPM ${arch} generado con éxito: ${path.basename(targetRpm)} (${sizeMb} MB)`);
  } else {
    console.error(`❌ Error: No se encontró el archivo RPM generado para ${arch}.`);
  }
}

function main() {
  console.log('========================================================');
  console.log('📦 Empaquetado Fedora / RedHat / openSUSE (.rpm) [x86_64 y aarch64]');
  console.log('========================================================');

  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
  }

  // 1. Ensure diffcore.desktop exists
  const desktopFile = path.join(ROOT_DIR, 'empaquetado', 'resources', 'diffcore.desktop');
  if (!fs.existsSync(desktopFile)) {
    fs.mkdirSync(path.dirname(desktopFile), { recursive: true });
    fs.writeFileSync(desktopFile, `[Desktop Entry]
Name=DiffCore
Exec=/opt/DiffCore/diffcore %U
Terminal=false
Type=Application
Icon=diffcore
StartupWMClass=diffcore
Comment=DiffCore - High-Performance Cross-Platform Diff Suite
Categories=Development;
`);
  }

  // 2. Build x86_64 RPM
  buildRpmForArch('x86_64', path.join(DIST_DIR, 'linux-unpacked'), path.join(DIST_DIR, 'diffcore-1.0.0.x86_64.rpm'), 'nfpm.yaml');

  // 3. Build aarch64 RPM
  buildRpmForArch('aarch64', path.join(DIST_DIR, 'linux-arm64-unpacked'), path.join(DIST_DIR, 'diffcore-1.0.0.aarch64.rpm'), 'nfpm-arm64.yaml');
}

if (require.main === module) {
  main();
}

module.exports = { main };
