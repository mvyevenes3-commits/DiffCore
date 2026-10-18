const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// CRC32 calculation table
const CRC32_TABLE = new Int32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (-306674912 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC32_TABLE[i] = c;
}

function calculateCRC32(buffer) {
  if (zlib.crc32) {
    return (zlib.crc32(buffer) >>> 0).toString(16).toUpperCase().padStart(8, '0');
  }
  let crc = -1;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC32_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return ((crc ^ (-1)) >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

/**
 * Fast scan directory recursively with accumulator array
 */
function scanDirectory(dirPath, relativeRoot = '', acc = []) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.name === '.DS_Store' || entry.name === 'Thumbs.db') continue;

      const relPath = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
      const fullPath = path.join(dirPath, entry.name);
      const isDir = entry.isDirectory();

      let size = 0;
      let mtime = null;

      try {
        if (!isDir) {
          const stats = fs.statSync(fullPath);
          size = stats.size;
          mtime = stats.mtime;
          mode = stats.mode;
          uid = stats.uid;
          gid = stats.gid;
        } else {
          mtime = new Date();
        }

        acc.push({
          name: entry.name,
          relativePath: relPath,
          fullPath: fullPath,
          isDirectory: isDir,
          size: size,
          mtime: mtime,
          mode: mode || 0,
          uid: uid ?? 0,
          gid: gid ?? 0
        });

        if (isDir) {
          scanDirectory(fullPath, relPath, acc);
        }
      } catch (err) {
        // Skip inaccessible item
      }
    }
  } catch (err) {
    // Directory error
  }
  return acc;
}

/**
 * High-performance asynchronous non-blocking directory scanner
 */
async function scanDirectoryAsync(dirPath, relativeRoot = '', acc = []) {
  if (!dirPath) return acc;
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    const subdirs = [];
    const statPromises = [];

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.name === '.DS_Store' || entry.name === 'Thumbs.db') continue;

      const relPath = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
      const fullPath = path.join(dirPath, entry.name);
      const isDir = entry.isDirectory();

      if (isDir) {
        acc.push({
          name: entry.name,
          relativePath: relPath,
          fullPath: fullPath,
          isDirectory: true,
          size: 0,
          mtime: new Date()
        });
        subdirs.push({ fullPath, relPath });
      } else {
        statPromises.push(
          fs.promises.stat(fullPath)
            .then(stats => {
              acc.push({
                name: entry.name,
                relativePath: relPath,
                fullPath: fullPath,
                isDirectory: false,
                size: stats.size,
                mtime: stats.mtime,
                mode: stats.mode || 0,
                uid: stats.uid ?? 0,
                gid: stats.gid ?? 0
              });
            })
            .catch(() => {})
        );
      }
    }

    if (statPromises.length > 0) {
      await Promise.all(statPromises);
    }

    if (subdirs.length > 0) {
      await Promise.all(subdirs.map(sub => scanDirectoryAsync(sub.fullPath, sub.relPath, acc)));
    }
  } catch (err) {
    // Directory error
  }
  return acc;
}

/**
 * Fast equality check without reading full huge files
 */
function areFilesFastEqual(f1, f2, size) {
  if (size === 0) return true;
  try {
    // Small files (<= 64KB): read and compare
    if (size <= 65536) {
      const b1 = fs.readFileSync(f1);
      const b2 = fs.readFileSync(f2);
      if (b1.equals(b2)) return true;
      const t1 = b1.toString('utf8').replace(/\r\n/g, '\n');
      const t2 = b2.toString('utf8').replace(/\r\n/g, '\n');
      return t1 === t2;
    }

    // Larger files: sample first 4KB and last 4KB
    const fd1 = fs.openSync(f1, 'r');
    const fd2 = fs.openSync(f2, 'r');
    const buf1 = Buffer.alloc(4096);
    const buf2 = Buffer.alloc(4096);

    const r1 = fs.readSync(fd1, buf1, 0, 4096, 0);
    const r2 = fs.readSync(fd2, buf2, 0, 4096, 0);
    if (r1 !== r2 || !buf1.subarray(0, r1).equals(buf2.subarray(0, r2))) {
      fs.closeSync(fd1);
      fs.closeSync(fd2);
      return false;
    }

    const tailPos = Math.max(0, size - 4096);
    fs.readSync(fd1, buf1, 0, 4096, tailPos);
    fs.readSync(fd2, buf2, 0, 4096, tailPos);
    fs.closeSync(fd1);
    fs.closeSync(fd2);
    return buf1.equals(buf2);
  } catch {
    return false;
  }
}

function areFilesEqual(f1, f2, size) {
  return areFilesFastEqual(f1, f2, size);
}

/**
 * High-performance Beyond Compare 5 Folder Compare Engine
 */
