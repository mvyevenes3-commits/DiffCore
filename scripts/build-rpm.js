#!/usr/bin/env node
/**
 * DiffCore RPM Packaging Script for Fedora / RHEL / openSUSE
 * Uses @goreleaser/nfpm to generate clean, native .rpm packages
 * without external host dependencies (zero Darwin rpmbuild crashes).
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'empaquetado', 'dist');
const LINUX_UNPACKED = path.join(DIST_DIR, 'linux-unpacked');
const TARGET_RPM = path.join(DIST_DIR, 'diffcore-1.0.0.x86_64.rpm');

function run(cmd) {
  console.log(`\n▶ [RPM]: ${cmd}`);
  execSync(cmd, { cwd: ROOT_DIR, stdio: 'inherit' });
}

function main() {
  console.log('========================================================');
  console.log('📦 Empaquetado Fedora / RedHat / openSUSE (.rpm)');
  console.log('========================================================');

  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
  }

  // 1. Ensure linux-unpacked exists
  if (!fs.existsSync(LINUX_UNPACKED)) {
    console.log('Generando binarios Linux desempacados (linux-unpacked)...');
    run('npx electron-builder --linux dir');
  }

  // 2. Ensure diffcore.desktop exists
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
Comment=Beyond Compare 5 Clone - High-Performance Cross-Platform Diff Suite
Categories=Development;
`);
  }

  // 3. Build nfpm configuration
  const nfpmConfigPath = path.join(ROOT_DIR, 'empaquetado', 'nfpm.yaml');
  const nfpmYaml = `name: "diffcore"
arch: "x86_64"
platform: "linux"
version: "1.0.0"
release: "1"
section: "devel"
maintainer: "Miguel Vergara <miguelvergara@diffcore.local>"
description: "Beyond Compare 5 Clone - High-Performance Cross-Platform Diff Suite"
vendor: "DiffCore"
homepage: "https://github.com/miguelvergara/diffcore"
license: "MIT"
contents:
  - src: ./empaquetado/dist/linux-unpacked/
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

  // 4. Run nfpm packager
  console.log(`Compilando paquete RPM en: ${TARGET_RPM}...`);
  run(`npx -y @goreleaser/nfpm package --packager rpm --config "${nfpmConfigPath}" --target "${TARGET_RPM}"`);

  if (fs.existsSync(TARGET_RPM)) {
    const stats = fs.statSync(TARGET_RPM);
    const sizeMb = (stats.size / (1024 * 1024)).toFixed(1);
    console.log(`\n✅ Paquete RPM generado con éxito: diffcore-1.0.0.x86_64.rpm (${sizeMb} MB)`);
  } else {
    console.error('\n❌ Error: No se encontró el archivo RPM generado.');
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
