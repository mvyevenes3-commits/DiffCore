/**
 * DiffCore Archive Handler (.jar, .war, .ear, .zip)
 * Transparently unpacks and virtualizes archives as folders
 * for seamless side-by-side comparison in Folder Compare.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

const ARCHIVE_EXTENSIONS = new Set(['.jar', '.war', '.ear', '.zip']);
const archiveMap = new Map(); // expandedPath -> originalPath

/**
 * Checks if a path represents an archive container
 */
function isArchiveFile(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  const ext = path.extname(filePath).toLowerCase();
  if (ARCHIVE_EXTENSIONS.has(ext)) return true;

  // Magic bytes check for ZIP: PK\x03\x04
  try {
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      if (stat.isFile() && stat.size >= 4) {
        const fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(4);
        fs.readSync(fd, buf, 0, 4, 0);
        fs.closeSync(fd);
        if (buf[0] === 0x50 && buf[1] === 0x4B && buf[2] === 0x03 && buf[3] === 0x04) {
          return true;
        }
      }
    }
  } catch (_) {}
  return false;
}

/**
 * Expands an archive to a secure temporary directory and returns its folder path.
 * Caches the extracted files using hash and mtime to avoid re-extracting unchanged archives.
 * @param {string} archivePath 
 * @returns {{isArchive: boolean, originalPath: string, expandedPath: string, label: string}}
 */
function resolveFolderOrArchive(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') {
    return { isArchive: false, originalPath: '', expandedPath: '', label: '' };
  }

  const resolved = path.resolve(targetPath);
  if (!fs.existsSync(resolved)) {
    return { isArchive: false, originalPath: resolved, expandedPath: resolved, label: path.basename(resolved) };
  }

  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    return { isArchive: false, originalPath: resolved, expandedPath: resolved, label: path.basename(resolved) };
  }

  if (!isArchiveFile(resolved)) {
    return { isArchive: false, originalPath: resolved, expandedPath: resolved, label: path.basename(resolved) };
  }

  // It is an archive (.jar, .war, .ear, .zip) -> extract to cache
  const hashKey = crypto.createHash('sha256').update(`${resolved}:${stat.mtimeMs}:${stat.size}`).digest('hex').substring(0, 16);
  const tempBase = path.join(os.tmpdir(), 'diffcore-archives', `${path.basename(resolved)}-${hashKey}`);

  if (!fs.existsSync(tempBase) || fs.readdirSync(tempBase).length === 0) {
    fs.mkdirSync(tempBase, { recursive: true });
    try {
      const zip = new AdmZip(resolved);
      zip.extractAllTo(tempBase, true);
    } catch (err) {
      console.warn(`[ArchiveHandler] Failed to extract archive ${resolved}:`, err.message);
      return { isArchive: true, originalPath: resolved, expandedPath: resolved, label: path.basename(resolved), error: err.message };
    }
  }

  archiveMap.set(tempBase, resolved);

  return {
    isArchive: true,
    originalPath: resolved,
    expandedPath: tempBase,
    label: path.basename(resolved)
  };
}

/**
 * Returns the original archive path if the given path is located inside an expanded archive
 */
function getOriginalPath(targetPath) {
  if (!targetPath) return targetPath;
  for (const [expanded, orig] of archiveMap.entries()) {
    if (targetPath === expanded || targetPath.startsWith(expanded + path.sep)) {
      const rel = path.relative(expanded, targetPath);
      return path.join(orig, rel);
    }
  }
  return targetPath;
}

function cleanupTempArchives() {
  try {
    const baseDir = path.join(os.tmpdir(), 'diffcore-archives');
    if (fs.existsSync(baseDir)) {
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  } catch (_) {}
}

module.exports = {
  isArchiveFile,
  resolveFolderOrArchive,
  getOriginalPath,
  cleanupTempArchives
};