function compareFolderTrees(leftDir, rightDir) {
  const leftItems = leftDir ? scanDirectory(leftDir, '', []) : [];
  const rightItems = rightDir ? scanDirectory(rightDir, '', []) : [];

  const leftMap = new Map();
  for (let i = 0; i < leftItems.length; i++) {
    leftMap.set(leftItems[i].relativePath, leftItems[i]);
  }

  const rightMap = new Map();
  for (let i = 0; i < rightItems.length; i++) {
    rightMap.set(rightItems[i].relativePath, rightItems[i]);
  }

  const allRelPaths = new Set([...leftMap.keys(), ...rightMap.keys()]);
  const sortedPaths = Array.from(allRelPaths).sort();

  const comparison = [];

  for (let pIdx = 0; pIdx < sortedPaths.length; pIdx++) {
    const relPath = sortedPaths[pIdx];
    const left = leftMap.get(relPath);
    const right = rightMap.get(relPath);

    let status = 'identical'; // 'identical', 'different', 'orphan_left', 'orphan_right'

    if (left && !right) {
      status = 'orphan_left';
    } else if (!left && right) {
      status = 'orphan_right';
    } else {
      // Both exist
      if (left.isDirectory !== right.isDirectory) {
        status = 'different';
      } else if (!left.isDirectory) {
        if (left.size !== right.size) {
          status = 'different';
        } else {
          // Beyond Compare 5 Quick Compare:
          // If sizes and timestamps match within 2s, identical (zero disk read)
          const timeDiff = Math.abs((left.mtime ? left.mtime.getTime() : 0) - (right.mtime ? right.mtime.getTime() : 0));
          if (timeDiff <= 2000) {
            status = 'identical';
          } else {
            // Fast sample check
            status = areFilesFastEqual(left.fullPath, right.fullPath, left.size) ? 'identical' : 'different';
          }
        }
      }
    }

    comparison.push({
      relativePath: relPath,
      name: (left || right).name,
      isDirectory: (left || right).isDirectory,
      status,
      left: left ? {
        name: left.name,
        size: left.size,
        modified: left.mtime ? left.mtime.toISOString() : null,
        fullPath: left.fullPath
      } : null,
      right: right ? {
        name: right.name,
        size: right.size,
        modified: right.mtime ? right.mtime.toISOString() : null,
        fullPath: right.fullPath
      } : null
    });
  }

  return comparison;
}

/**
 * High-performance non-blocking asynchronous Beyond Compare 5 Folder Compare Engine
 * Powered by Beyond Compare Rules (Quick tests & File opening comparisons)
 */
async function compareFolderTreesAsync(leftDir, rightDir, rules = {}) {
  const [leftItems, rightItems] = await Promise.all([
    leftDir ? scanDirectoryAsync(leftDir, '', []) : Promise.resolve([]),
    rightDir ? scanDirectoryAsync(rightDir, '', []) : Promise.resolve([])
  ]);

  const compareFileSize = rules.compareFileSize !== false;
  const compareTimestamps = rules.compareTimestamps !== false;
  const timestampTolerance = (typeof rules.timestampTolerance === 'number' && !isNaN(rules.timestampTolerance)) ? rules.timestampTolerance : 2;
  const toleranceMs = timestampTolerance * 1000;
  const ignoreDST = !!rules.ignoreDST;
  const ignoreTimezone = !!rules.ignoreTimezone;
  const compareFilenameCase = !!rules.compareFilenameCase;
  const alignDifferentExtensions = !!rules.alignDifferentExtensions;
  const alignUnicodeNorm = rules.alignUnicodeNorm !== false;
  const comparePermissions = !!rules.comparePermissions;
  const compareOwner = !!rules.compareOwner;
  const compareGroup = !!rules.compareGroup;
  const compareContents = !!rules.compareContents;
  const contentMethod = rules.contentMethod || 'rules';
  const skipIfQuickSame = !!rules.skipIfQuickSame;
  const overrideQuickTests = rules.overrideQuickTests !== false;

  const normalizePath = (p) => alignUnicodeNorm ? p.normalize('NFC') : p;

  const leftMap = new Map();
  const leftItemsByNorm = [];
  for (let i = 0; i < leftItems.length; i++) {
    const item = leftItems[i];
    const nPath = normalizePath(item.relativePath);
    item.normalizedPath = nPath;
    leftMap.set(nPath, item);
    leftItemsByNorm.push(item);
  }

  const rightMap = new Map();
  const rightItemsByNorm = [];
  for (let i = 0; i < rightItems.length; i++) {
    const item = rightItems[i];
    const nPath = normalizePath(item.relativePath);
    item.normalizedPath = nPath;
    rightMap.set(nPath, item);
    rightItemsByNorm.push(item);
  }

  // Case-insensitive lookup map if compareFilenameCase is false
  const rightCaseMap = new Map();
  if (!compareFilenameCase) {
    for (let i = 0; i < rightItemsByNorm.length; i++) {
      const it = rightItemsByNorm[i];
      rightCaseMap.set(it.normalizedPath.toLowerCase(), it);
    }
  }

  const allRelPaths = new Set([...leftMap.keys(), ...rightMap.keys()]);
  const sortedPaths = Array.from(allRelPaths).sort();

  const comparison = [];

  for (let pIdx = 0; pIdx < sortedPaths.length; pIdx++) {
    const relPath = sortedPaths[pIdx];
    let left = leftMap.get(relPath);
    let right = rightMap.get(relPath);

    if (!right && !compareFilenameCase && left) {
      right = rightCaseMap.get(relPath.toLowerCase());
    }

    let status = 'identical'; // 'identical', 'different', 'orphan_left', 'orphan_right'

    if (left && !right) {
      status = 'orphan_left';
    } else if (!left && right) {
      status = 'orphan_right';
    } else {
      // Both exist
      if (left.isDirectory !== right.isDirectory) {
        status = 'different';
      } else if (!left.isDirectory) {
        let quickMatches = true;

        // 1. File size test
        if (compareFileSize) {
          if (left.size !== right.size) {
            quickMatches = false;
          }
        }

        // 2. Timestamps test
        if (quickMatches && compareTimestamps) {
          const t1 = left.mtime ? (left.mtime instanceof Date ? left.mtime.getTime() : new Date(left.mtime).getTime()) : 0;
          const t2 = right.mtime ? (right.mtime instanceof Date ? right.mtime.getTime() : new Date(right.mtime).getTime()) : 0;
          const diffMs = Math.abs(t1 - t2);

          let timeMatches = false;
          if (diffMs <= toleranceMs) {
            timeMatches = true;
          } else if (ignoreDST && Math.abs(diffMs - 3600000) <= toleranceMs) {
            timeMatches = true;
          } else if (ignoreTimezone) {
            const rem = diffMs % 3600000;
            if (rem <= toleranceMs || (3600000 - rem) <= toleranceMs) {
              timeMatches = true;
            }
          }

          if (!timeMatches) {
            quickMatches = false;
          }
        }

        // 3. Unix metadata tests
        if (quickMatches && comparePermissions) {
          const m1 = (left.mode || 0) & 0o777;
          const m2 = (right.mode || 0) & 0o777;
          if (m1 !== m2) quickMatches = false;
        }

        if (quickMatches && compareOwner) {
          if ((left.uid ?? -1) !== (right.uid ?? -1)) quickMatches = false;
        }

        if (quickMatches && compareGroup) {
          if ((left.gid ?? -1) !== (right.gid ?? -1)) quickMatches = false;
        }

        // 4. File content test (if requested)
        if (!compareContents) {
          status = quickMatches ? 'identical' : 'different';
        } else {
          if (skipIfQuickSame && quickMatches) {
            status = 'identical';
          } else {
            let contentMatch = false;
            try {
              if (contentMethod === 'binary') {
                contentMatch = await areFilesEqualBinaryStreamAsync(left.fullPath, right.fullPath, left.size);
              } else if (contentMethod === 'crc') {
                const [c1, c2] = await Promise.all([
                  calculateFileCRC32Async(left.fullPath, left.size),
                  calculateFileCRC32Async(right.fullPath, right.size)
                ]);
                contentMatch = (c1 && c2 && c1 === c2);
              } else {
                // rules
                const deepComp = await compareFilesDeepAsync(left.fullPath, right.fullPath, 'rules', false, left.size, right.size);
                contentMatch = deepComp.match;
              }
            } catch {
              contentMatch = false;
            }

            if (contentMatch) {
              status = (overrideQuickTests || quickMatches) ? 'identical' : 'different';
            } else {
              status = 'different';
            }
          }
        }
      }
    }

    comparison.push({
      relativePath: relPath,
      name: (left || right).name,
      isDirectory: (left || right).isDirectory,
      status,
      left: left ? {
        name: left.name,
        size: left.size,
        modified: left.mtime ? (left.mtime instanceof Date ? left.mtime.toISOString() : String(left.mtime)) : null,
        mode: left.mode,
        uid: left.uid,
        gid: left.gid,
        fullPath: left.fullPath
      } : null,
      right: right ? {
        name: right.name,
        size: right.size,
        modified: right.mtime ? (right.mtime instanceof Date ? right.mtime.toISOString() : String(right.mtime)) : null,
        mode: right.mode,
        uid: right.uid,
        gid: right.gid,
        fullPath: right.fullPath
      } : null
    });
  }

  return comparison;
}

