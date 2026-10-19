const fs = require('fs');
const path = require('path');
const { shell } = require('electron');
const javaDecompiler = require('./javaDecompiler');
const archiveHandler = require('./archiveHandler');

/**
 * File Operations for DiffCore
 * Provides safe copy, delete, reveal, text read/write and hex view services.
 */

function copyItem(srcPath, destPath) {
  try {
    if (!fs.existsSync(srcPath)) return { success: false, error: 'Source does not exist' };
    
    // Ensure destination directory exists
    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const stat = fs.statSync(srcPath);
    if (stat.isDirectory()) {
      fs.cpSync(srcPath, destPath, { recursive: true, force: true });
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function deleteItem(targetPath) {
  try {
    if (!fs.existsSync(targetPath)) return { success: false, error: 'Target does not exist' };
    
    // Attempt soft delete to trash
    try {
      await shell.trashItem(targetPath);
      return { success: true, method: 'trash' };
    } catch {
      // Fallback to permanent rm
      const stat = fs.statSync(targetPath);
      if (stat.isDirectory()) {
        fs.rmSync(targetPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(targetPath);
      }
      return { success: true, method: 'permanent' };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function revealInFinder(targetPath) {
  try {
    if (fs.existsSync(targetPath)) {
      shell.showItemInFolder(targetPath);
      return { success: true };
    }
    return { success: false, error: 'Path not found' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function readTextFile(filePath, maxBytes = 10 * 1024 * 1024) {
  try {
    if (!filePath || typeof filePath !== 'string') {
      return { success: false, error: 'Invalid path' };
    }
    if (!fs.existsSync(filePath)) {
      return { success: false, error: 'File does not exist' };
    }
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      return { success: false, isDirectory: true, error: 'Path is a folder, not a text file' };
    }

    // 1. Check if file is a Java archive container (.jar, .war, .ear, .zip)
    if (archiveHandler.isArchiveFile(filePath)) {
      return {
        success: false,
        isArchive: true,
        fileName: path.basename(filePath),
        filePath,
        size: stat.size,
        error: 'Path is a Java archive container (.jar/.war/.ear)'
      };
    }

    if (stat.size > maxBytes) {
      return { success: false, error: `File too large (${(stat.size / 1024 / 1024).toFixed(1)} MB)` };
    }

    // 2. Read first chunk or full buffer to inspect binary vs class vs text
    const sampleSize = Math.min(stat.size, 8192);
    let sampleBuf = Buffer.alloc(0);
    if (sampleSize > 0) {
      const fd = fs.openSync(filePath, 'r');
      sampleBuf = Buffer.alloc(sampleSize);
      fs.readSync(fd, sampleBuf, 0, sampleSize, 0);
      fs.closeSync(fd);
    }

    // 3. Check for Java Bytecode (.class or 0xCAFEBABE)
    if (javaDecompiler.isJavaClassPath(filePath) || javaDecompiler.isJavaClassBuffer(sampleBuf)) {
      const decompileRes = await javaDecompiler.decompileClassFile(filePath);
      if (decompileRes.success) {
        const content = decompileRes.content || '';
        let lineCount = 1;
        for (let i = 0; i < content.length; i++) {
          if (content.charCodeAt(i) === 10) lineCount++;
        }
        return {
          success: true,
          content,
          lineCount,
          size: stat.size,
          mtime: stat.mtime,
          mtimeMs: stat.mtimeMs,
          isDecompiled: true,
          language: 'java',
          isReadonly: true
        };
      }
    }

    // 4. Check for arbitrary binary files (NULL bytes in sample)
    let isBinary = false;
    for (let i = 0; i < sampleSize; i++) {
      if (sampleBuf[i] === 0) {
        isBinary = true;
        break;
      }
    }

    if (isBinary) {
      return {
        success: false,
        isBinary: true,
        fileName: path.basename(filePath),
        filePath,
        size: stat.size,
        error: 'Binary file detected (not readable as text)'
      };
    }

    // 5. Standard Text file reading
    const content = fs.readFileSync(filePath, 'utf8');
    let lineCount = 1;
    for (let i = 0; i < content.length; i++) {
      if (content.charCodeAt(i) === 10) lineCount++;
    }
    return {
      success: true,
      content,
      lineCount,
      size: stat.size,
      mtime: stat.mtime,
      mtimeMs: stat.mtimeMs
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function writeTextFile(filePath, content) {
  try {
    if (javaDecompiler.isJavaClassPath(filePath)) {
      return { success: false, error: 'No se puede sobrescribir una clase .class compilada con código fuente. Es de solo lectura.' };
    }
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    const stat = fs.statSync(filePath);
    return { success: true, mtimeMs: stat.mtimeMs };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function readHexDump(filePath, offset = 0, length = 4096) {
  try {
    if (!fs.existsSync(filePath)) return { success: false, error: 'File does not exist' };
    const stat = fs.statSync(filePath);
    const fd = fs.openSync(filePath, 'r');
    const readLen = Math.min(length, stat.size - offset);
    const buffer = Buffer.alloc(Math.max(0, readLen));
    fs.readSync(fd, buffer, 0, readLen, offset);
    fs.closeSync(fd);

    const rows = [];
    for (let i = 0; i < buffer.length; i += 16) {
      const slice = buffer.slice(i, i + 16);
      const hexParts = [];
      const asciiParts = [];
      for (let j = 0; j < 16; j++) {
        if (j < slice.length) {
          const byte = slice[j];
          hexParts.push(byte.toString(16).padStart(2, '0').toUpperCase());
          asciiParts.push((byte >= 32 && byte <= 126) ? String.fromCharCode(byte) : '.');
        } else {
          hexParts.push('  ');
          asciiParts.push(' ');
        }
      }
      rows.push({
        offset: (offset + i).toString(16).padStart(8, '0').toUpperCase(),
        hex: hexParts.slice(0, 8).join(' ') + '  ' + hexParts.slice(8).join(' '),
        ascii: asciiParts.join('')
      });
    }

    return {
      success: true,
      totalSize: stat.size,
      offset,
      rows
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function renameItem(oldPath, newPath) {
  try {
    if (!fs.existsSync(oldPath)) return { success: false, error: 'Source not found' };
    fs.renameSync(oldPath, newPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function moveItem(srcPath, destPath) {
  try {
    if (!fs.existsSync(srcPath)) return { success: false, error: 'Source not found' };
    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    try {
      fs.renameSync(srcPath, destPath);
      return { success: true };
    } catch {
      const copyRes = copyItem(srcPath, destPath);
      if (!copyRes.success) return copyRes;
      const stat = fs.statSync(srcPath);
      if (stat.isDirectory()) fs.rmSync(srcPath, { recursive: true, force: true });
      else fs.unlinkSync(srcPath);
      return { success: true };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function createFolder(folderPath) {
  try {
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function touchItem(targetPath) {
  try {
    if (!fs.existsSync(targetPath)) return { success: false, error: 'Target not found' };
    const now = new Date();
    fs.utimesSync(targetPath, now, now);
    return { success: true, mtime: now.toISOString() };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function getItemAttributes(targetPath) {
  try {
    if (!fs.existsSync(targetPath)) return { success: false, error: 'Path not found' };
    const stat = fs.statSync(targetPath);
    return {
      success: true,
      size: stat.size,
      birthtime: stat.birthtime,
      mtime: stat.mtime,
      mode: (stat.mode & parseInt('777', 8)).toString(8),
      isDirectory: stat.isDirectory(),
      fullPath: targetPath
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function openInDefaultApp(targetPath) {
  try {
    if (fs.existsSync(targetPath)) {
      shell.openPath(targetPath);
      return { success: true };
    }
    return { success: false, error: 'Path not found' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function openTerminal(targetPath) {
  try {
    const { exec } = require('child_process');
    let dir = targetPath;
    if (fs.existsSync(targetPath)) {
      const stat = fs.statSync(targetPath);
      if (!stat.isDirectory()) {
        dir = path.dirname(targetPath);
      }
    }
    exec(`open -a Terminal "${dir}"`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Beyond Compare 5 Table Compare Parser
 * Supports Multi-sheet Excel (.xlsx, .xls, .ods), HTML Tables, and CSV/TSV
 */
function readTableFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { success: false, error: 'File does not exist' };
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) return { success: false, error: 'Path is a folder, not a table file' };

    const ext = path.extname(filePath).toLowerCase();
    const XLSX = require('xlsx');

    // Excel workbook (.xlsx, .xls, .ods, .xlsm)
    if (ext === '.xlsx' || ext === '.xls' || ext === '.ods' || ext === '.xlsm') {
      const workbook = XLSX.readFile(filePath, { cellDates: true });
      const sheetNames = workbook.SheetNames || [];
      const sheets = {};
      for (const sName of sheetNames) {
        const sheet = workbook.Sheets[sName];
        sheets[sName] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      }
      return {
        success: true,
        type: 'excel',
        sheetNames,
        sheets,
        activeSheet: sheetNames[0] || 'Sheet1',
        size: stat.size,
        mtime: stat.mtime
      };
    }

    // Delimited or HTML
    const raw = fs.readFileSync(filePath, 'utf8');

    // HTML Tables
    if (ext === '.html' || ext === '.htm' || (raw.includes('<table') && raw.includes('</table>'))) {
      const workbook = XLSX.read(raw, { type: 'string' });
      const sheetNames = (workbook.SheetNames && workbook.SheetNames.length > 0) ? workbook.SheetNames : ['Table 1'];
      const sheets = {};
      for (const sName of sheetNames) {
        const sheet = workbook.Sheets[sName];
        sheets[sName] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      }
      return {
        success: true,
        type: 'html',
        sheetNames,
        sheets,
        activeSheet: sheetNames[0] || 'Table 1',
        size: stat.size,
        mtime: stat.mtime
      };
    }

    // CSV / TSV / Delimited
    const lines = raw.split(/\r\n|\r|\n/).filter(l => l.length > 0);
    const firstLine = lines[0] || '';
    let delimiter = ',';
    const tabCount = (firstLine.match(/\t/g) || []).length;
    const commaCount = (firstLine.match(/,/g) || []).length;
    const semiCount = (firstLine.match(/;/g) || []).length;
    const pipeCount = (firstLine.match(/\|/g) || []).length;

    if (tabCount > commaCount && tabCount > semiCount) delimiter = '\t';
    else if (semiCount > commaCount) delimiter = ';';
    else if (pipeCount > commaCount) delimiter = '|';

    const rows = lines.map(line => {
      const result = [];
      let inQuote = false;
      let buffer = '';
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
          inQuote = !inQuote;
        } else if (c === delimiter && !inQuote) {
          result.push(buffer.trim());
          buffer = '';
        } else {
          buffer += c;
        }
      }
      result.push(buffer.trim());
      return result;
    });

    return {
      success: true,
      type: 'delimited',
      delimiter,
      sheetNames: ['Sheet 1'],
      sheets: {
        'Sheet 1': rows
      },
      activeSheet: 'Sheet 1',
      size: stat.size,
      mtime: stat.mtime
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

const ID3_GENRES = [
  'Blues', 'Classic Rock', 'Country', 'Dance', 'Disco', 'Funk', 'Grunge', 'Hip-Hop', 'Jazz', 'Metal',
  'New Age', 'Oldies', 'Other', 'Pop', 'R&B', 'Rap', 'Reggae', 'Rock', 'Techno', 'Industrial',
  'Alternative', 'Ska', 'Death Metal', 'Pranks', 'Soundtrack', 'Euro-Techno', 'Ambient', 'Trip-Hop', 'Vocal', 'Jazz+Funk',
  'Fusion', 'Trance', 'Classical', 'Instrumental', 'Acid', 'House', 'Game', 'Sound Clip', 'Gospel', 'Noise',
  'AlternRock', 'Bass', 'Soul', 'Punk', 'Space', 'Meditative', 'Instrumental Pop', 'Instrumental Rock', 'Ethnic', 'Gothic',
  'Darkwave', 'Techno-Industrial', 'Electronic', 'Pop-Folk', 'Eurodance', 'Dream', 'Southern Rock', 'Comedy', 'Cult', 'Gangsta',
  'Top 40', 'Christian Rap', 'Pop/Funk', 'Jungle', 'Native American', 'Cabaret', 'New Wave', 'Psychadelic', 'Rave', 'Showtunes',
  'Trailer', 'Lo-Fi', 'Tribal', 'Acid Punk', 'Acid Jazz', 'Polka', 'Retro', 'Musical', 'Rock & Roll', 'Hard Rock'
];

/**
 * Beyond Compare 5 Media Compare Tag Reader (MP3, FLAC, M4A/AAC, WAV, OGG)
 */
function readMediaMetadata(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { success: false, error: 'File does not exist' };
    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const basename = path.basename(filePath);

    const tags = {
      'File Name': basename,
      'File Size': (stat.size / 1024 / 1024).toFixed(2) + ' MB',
      'Modified Date': stat.mtime.toLocaleString(),
      'File Format': ext.replace('.', '').toUpperCase(),
      'Title': basename.replace(ext, ''),
      'Artist': '-',
      'Album': '-',
      'Track #': '-',
      'Year': '-',
      'Genre': '-',
      'Bitrate': '-',
      'Sample Rate': '-',
      'Channels': 'Stereo',
      'Duration': '-'
    };

    const fd = fs.openSync(filePath, 'r');

    // Read first 4096 bytes for ID3v2 or container headers
    const headBuf = Buffer.alloc(4096);
    const headRead = fs.readSync(fd, headBuf, 0, 4096, 0);

    // Read last 128 bytes for ID3v1
    if (stat.size >= 128) {
      const tailBuf = Buffer.alloc(128);
      fs.readSync(fd, tailBuf, 0, 128, stat.size - 128);
      if (tailBuf.subarray(0, 3).toString('ascii') === 'TAG') {
        const cleanStr = (buf) => buf.toString('latin1').replace(/\0+$/g, '').trim();
        const t1Title = cleanStr(tailBuf.subarray(3, 33));
        const t1Artist = cleanStr(tailBuf.subarray(33, 63));
        const t1Album = cleanStr(tailBuf.subarray(63, 93));
        const t1Year = cleanStr(tailBuf.subarray(93, 97));
        const t1Genre = tailBuf[127];

        if (t1Title) tags['Title'] = t1Title;
        if (t1Artist) tags['Artist'] = t1Artist;
        if (t1Album) tags['Album'] = t1Album;
        if (t1Year) tags['Year'] = t1Year;
        if (t1Genre < ID3_GENRES.length) tags['Genre'] = ID3_GENRES[t1Genre];
        if (tailBuf[125] === 0) tags['Track #'] = String(tailBuf[126]);
      }
    }

    // ID3v2 inspection
    if (headRead >= 10 && headBuf.subarray(0, 3).toString('ascii') === 'ID3') {
      const majorVer = headBuf[3];
      let offset = 10;
      // Search common ID3v2 text frames
      const frameMap = {
        'TIT2': 'Title',
        'TPE1': 'Artist',
        'TALB': 'Album',
        'TYER': 'Year',
        'TDRC': 'Year',
        'TRCK': 'Track #',
        'TCON': 'Genre',
        'TLEN': 'Duration_ms'
      };

      while (offset + 10 < headRead) {
        const frameId = headBuf.subarray(offset, offset + 4).toString('ascii');
        if (!frameId || frameId[0] < 'A' || frameId[0] > 'Z') break;
        const frameSize = headBuf.readUInt32BE(offset + 4);
        if (frameSize <= 0 || offset + 10 + frameSize > headRead) break;

        const key = frameMap[frameId];
        if (key) {
          const encoding = headBuf[offset + 10];
          const valBuf = headBuf.subarray(offset + 11, offset + 10 + frameSize);
          let val = (encoding === 1 || encoding === 2) ? valBuf.toString('utf16le') : valBuf.toString('utf8');
          val = val.replace(/\0/g, '').trim();
          if (val) {
            if (key === 'Duration_ms') {
              const ms = parseInt(val, 10);
              if (!isNaN(ms)) {
                const s = Math.floor(ms / 1000);
                tags['Duration'] = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
              }
            } else {
              tags[key] = val;
            }
          }
        }
        offset += 10 + frameSize;
      }
    }

    // WAV header
    if (headRead >= 44 && headBuf.subarray(0, 4).toString('ascii') === 'RIFF') {
      const sampleRate = headBuf.readUInt32LE(24);
      const byteRate = headBuf.readUInt32LE(28);
      const channels = headBuf.readUInt16LE(22);
      tags['Sample Rate'] = `${sampleRate} Hz`;
      tags['Channels'] = channels === 1 ? 'Mono' : (channels === 2 ? 'Stereo' : `${channels} ch`);
      if (byteRate > 0) {
        tags['Bitrate'] = `${Math.round((byteRate * 8) / 1000)} kbps`;
        const durSec = Math.round(stat.size / byteRate);
        tags['Duration'] = `${Math.floor(durSec / 60)}:${String(durSec % 60).padStart(2, '0')}`;
      }
    }

    // Default duration estimate for MP3 if missing (assuming typical 192kbps)
    if (tags['Duration'] === '-' && ext === '.mp3') {
      const estSec = Math.round((stat.size * 8) / (192 * 1000));
      tags['Bitrate'] = '192 kbps (approx)';
      tags['Duration'] = `${Math.floor(estSec / 60)}:${String(estSec % 60).padStart(2, '0')}`;
      tags['Sample Rate'] = '44100 Hz';
    }

    fs.closeSync(fd);

    return {
      success: true,
      tags,
      filePath
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Beyond Compare 5 Folder Sync Executor
 */
async function executeFolderSync(tasks) {
  let copied = 0;
  let deleted = 0;
  const errors = [];

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    try {
      if (task.action === 'copy_to_right' || task.action === 'copy_to_left') {
        const res = copyItem(task.srcPath, task.destPath);
        if (res.success) copied++;
        else errors.push(`${task.relPath}: ${res.error}`);
      } else if (task.action === 'delete_left' || task.action === 'delete_right') {
        const res = await deleteItem(task.targetPath);
        if (res.success) deleted++;
        else errors.push(`${task.relPath}: ${res.error}`);
      }
    } catch (e) {
      errors.push(`${task.relPath}: ${e.message}`);
    }
  }

  return {
    success: errors.length === 0,
    copied,
    deleted,
    errors
  };
}

module.exports = {
  copyItem,
  deleteItem,
  revealInFinder,
  readTextFile,
  writeTextFile,
  readHexDump,
  renameItem,
  moveItem,
  createFolder,
  touchItem,
  getItemAttributes,
  openInDefaultApp,
  openTerminal,
  readTableFile,
  readMediaMetadata,
  executeFolderSync
};


