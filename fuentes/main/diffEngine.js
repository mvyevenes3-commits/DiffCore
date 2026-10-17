const fs = require('fs');
const path = require('path');

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
        } else {
          mtime = new Date();
        }

        acc.push({
          name: entry.name,
          relativePath: relPath,
          fullPath: fullPath,
          isDirectory: isDir,
          size: size,
          mtime: mtime
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
                mtime: stats.mtime
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
 */
async function compareFolderTreesAsync(leftDir, rightDir) {
  const [leftItems, rightItems] = await Promise.all([
    leftDir ? scanDirectoryAsync(leftDir, '', []) : Promise.resolve([]),
    rightDir ? scanDirectoryAsync(rightDir, '', []) : Promise.resolve([])
  ]);

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
 * Beyond Compare 5 High-Precision Myers Diff Line Alignment Engine
 */
function computeAlignedDiff(textLeft, textRight) {
  const Diff = require('diff');
  const normL = (textLeft || '').replace(/\r\n/g, '\n');
  const normR = (textRight || '').replace(/\r\n/g, '\n');

  const chunks = Diff.diffLines(normL, normR);
  const rows = [];
  const sections = [];
  let lineNumL = 1;
  let lineNumR = 1;

  let i = 0;
  while (i < chunks.length) {
    const chunk = chunks[i];

    if (!chunk.added && !chunk.removed) {
      // Identical / Common block
      const lines = chunk.value.split('\n');
      if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
      for (let k = 0; k < lines.length; k++) {
        rows.push({
          type: 'same',
          leftNum: lineNumL++,
          leftText: lines[k],
          rightNum: lineNumR++,
          rightText: lines[k],
          sectionIndex: -1
        });
      }
      i++;
    } else {
      // Difference block
      let removedChunk = null;
      let addedChunk = null;

      if (chunk.removed) {
        removedChunk = chunk;
        if (i + 1 < chunks.length && chunks[i + 1].added) {
          addedChunk = chunks[i + 1];
          i += 2;
        } else {
          i++;
        }
      } else if (chunk.added) {
        addedChunk = chunk;
        i++;
      }

      const remLines = removedChunk ? removedChunk.value.split('\n') : [];
      if (remLines.length > 0 && remLines[remLines.length - 1] === '') remLines.pop();

      const addLines = addedChunk ? addedChunk.value.split('\n') : [];
      if (addLines.length > 0 && addLines[addLines.length - 1] === '') addLines.pop();

      const maxLen = Math.max(remLines.length, addLines.length);
      const startRow = rows.length;
      const sectionIdx = sections.length;

      let sectionType = 'modify';
      if (remLines.length === 0) sectionType = 'add_right';
      else if (addLines.length === 0) sectionType = 'add_left';

      const origStartLeft = lineNumL;
      const origStartRight = lineNumR;

      for (let k = 0; k < maxLen; k++) {
        const hasLeft = k < remLines.length;
        const hasRight = k < addLines.length;

        const leftTxt = hasLeft ? remLines[k] : '';
        const rightTxt = hasRight ? addLines[k] : '';

        const isCommentL = leftTxt.trim().startsWith('//') || leftTxt.trim().startsWith('/*') || leftTxt.trim().startsWith('*');
        const isCommentR = rightTxt.trim().startsWith('//') || rightTxt.trim().startsWith('/*') || rightTxt.trim().startsWith('*');

        rows.push({
          type: 'diff',
          diffType: sectionType,
          isGhostL: !hasLeft,
          isGhostR: !hasRight,
          isCommentL,
          isCommentR,
          leftNum: hasLeft ? lineNumL++ : null,
          leftText: hasLeft ? leftTxt : null,
          rightNum: hasRight ? lineNumR++ : null,
          rightText: hasRight ? rightTxt : null,
          sectionIndex: sectionIdx,
          isSectionStart: (k === 0)
        });
      }

      sections.push({
        index: sectionIdx,
        startRow,
        endRow: rows.length - 1,
        type: sectionType,
        origStartLeft,
        leftLineCount: remLines.length,
        origStartRight,
        rightLineCount: addLines.length,
        leftLines: remLines,
        rightLines: addLines
      });
    }
  }

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
  calculateCRC32,
  computeAlignedDiff,
  compareFolderMergeTrees,
  computeThreeWayTextMerge
};