/**
 * Ultra-fast Beyond Compare 5 Streaming Binary Comparison (64KB chunks)
 * Short-circuits immediately on the very first byte mismatch.
 */
async function areFilesEqualBinaryStreamAsync(f1, f2, size) {
  if (size === 0) return true;

  // Ultra-fast path for files <= 256KB (98% of source code files):
  // Eliminates open/close syscall overhead completely
  if (size <= 262144) {
    try {
      const [buf1, buf2] = await Promise.all([
        fs.promises.readFile(f1),
        fs.promises.readFile(f2)
      ]);
      return buf1.equals(buf2);
    } catch {
      return false;
    }
  }

  // Streaming comparison for large files (> 256KB) with early abort
  let fh1 = null;
  let fh2 = null;
  try {
    fh1 = await fs.promises.open(f1, 'r');
    fh2 = await fs.promises.open(f2, 'r');
    const CHUNK_SIZE = 65536; // 64KB
    const buf1 = Buffer.allocUnsafe(CHUNK_SIZE);
    const buf2 = Buffer.allocUnsafe(CHUNK_SIZE);
    let position = 0;

    while (position < size) {
      const toRead = Math.min(CHUNK_SIZE, size - position);
      const [r1, r2] = await Promise.all([
        fh1.read(buf1, 0, toRead, position),
        fh2.read(buf2, 0, toRead, position)
      ]);

      if (r1.bytesRead !== r2.bytesRead) return false;
      if (r1.bytesRead === 0) break;

      if (!buf1.subarray(0, r1.bytesRead).equals(buf2.subarray(0, r2.bytesRead))) {
        return false; // Instant exit on first difference
      }

      position += r1.bytesRead;
    }
    return true;
  } catch {
    return false;
  } finally {
    if (fh1) await fh1.close().catch(() => {});
    if (fh2) await fh2.close().catch(() => {});
  }
}

/**
 * Ultra-fast CRC32 calculation with hardware-accelerated zlib
 */
