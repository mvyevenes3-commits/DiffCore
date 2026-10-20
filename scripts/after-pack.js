const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * electron-builder afterPack hook
 * Ensures the macOS application bundle is signed with an ad-hoc cryptographic signature
 * preventing the "Damaged and can't be opened / Mover al basurero" error on macOS.
 */
exports.default = async function (context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);

  if (!fs.existsSync(appPath)) {
    console.warn(`[afterPack] Warning: ${appPath} does not exist`);
    return;
  }

  console.log(`\n🔏 [afterPack] Aplicando firma ad-hoc (codesign --force --deep -s -) a: ${appPath}`);
  try {
    execSync(`codesign --force --deep -s - "${appPath}"`, { stdio: 'inherit' });
    console.log(`✓ [afterPack] Firma ad-hoc completada exitosamente.`);
  } catch (err) {
    console.error(`✗ [afterPack] Error aplicando codesign:`, err.message);
  }
};