async function calculateFileCRC32Async(filePath, size) {
  if (size === 0) return '00000000';
  if (size <= 10485760) {
    // Up to 10MB: direct fast buffer read
    const buf = await fs.promises.readFile(filePath);
    return calculateCRC32(buf);
  }

  // Large files (> 10MB): streaming rolling CRC32
  let fh = null;
  try {
    fh = await fs.promises.open(filePath, 'r');
    const CHUNK_SIZE = 65536;
    const buf = Buffer.allocUnsafe(CHUNK_SIZE);
    let position = 0;
    let crc = undefined;

    while (position < size) {
      const toRead = Math.min(CHUNK_SIZE, size - position);
      const r = await fh.read(buf, 0, toRead, position);
      if (r.bytesRead === 0) break;
      const slice = buf.subarray(0, r.bytesRead);
      crc = zlib.crc32 ? zlib.crc32(slice, crc) : null;
      position += r.bytesRead;
    }

    if (crc !== undefined && crc !== null) {
      return (crc >>> 0).toString(16).toUpperCase().padStart(8, '0');
    }
    const fullBuf = await fs.promises.readFile(filePath);
    return calculateCRC32(fullBuf);
  } catch {
    return null;
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

/**
 * Deep Comparison: CRC, Binary or Rules-based
 */
function compareFilesDeep(leftFullPath, rightFullPath, method = 'rules', skipBinary = true) {
  if (!fs.existsSync(leftFullPath) || !fs.existsSync(rightFullPath)) {
    return { status: 'missing', match: false };
  }

  const leftStat = fs.statSync(leftFullPath);
  const rightStat = fs.statSync(rightFullPath);

  // If size differs, binary & crc can immediately conclude mismatch
  if (method === 'binary' || method === 'crc') {
    if (leftStat.size !== rightStat.size) {
      return { status: 'different', match: false, reason: 'Size mismatch', method };
    }
    if (leftStat.size === 0) {
      return { status: 'identical', match: true, method };
    }
  }

  if (method === 'binary') {
    const match = areFilesEqual(leftFullPath, rightFullPath, leftStat.size);
    return {
      status: match ? 'identical' : 'different',
      match,
      method: 'binary'
    };
  }

  if (method === 'crc') {
    const bufLeft = fs.readFileSync(leftFullPath);
    const bufRight = fs.readFileSync(rightFullPath);
    const crcLeft = calculateCRC32(bufLeft);
    const crcRight = calculateCRC32(bufRight);
    const match = crcLeft === crcRight;
    return {
      status: match ? 'identical' : 'different',
      match,
      crcLeft,
      crcRight,
      method: 'crc'
    };
  }

  // Rules-based comparison:
  // Fast path 1: identical binary means rules match
  if (leftStat.size === rightStat.size && areFilesEqual(leftFullPath, rightFullPath, leftStat.size)) {
    return {
      status: 'identical',
      match: true,
      method: 'rules'
    };
  }

  // Fast check for binary files if skipBinary is enabled
  if (skipBinary) {
    const ext = path.extname(leftFullPath).toLowerCase();
    const binaryExts = new Set([
      '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.tar', '.gz',
      '.jar', '.war', '.ear', '.class', '.exe', '.dll', '.dylib', '.so',
      '.mp3', '.mp4', '.avi', '.mov', '.woff', '.woff2', '.ttf', '.eot'
    ]);
    if (binaryExts.has(ext)) {
      const match = leftStat.size === rightStat.size && areFilesEqual(leftFullPath, rightFullPath, leftStat.size);
      return {
        status: match ? 'identical' : 'different',
        match,
        method: 'binary_skipped'
      };
    }
  }

  // Rules-based comparison: text normalization (ignoring CRLF vs LF and trailing whitespaces)
  try {
    const textLeft = fs.readFileSync(leftFullPath, 'utf8').replace(/\r\n/g, '\n').trim();
    const textRight = fs.readFileSync(rightFullPath, 'utf8').replace(/\r\n/g, '\n').trim();
    const match = textLeft === textRight;
    return {
      status: match ? 'identical' : 'different',
      match,
      method: 'rules'
    };
  } catch (err) {
    // If not utf8 readable, fall back to binary
    const match = leftStat.size === rightStat.size && areFilesEqual(leftFullPath, rightFullPath, leftStat.size);
    return {
      status: match ? 'identical' : 'different',
      match,
      method: 'binary_fallback'
    };
  }
}

/**
 * Beyond Compare 5 Deep File Comparison Engine (Async & Non-blocking)
 */
async function compareFilesDeepAsync(leftFullPath, rightFullPath, method = 'rules', skipBinary = true, knownLeftSize, knownRightSize) {
  try {
    let leftSize = knownLeftSize;
    let rightSize = knownRightSize;

    if (typeof leftSize !== 'number' || typeof rightSize !== 'number') {
      const [statL, statR] = await Promise.all([
        fs.promises.stat(leftFullPath).catch(() => null),
        fs.promises.stat(rightFullPath).catch(() => null)
      ]);
      if (!statL || !statR) {
        return { status: 'missing', match: false };
      }
      leftSize = statL.size;
      rightSize = statR.size;
    }

    // Size mismatch short-circuit: for binary and crc, differing sizes NEVER match
    if (method === 'binary' || method === 'crc') {
      if (leftSize !== rightSize) {
        return { status: 'different', match: false, reason: 'Size mismatch', method };
      }
      if (leftSize === 0) {
        return { status: 'identical', match: true, crcLeft: '00000000', crcRight: '00000000', method };
      }
    }

    if (method === 'binary') {
      const match = await areFilesEqualBinaryStreamAsync(leftFullPath, rightFullPath, leftSize);
      return {
        status: match ? 'identical' : 'different',
        match,
        method: 'binary'
      };
    }

    if (method === 'crc') {
      const [crcLeft, crcRight] = await Promise.all([
        calculateFileCRC32Async(leftFullPath, leftSize),
        calculateFileCRC32Async(rightFullPath, rightSize)
      ]);
      const match = (crcLeft && crcRight && crcLeft === crcRight);
      return {
        status: match ? 'identical' : 'different',
        match,
        crcLeft,
        crcRight,
        method: 'crc'
      };
    }

    // Rules-based:
    // Fast path 1: If sizes are identical, test binary stream first
    if (leftSize === rightSize) {
      const isBinEq = await areFilesEqualBinaryStreamAsync(leftFullPath, rightFullPath, leftSize);
      if (isBinEq) {
        return {
          status: 'identical',
          match: true,
          method: 'rules'
        };
      }
    }

    // Fast check for binary files if skipBinary is enabled
    if (skipBinary) {
      const ext = path.extname(leftFullPath).toLowerCase();
      const binaryExts = new Set([
        '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.tar', '.gz',
        '.jar', '.war', '.ear', '.class', '.exe', '.dll', '.dylib', '.so',
        '.mp3', '.mp4', '.avi', '.mov', '.woff', '.woff2', '.ttf', '.eot'
      ]);
      if (binaryExts.has(ext)) {
        return {
          status: 'different',
          match: false,
          method: 'binary_skipped'
        };
      }
    }

    // Text comparison (Rules: normalize CRLF vs LF and trim trailing whitespace)
    try {
      const [textLeft, textRight] = await Promise.all([
        fs.promises.readFile(leftFullPath, 'utf8'),
        fs.promises.readFile(rightFullPath, 'utf8')
      ]);
      const normL = textLeft.replace(/\r\n/g, '\n').trim();
      const normR = textRight.replace(/\r\n/g, '\n').trim();
      const match = normL === normR;
      return {
        status: match ? 'identical' : 'different',
        match,
        method: 'rules'
      };
    } catch {
      // Fallback if not utf8 text
      if (leftSize !== rightSize) {
        return { status: 'different', match: false, method: 'binary_fallback' };
      }
      const match = await areFilesEqualBinaryStreamAsync(leftFullPath, rightFullPath, leftSize);
      return {
        status: match ? 'identical' : 'different',
        match,
        method: 'binary_fallback'
      };
    }
  } catch (err) {
    return { status: 'different', match: false, error: err.message };
  }
}

function stringSimilarity(s1, s2) {
  if (s1 === s2) return 1.0;
  const t1 = (s1 || '').trim();
  const t2 = (s2 || '').trim();
  if (t1 === t2) return 1.0;
  if (!t1 || !t2) return 0.0;
  const w1 = t1.match(/\w+/g) || [];
  const w2 = t2.match(/\w+/g) || [];
  if (w1.length === 0 || w2.length === 0) return 0.0;
  const map2 = {};
  for (const w of w2) map2[w] = (map2[w] || 0) + 1;
  let matches = 0;
  for (const w of w1) {
    if (map2[w] > 0) {
      matches++;
      map2[w]--;
    }
  }
  return (2 * matches) / (w1.length + w2.length);
}

function alignLinesWithinBlock(remLines, addLines) {
  const n = remLines.length;
  const m = addLines.length;
  if (n === 0) return addLines.map(r => ({ left: null, right: r }));
  if (m === 0) return remLines.map(l => ({ left: l, right: null }));
  if (n === m) return remLines.map((l, idx) => ({ left: l, right: addLines[idx] }));

  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  const traceback = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

  const GAP_PENALTY = -0.15;
  for (let i = 1; i <= n; i++) {
    dp[i][0] = i * GAP_PENALTY;
    traceback[i][0] = 2;
  }
  for (let j = 1; j <= m; j++) {
    dp[0][j] = j * GAP_PENALTY;
    traceback[0][j] = 3;
  }

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sim = stringSimilarity(remLines[i - 1], addLines[j - 1]);
      const matchScore = sim >= 0.35 ? sim * 2.0 : (sim > 0 ? sim : -0.2);

      const scoreDiag = dp[i - 1][j - 1] + matchScore;
      const scoreUp = dp[i - 1][j] + GAP_PENALTY;
      const scoreLeft = dp[i][j - 1] + GAP_PENALTY;

      if (scoreDiag >= scoreUp && scoreDiag >= scoreLeft) {
        dp[i][j] = scoreDiag;
        traceback[i][j] = 1;
      } else if (scoreUp >= scoreLeft) {
        dp[i][j] = scoreUp;
        traceback[i][j] = 2;
      } else {
        dp[i][j] = scoreLeft;
        traceback[i][j] = 3;
      }
    }
  }

  const aligned = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && traceback[i][j] === 1) {
      aligned.unshift({ left: remLines[i - 1], right: addLines[j - 1] });
      i--; j--;
    } else if (i > 0 && (j === 0 || traceback[i][j] === 2)) {
      aligned.unshift({ left: remLines[i - 1], right: null });
      i--;
    } else {
      aligned.unshift({ left: null, right: addLines[j - 1] });
      j--;
    }
  }
  return aligned;
}

/**
 * Beyond Compare 5 High-Precision Myers Diff Line Alignment Engine
 * Features:
 * - Smart token & whitespace-normalized anchor detection (Myers / diffArrays)
 * - Fine-grained Needleman-Wunsch alignment inside modified blocks
 * - Distinct whitespace diff classification (Blue context matching Beyond Compare)
 * - Character-level word/token diff highlighting
 */
function computeAlignedDiff(textLeft, textRight) {
  const Diff = require('diff');
  const normL = (textLeft || '').replace(/\r\n/g, '\n');
  const normR = (textRight || '').replace(/\r\n/g, '\n');

  // Fast path: 100% identical
  if (normL === normR) {
    const lines = normL.length > 0 ? normL.split('\n') : [''];
    const rows = lines.map((l, idx) => ({
      type: 'same',
      leftNum: idx + 1,
      leftText: l,
      rightNum: idx + 1,
      rightText: l,
      sectionIndex: -1
    }));
    return {
      rows,
      sections: [],
      totalRows: rows.length,
      sectionCount: 0
    };
  }

  const linesL = normL.split('\n');
  const linesR = normR.split('\n');

  function normalizeForAnchor(str) {
    return str.trim().replace(/\s+/g, ' ').replace(/\s*([(){}[\];,:=])\s*/g, '$1');
  }

  // Myers diff on line arrays with normalized anchor matching (blank lines must not anchor)
  const chunks = Diff.diffArrays(linesL, linesR, {
    comparator: (a, b) => {
      if (a.trim() === '' || b.trim() === '') return false;
      return normalizeForAnchor(a) === normalizeForAnchor(b);
    }
  });

  const rows = [];
  let lineNumL = 1;
  let lineNumR = 1;

  function pushSameRow(leftTxt, rightTxt) {
    rows.push({
      type: 'same',
      leftNum: lineNumL++,
      leftText: leftTxt,
      rightNum: lineNumR++,
      rightText: rightTxt,
      sectionIndex: -1,
      isSectionStart: false,
      isSectionEnd: false
    });
  }

  function pushDiffRow(hasLeft, leftTxt, hasRight, rightTxt, isWs, diffType) {
    let leftChunks = null;
    let rightChunks = null;

    if (hasLeft && hasRight) {
      const parts = Diff.diffWordsWithSpace(leftTxt, rightTxt);
      leftChunks = [];
      rightChunks = [];
      for (let p = 0; p < parts.length; p++) {
        const part = parts[p];
        if (part.added) rightChunks.push({ text: part.value, isDiff: true });
        else if (part.removed) leftChunks.push({ text: part.value, isDiff: true });
        else {
          leftChunks.push({ text: part.value, isDiff: false });
          rightChunks.push({ text: part.value, isDiff: false });
        }
      }
    } else if (hasLeft) {
      leftChunks = [{ text: leftTxt, isDiff: true }];
    } else if (hasRight) {
      rightChunks = [{ text: rightTxt, isDiff: true }];
    }

    const isCommentL = hasLeft && (leftTxt.trim().startsWith('//') || leftTxt.trim().startsWith('/*') || leftTxt.trim().startsWith('*'));
    const isCommentR = hasRight && (rightTxt.trim().startsWith('//') || rightTxt.trim().startsWith('/*') || rightTxt.trim().startsWith('*'));

    rows.push({
      type: 'diff',
      diffType,
      isGhostL: !hasLeft,
      isGhostR: !hasRight,
      isCommentL,
      isCommentR,
      isWhitespaceDiff: isWs,
      leftNum: hasLeft ? lineNumL++ : null,
      leftText: hasLeft ? leftTxt : null,
      leftChunks,
      rightNum: hasRight ? lineNumR++ : null,
      rightText: hasRight ? rightTxt : null,
      rightChunks,
      sectionIndex: -1,
      isSectionStart: false,
      isSectionEnd: false
    });
  }

  let i = 0;
  while (i < chunks.length) {
    const chunk = chunks[i];

    if (!chunk.added && !chunk.removed) {
      // Anchored matching lines
      const count = chunk.value.length;
      for (let k = 0; k < count; k++) {
        const curL = linesL[lineNumL - 1];
        const curR = linesR[lineNumR - 1];
        const isExactSame = (curL === curR);

        if (isExactSame) {
          pushSameRow(curL, curR);
        } else {
          pushDiffRow(true, curL, true, curR, true, 'modify');
        }
      }
      i++;
    } else {
      // Difference block
      let rem = null;
      let add = null;

      if (chunk.removed) {
        rem = chunk;
        if (i + 1 < chunks.length && chunks[i + 1].added) {
          add = chunks[i + 1];
          i += 2;
        } else {
          i++;
        }
      } else if (chunk.added) {
        add = chunk;
        i++;
      }

      const remLines = rem ? rem.value : [];
      const addLines = add ? add.value : [];
      const aligned = alignLinesWithinBlock(remLines, addLines);

      for (let k = 0; k < aligned.length; k++) {
        const pair = aligned[k];
        const hasLeft = pair.left !== null;
        const hasRight = pair.right !== null;
        const leftTxt = hasLeft ? pair.left : null;
        const rightTxt = hasRight ? pair.right : null;

        const exactSame = (hasLeft && hasRight && leftTxt === rightTxt);
        const bothBlank = (hasLeft && hasRight && leftTxt.trim() === '' && rightTxt.trim() === '');

        if (exactSame || bothBlank) {
          pushSameRow(leftTxt, rightTxt);
          continue;
        }

        let isWhitespaceDiff = false;
        if (hasLeft && hasRight) {
          const normLeft = leftTxt.replace(/\t/g, ' ').replace(/\s+/g, ' ').trim();
          const normRight = rightTxt.replace(/\t/g, ' ').replace(/\s+/g, ' ').trim();
          if (normLeft === normRight) {
            isWhitespaceDiff = true;
          }
        } else if (hasLeft && !hasRight) {
          if (leftTxt.trim() === '') {
            isWhitespaceDiff = true;
          }
        } else if (!hasLeft && hasRight) {
          if (rightTxt.trim() === '') {
            isWhitespaceDiff = true;
          }
        }

        const diffType = !hasLeft ? 'add_right' : (!hasRight ? 'add_left' : 'modify');
        pushDiffRow(hasLeft, leftTxt, hasRight, rightTxt, isWhitespaceDiff, diffType);
      }
    }
  }

  // Build unified, contiguous Beyond Compare style difference sections:
  // Groups contiguous diff rows together into one section.
  // Internal blank lines between diff rows do not break the section.
  const sections = [];
  let curSec = null;

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const isDiff = (row.type === 'diff');
    const isBlankSame = (row.type === 'same' && (!row.leftText || row.leftText.trim() === '') && (!row.rightText || row.rightText.trim() === ''));

    if (isDiff) {
      if (!curSec) {
        curSec = {
          index: sections.length,
          startRow: r,
          endRow: r
        };
        sections.push(curSec);
      }
      curSec.endRow = r;
    } else if (isBlankSame && curSec) {
      // Hold: an empty line inside a diff block does not break the section
    } else {
      curSec = null;
    }
  }

  sections.forEach((sec, idx) => {
    sec.index = idx;
    let minL = null, maxL = null;
    let minR = null, maxR = null;

    for (let r = sec.startRow; r <= sec.endRow; r++) {
      const row = rows[r];
      row.sectionIndex = idx;
      row.isSectionStart = (r === sec.startRow);
      row.isSectionEnd = (r === sec.endRow);

      if (row.leftNum !== null && row.leftNum !== undefined) {
        if (minL === null || row.leftNum < minL) minL = row.leftNum;
        if (maxL === null || row.leftNum > maxL) maxL = row.leftNum;
      }
      if (row.rightNum !== null && row.rightNum !== undefined) {
        if (minR === null || row.rightNum < minR) minR = row.rightNum;
        if (maxR === null || row.rightNum > maxR) maxR = row.rightNum;
      }
    }

    sec.origStartLeft = minL !== null ? minL : (sec.startRow > 0 ? (rows[sec.startRow - 1].leftNum || 1) + 1 : 1);
    sec.leftLineCount = (minL !== null && maxL !== null) ? (maxL - minL + 1) : 0;
    sec.leftLines = sec.leftLineCount > 0 ? linesL.slice(minL - 1, maxL) : [];

    sec.origStartRight = minR !== null ? minR : (sec.startRow > 0 ? (rows[sec.startRow - 1].rightNum || 1) + 1 : 1);
    sec.rightLineCount = (minR !== null && maxR !== null) ? (maxR - minR + 1) : 0;
    sec.rightLines = sec.rightLineCount > 0 ? linesR.slice(minR - 1, maxR) : [];

    let allWs = true;
    for (let r = sec.startRow; r <= sec.endRow; r++) {
      if (rows[r].type === 'diff' && !rows[r].isWhitespaceDiff) {
        allWs = false;
        break;
      }
    }
    sec.isWhitespaceDiff = allWs;
    sec.type = sec.leftLineCount === 0 ? 'add_right' : (sec.rightLineCount === 0 ? 'add_left' : 'modify');
  });

  return {
    rows,
    sections,
    totalRows: rows.length,
    sectionCount: sections.length
  };
}

/**
 * 3-Way Folder Merge Engine (Left, Base/Center, Right)
 */
function compareFolderMergeTrees(leftDir, baseDir, rightDir) {
  const leftItems = leftDir ? scanDirectory(leftDir, '', []) : [];
  const baseItems = baseDir ? scanDirectory(baseDir, '', []) : [];
  const rightItems = rightDir ? scanDirectory(rightDir, '', []) : [];

  const leftMap = new Map();
  leftItems.forEach(it => leftMap.set(it.relativePath, it));

  const baseMap = new Map();
  baseItems.forEach(it => baseMap.set(it.relativePath, it));

  const rightMap = new Map();
  rightItems.forEach(it => rightMap.set(it.relativePath, it));

  const allRelPaths = new Set([...leftMap.keys(), ...baseMap.keys(), ...rightMap.keys()]);
  const sortedPaths = Array.from(allRelPaths).sort();

  const comparison = [];

  for (let i = 0; i < sortedPaths.length; i++) {
    const relPath = sortedPaths[i];
    const left = leftMap.get(relPath);
    const base = baseMap.get(relPath);
    const right = rightMap.get(relPath);

    const ref = left || base || right;
    const isDir = ref.isDirectory;

    let status = 'same';
    let defaultAction = 'same'; // 'take_left', 'take_right', 'conflict', 'same'

    const leftExists = !!left;
    const baseExists = !!base;
    const rightExists = !!right;

    if (isDir) {
      status = 'folder';
      defaultAction = 'keep';
    } else {
      const leftMatchesBase = baseExists && leftExists && left.size === base.size && areFilesFastEqual(left.fullPath, base.fullPath, left.size);
      const rightMatchesBase = baseExists && rightExists && right.size === base.size && areFilesFastEqual(right.fullPath, base.fullPath, right.size);
      const leftMatchesRight = leftExists && rightExists && left.size === right.size && areFilesFastEqual(left.fullPath, right.fullPath, left.size);

      if (leftExists && baseExists && rightExists) {
        if (leftMatchesBase && rightMatchesBase) {
          status = 'same';
          defaultAction = 'same';
        } else if (!leftMatchesBase && rightMatchesBase) {
          status = 'left_change';
          defaultAction = 'take_left';
        } else if (leftMatchesBase && !rightMatchesBase) {
          status = 'right_change';
          defaultAction = 'take_right';
        } else if (leftMatchesRight) {
          status = 'both_same_change';
          defaultAction = 'take_left';
        } else {
          status = 'conflict';
          defaultAction = 'conflict';
        }
      } else if (!baseExists) {
        // Added on one or both sides
        if (leftExists && rightExists) {
          if (leftMatchesRight) {
            status = 'both_added';
            defaultAction = 'take_left';
          } else {
            status = 'conflict';
            defaultAction = 'conflict';
          }
        } else if (leftExists) {
          status = 'orphan_left';
          defaultAction = 'take_left';
        } else {
          status = 'orphan_right';
          defaultAction = 'take_right';
        }
      } else {
        // Base existed, but deleted on one or both sides
        if (!leftExists && !rightExists) {
          status = 'both_deleted';
          defaultAction = 'delete';
        } else if (!leftExists && rightMatchesBase) {
          status = 'deleted_on_left';
          defaultAction = 'delete';
        } else if (!rightExists && leftMatchesBase) {
          status = 'deleted_on_right';
          defaultAction = 'delete';
        } else {
          status = 'conflict';
          defaultAction = 'conflict';
        }
      }
    }

    comparison.push({
      relativePath: relPath,
      name: ref.name,
      isDirectory: isDir,
      status,
      defaultAction,
      left: left ? { name: left.name, size: left.size, modified: left.mtime ? left.mtime.toISOString() : null, fullPath: left.fullPath } : null,
      base: base ? { name: base.name, size: base.size, modified: base.mtime ? base.mtime.toISOString() : null, fullPath: base.fullPath } : null,
      right: right ? { name: right.name, size: right.size, modified: right.mtime ? right.mtime.toISOString() : null, fullPath: right.fullPath } : null
    });
  }

  return comparison;
}

/**
 * Beyond Compare 5 3-Way Text Merge Alignment Engine (Left/Theirs, Base, Right/Mine)
 */
function computeThreeWayTextMerge(textLeft, textBase, textRight) {
  const Diff = require('diff');
  const normL = (textLeft || '').replace(/\r\n/g, '\n');
  const normB = (textBase || '').replace(/\r\n/g, '\n');
  const normR = (textRight || '').replace(/\r\n/g, '\n');

  const baseLines = normB.split('\n');
  const leftLines = normL.split('\n');
  const rightLines = normR.split('\n');

  // Compute diffs against base
  const diffLB = Diff.diffLines(normB, normL);
  const diffRB = Diff.diffLines(normB, normR);

  // High-level 3-way merge structure
  // For each line block in base:
  // Check if modified in left, modified in right, or both
  const conflicts = [];
  const mergedLines = [];

  // Aligned display rows for 3 panes + 1 output pane
  const rows = [];
  let curL = 1;
  let curB = 1;
  let curR = 1;
  let conflictIdx = 0;

  // Simple and robust block-level 3-way merge
  if (normL === normR) {
    // Both sides identical
    const lines = normL.split('\n');
    for (let k = 0; k < lines.length; k++) {
      rows.push({
        leftNum: k + 1, leftText: lines[k],
        baseNum: k < baseLines.length ? k + 1 : null, baseText: k < baseLines.length ? baseLines[k] : null,
        rightNum: k + 1, rightText: lines[k],
        outputNum: k + 1, outputText: lines[k],
        status: (lines[k] === baseLines[k]) ? 'same' : 'both_modified',
        conflictId: null
      });
      mergedLines.push(lines[k]);
    }
  } else if (normL === normB) {
    // Left unchanged, accept right
    for (let k = 0; k < rightLines.length; k++) {
      rows.push({
        leftNum: k < leftLines.length ? k + 1 : null, leftText: k < leftLines.length ? leftLines[k] : '',
        baseNum: k < baseLines.length ? k + 1 : null, baseText: k < baseLines.length ? baseLines[k] : '',
        rightNum: k + 1, rightText: rightLines[k],
        outputNum: k + 1, outputText: rightLines[k],
        status: (rightLines[k] === baseLines[k]) ? 'same' : 'right_modified',
        conflictId: null
      });
      mergedLines.push(rightLines[k]);
    }
  } else if (normR === normB) {
    // Right unchanged, accept left
    for (let k = 0; k < leftLines.length; k++) {
      rows.push({
        leftNum: k + 1, leftText: leftLines[k],
        baseNum: k < baseLines.length ? k + 1 : null, baseText: k < baseLines.length ? baseLines[k] : '',
        rightNum: k < rightLines.length ? k + 1 : null, rightText: k < rightLines.length ? rightLines[k] : '',
        outputNum: k + 1, outputText: leftLines[k],
        status: (leftLines[k] === baseLines[k]) ? 'same' : 'left_modified',
        conflictId: null
      });
      mergedLines.push(leftLines[k]);
    }
  } else {
    // Both sides modified -> align and flag conflicts
    const maxLines = Math.max(leftLines.length, baseLines.length, rightLines.length);
    for (let k = 0; k < maxLines; k++) {
      const lTxt = k < leftLines.length ? leftLines[k] : '';
      const bTxt = k < baseLines.length ? baseLines[k] : '';
      const rTxt = k < rightLines.length ? rightLines[k] : '';

      const hasL = k < leftLines.length;
      const hasB = k < baseLines.length;
      const hasR = k < rightLines.length;

      let status = 'same';
      let outTxt = bTxt;
      let cId = null;

      if (lTxt === rTxt && lTxt === bTxt) {
        status = 'same';
        outTxt = bTxt;
      } else if (lTxt !== bTxt && rTxt === bTxt) {
        status = 'left_modified';
        outTxt = lTxt;
      } else if (rTxt !== bTxt && lTxt === bTxt) {
        status = 'right_modified';
        outTxt = rTxt;
      } else if (lTxt === rTxt) {
        status = 'both_same';
        outTxt = lTxt;
      } else {
        status = 'conflict';
        cId = `conflict-${conflictIdx++}`;
        conflicts.push({
          id: cId,
          rowIndex: rows.length,
          leftText: lTxt,
          baseText: bTxt,
          rightText: rTxt
        });
        outTxt = `<<<<<<< Left (Theirs)\n${lTxt}\n=======\n${rTxt}\n>>>>>>> Right (Mine)`;
      }

      rows.push({
        leftNum: hasL ? curL++ : null, leftText: hasL ? lTxt : null,
        baseNum: hasB ? curB++ : null, baseText: hasB ? bTxt : null,
        rightNum: hasR ? curR++ : null, rightText: hasR ? rTxt : null,
        outputNum: rows.length + 1, outputText: outTxt,
        status,
        conflictId: cId
      });
      mergedLines.push(outTxt);
    }
  }

  return {
    rows,
    conflicts,
    conflictCount: conflicts.length,
    initialOutputText: mergedLines.join('\n')
  };
}

module.exports = {
  scanDirectory,
  scanDirectoryAsync,
  compareFolderTrees,
  compareFolderTreesAsync,
  compareFilesDeep,
  compareFilesDeepAsync,
  calculateCRC32,
  computeAlignedDiff,
  compareFolderMergeTrees,
  computeThreeWayTextMerge
};

