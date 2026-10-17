const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Session Manager for DiffCore
 * Integrates natively with Beyond Compare 5 configuration files
 * and manages native DiffCore custom sessions.
 */

function getBCConfigDir() {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library/Application Support/Beyond Compare 5');
  } else if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || os.homedir(), 'Scooter Software/Beyond Compare 5');
  } else {
    const bc5 = path.join(os.homedir(), '.config/bcompare5');
    if (fs.existsSync(bc5)) return bc5;
    return path.join(os.homedir(), '.config/bcompare');
  }
}

const DIFFCORE_SESSIONS_FILE = path.join(os.homedir(), '.diffcore_sessions.json');
const DIFFCORE_AUTOSAVED_FILE = path.join(os.homedir(), '.diffcore_autosaved.json');
const DIFFCORE_DELETED_FILE = path.join(os.homedir(), '.diffcore_deleted_sessions.json');

/**
 * Calculate relative group name matching Beyond Compare 5:
 * "Today", "Yesterday", "2 days ago", ..., "6 days ago", "More than 6 days ago"
 */
function getRelativeDateGroup(dateStr) {
  if (!dateStr) return 'More than 6 days ago';
  const targetDate = new Date(dateStr.replace(' ', 'T'));
  if (isNaN(targetDate.getTime())) return 'More than 6 days ago';

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTarget = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());

  const diffDays = Math.round((startOfToday - startOfTarget) / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays >= 2 && diffDays <= 6) return `${diffDays} days ago`;
  return 'More than 6 days ago';
}

/**
 * Parse Beyond Compare 5 BCSessions.xml
 */
function parseBCSessionsXml(filePath) {
  const result = {
    autoSaved: [],
    savedSessions: []
  };

  try {
    if (!fs.existsSync(filePath)) return result;
    const xml = fs.readFileSync(filePath, 'utf8');

    const typeTagMap = {
      TDirCompareSession: 'folder_compare',
      TTextCompareSession: 'text_compare',
      TTableCompareSession: 'table_compare',
      TTextMergeSession: 'text_merge',
      THexCompareSession: 'hex_compare',
      TPictureCompareSession: 'picture_compare',
      TMediaCompareSession: 'media_compare',
      TFolderMergeSession: 'folder_merge'
    };

    const parseSessionBlock = (sessionXml, isAutoSaved = false) => {
      const sessionRegex = /<(TDirCompareSession|TTextCompareSession|TTableCompareSession|TTextMergeSession|THexCompareSession|TPictureCompareSession|TMediaCompareSession|TFolderMergeSession)(?:\s+Value="([^"]*)")?>([\s\S]*?)<\/\1>/g;
      let match;
      const list = [];
      while ((match = sessionRegex.exec(sessionXml)) !== null) {
        const typeTag = match[1];
        const rawName = match[2] || '';
        const body = match[3];

        const lastModMatch = body.match(/<LastModified\s+Value="([^"]*)"/);
        const lastModified = lastModMatch ? lastModMatch[1] : null;

        const leftMatch = body.match(/<Left\s+Value="([^"]*)"/);
        const rightMatch = body.match(/<Right\s+Value="([^"]*)"/);

        const leftPath = leftMatch ? leftMatch[1] : '';
        const rightPath = rightMatch ? rightMatch[1] : '';

        let name = rawName
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .trim();

        if (!name && (leftPath || rightPath)) {
          const baseL = path.basename(leftPath) || leftPath;
          const baseR = path.basename(rightPath) || rightPath;
          name = (baseL === baseR) ? baseL : `${baseL} <--> ${baseR}`;
        }

        if (name && (leftPath || rightPath)) {
          list.push({
            id: 'bc-' + Buffer.from(name + leftPath + rightPath).toString('hex').slice(0, 12),
            name: name,
            type: typeTagMap[typeTag] || 'folder_compare',
            leftPath: leftPath,
            rightPath: rightPath,
            lastModified: lastModified || new Date().toISOString().replace('T', ' ').slice(0, 19),
            group: getRelativeDateGroup(lastModified),
            source: 'Beyond Compare 5',
            isAutoSaved: isAutoSaved
          });
        }
      }
      return list;
    };

    const autoFolderMatch = xml.match(/<TSessionFolder>[\s\r\n]*<Items>[\s\r\n]*<TSessionFolder>[\s\r\n]*<Items>([\s\S]*?)<\/Items>[\s\r\n]*<\/TSessionFolder>/);

    if (autoFolderMatch) {
      result.autoSaved = parseSessionBlock(autoFolderMatch[1], true);
      const remainingXml = xml.replace(autoFolderMatch[0], '');
      result.savedSessions = parseSessionBlock(remainingXml, false);
    } else {
      result.autoSaved = parseSessionBlock(xml, true);
    }
  } catch (err) {
    console.error('Error parsing BCSessions.xml:', err);
  }
  return result;
}

/**
 * Load DiffCore custom sessions from local json
 */
function loadDiffCoreSessions() {
  try {
    if (fs.existsSync(DIFFCORE_SESSIONS_FILE)) {
      const data = fs.readFileSync(DIFFCORE_SESSIONS_FILE, 'utf8');
      const items = JSON.parse(data);
      return items.map(it => ({
        ...it,
        group: getRelativeDateGroup(it.lastModified),
        source: 'DiffCore'
      }));
    }
  } catch (err) {
    console.error('Error reading .diffcore_sessions.json:', err);
  }
  return [];
}

/**
 * Load DiffCore auto-saved history from local json
 */
function loadDiffCoreAutoSaved() {
  try {
    if (fs.existsSync(DIFFCORE_AUTOSAVED_FILE)) {
      const data = fs.readFileSync(DIFFCORE_AUTOSAVED_FILE, 'utf8');
      const items = JSON.parse(data);
      return items.map(it => ({
        ...it,
        group: getRelativeDateGroup(it.lastModified),
        source: it.source || 'DiffCore',
        isAutoSaved: true
      }));
    }
  } catch (err) {
    console.error('Error reading .diffcore_autosaved.json:', err);
  }
  return [];
}

/**
 * Record an auto-saved session upon comparison
 */
function recordAutoSavedSession(sessionData) {
  const { type = 'folder_compare', name, leftPath = '', rightPath = '' } = sessionData || {};
  if (!leftPath && !rightPath) {
    return { success: false, error: 'Empty paths' };
  }

  try {
    let list = [];
    if (fs.existsSync(DIFFCORE_AUTOSAVED_FILE)) {
      try {
        list = JSON.parse(fs.readFileSync(DIFFCORE_AUTOSAVED_FILE, 'utf8'));
      } catch {
        list = [];
      }
    }

    const norm = (p) => (p || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const baseL = path.basename(leftPath) || leftPath;
    const baseR = path.basename(rightPath) || rightPath;
    let sessName = name;
    if (!sessName || sessName === 'Folder Compare' || sessName === 'Text Compare') {
      const savedList = loadDiffCoreSessions();
      const matchSaved = savedList.find(s => s.type === type && norm(s.leftPath) === norm(leftPath) && norm(s.rightPath) === norm(rightPath));
      if (matchSaved && matchSaved.name) {
        sessName = matchSaved.name;
      } else if (baseL && baseR) {
        sessName = (baseL === baseR) ? baseL : `${baseL} <--> ${baseR}`;
      } else {
        sessName = baseL || baseR || 'Untitled';
      }
    }

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const nowStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    // Remove any previous entry with identical type and paths (or same name) to bring it to top
    list = list.filter(s => {
      const sameType = s.type === type;
      if (!sameType) return true;
      const samePaths = (norm(s.leftPath) === norm(leftPath) && norm(s.rightPath) === norm(rightPath));
      const invertedPaths = (norm(s.leftPath) === norm(rightPath) && norm(s.rightPath) === norm(leftPath));
      const sameName = sessName && s.name && s.name.toLowerCase() === sessName.toLowerCase();
      return !samePaths && !invertedPaths && !sameName;
    });

    const newSess = {
      id: 'dc-auto-' + Date.now().toString(36),
      name: sessName,
      type: type,
      leftPath: leftPath,
      rightPath: rightPath,
      lastModified: nowStr,
      source: 'DiffCore',
      isAutoSaved: true
    };

    list.unshift(newSess);
    if (list.length > 100) list = list.slice(0, 100);

    fs.writeFileSync(DIFFCORE_AUTOSAVED_FILE, JSON.stringify(list, null, 2), 'utf8');

    // Unmark any tombstone so active/opened sessions are never hidden
    unmarkDeletedSession(newSess.id, sessName);
    if (baseL) unmarkDeletedSession(null, baseL);
    if (baseR) unmarkDeletedSession(null, baseR);

    // Also update saved session lastModified if it matches a saved session
    touchSavedSessionTimestamp(sessName, leftPath, rightPath, type, nowStr);

    // Also update Beyond Compare 5 BCSessions.xml if accessible
    updateBCSessionsXmlAutoSaved(newSess);

    return { success: true, session: newSess };
  } catch (err) {
    console.error('Error recording auto-saved session:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Safely prepend/update auto-saved session in Beyond Compare 5 BCSessions.xml
 */
function updateBCSessionsXmlAutoSaved(session) {
  try {
    const bcDir = getBCConfigDir();
    const bcFile = path.join(bcDir, 'BCSessions.xml');
    if (!fs.existsSync(bcFile)) return;

    let xml = fs.readFileSync(bcFile, 'utf8');
    const autoMatch = xml.match(/(<TSessionFolder>[\s\r\n]*<Items>[\s\r\n]*<TSessionFolder>[\s\r\n]*<Items>)([\s\S]*?)(<\/Items>[\s\r\n]*<\/TSessionFolder>)/);
    if (!autoMatch) return;

    const prefix = autoMatch[1];
    let itemsBlock = autoMatch[2];
    const suffix = autoMatch[3];

    const tagMap = {
      folder_compare: 'TDirCompareSession',
      text_compare: 'TTextCompareSession',
      table_compare: 'TTableCompareSession',
      text_merge: 'TTextMergeSession',
      hex_compare: 'THexCompareSession',
      picture_compare: 'TPictureCompareSession',
      media_compare: 'TMediaCompareSession',
      folder_merge: 'TFolderMergeSession'
    };
    const tagName = tagMap[session.type] || 'TDirCompareSession';

    // Remove old matching session from itemsBlock if it exists
    const escapedName = session.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const removeRegex = new RegExp(`[ \\t]*<${tagName}\\s+Value="${escapedName}">[\\s\\S]*?<\\/${tagName}>\\r?\\n?`, 'g');
    itemsBlock = itemsBlock.replace(removeRegex, '');

    const escapedXmlName = session.name
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    const newSessionXml = `\n\t\t\t\t\t<${tagName} Value="${escapedXmlName}">\n` +
      `\t\t\t\t\t\t<LastModified Value="${session.lastModified}"/>\n` +
      `\t\t\t\t\t\t<Specs>\n` +
      `\t\t\t\t\t\t\t<Left Value="${session.leftPath}"/>\n` +
      `\t\t\t\t\t\t\t<Right Value="${session.rightPath}"/>\n` +
      `\t\t\t\t\t\t</Specs>\n` +
      `\t\t\t\t\t</${tagName}>`;

    const newXml = xml.replace(autoMatch[0], `${prefix}${newSessionXml}${itemsBlock}${suffix}`);
    fs.writeFileSync(bcFile, newXml, 'utf8');
  } catch (err) {
    // Non-critical: DiffCore local store is already saved
    console.warn('Could not sync with BCSessions.xml:', err.message);
  }
}

const loadDeletedSessionIds = () => {
  try {
    if (fs.existsSync(DIFFCORE_DELETED_FILE)) {
      return new Set(JSON.parse(fs.readFileSync(DIFFCORE_DELETED_FILE, 'utf8')));
    }
  } catch {}
  return new Set();
};

const recordDeletedSessionId = (id, name) => {
  try {
    const set = loadDeletedSessionIds();
    if (id) set.add(id);
    if (name) set.add('name:' + name);
    fs.writeFileSync(DIFFCORE_DELETED_FILE, JSON.stringify([...set], null, 2), 'utf8');
  } catch {}
};

const unmarkDeletedSession = (id, name) => {
  try {
    const set = loadDeletedSessionIds();
    let changed = false;
    if (id && set.has(id)) { set.delete(id); changed = true; }
    if (name) {
      if (set.has(name)) { set.delete(name); changed = true; }
      if (set.has('name:' + name)) { set.delete('name:' + name); changed = true; }
    }
    if (changed) {
      fs.writeFileSync(DIFFCORE_DELETED_FILE, JSON.stringify([...set], null, 2), 'utf8');
    }
  } catch {}
};

function touchSavedSessionTimestamp(name, leftPath, rightPath, type, nowStr) {
  try {
    if (fs.existsSync(DIFFCORE_SESSIONS_FILE)) {
      let list = JSON.parse(fs.readFileSync(DIFFCORE_SESSIONS_FILE, 'utf8'));
      let modified = false;
      const norm = (p) => (p || '').replace(/\\/g, '/').replace(/\/+$/, '');
      for (const s of list) {
        const sameName = (name && s.name && s.name.toLowerCase() === name.toLowerCase());
        const samePaths = (s.type === type && norm(s.leftPath) === norm(leftPath) && norm(s.rightPath) === norm(rightPath));
        if (sameName || samePaths) {
          s.lastModified = nowStr;
          modified = true;
        }
      }
      if (modified) {
        fs.writeFileSync(DIFFCORE_SESSIONS_FILE, JSON.stringify(list, null, 2), 'utf8');
      }
    }
  } catch (err) {
    console.warn('Error updating saved session timestamp:', err);
  }
}

/**
 * Load all sessions (Beyond Compare + DiffCore native)
 */
function getAllSessions() {
  const bcDir = getBCConfigDir();
  const bcSessionsFile = path.join(bcDir, 'BCSessions.xml');

  const { autoSaved: bcAutoSaved, savedSessions: bcSaved } = parseBCSessionsXml(bcSessionsFile);
  const diffCoreSaved = loadDiffCoreSessions();
  const diffCoreAutoSaved = loadDiffCoreAutoSaved();

  const deletedSet = loadDeletedSessionIds();
  const norm = (p) => (p || '').replace(/\\/g, '/').replace(/\/+$/, '');

  // Deduplicate and combine auto-saved:
  // DiffCore autoSaved items come first (newest comparisons),
  // followed by BC5 autoSaved items if not already present.
  const autoMap = new Map();
  const nameMap = new Map();

  diffCoreAutoSaved.forEach(s => {
    if (!deletedSet.has(s.id)) {
      const key = `${s.type}:${norm(s.leftPath)}=>${norm(s.rightPath)}`;
      autoMap.set(key, s);
      if (s.name) {
        nameMap.set(`${s.type}:${s.name.toLowerCase()}`, s);
      }
    }
  });

  bcAutoSaved.forEach(s => {
    if (!deletedSet.has(s.id) && !deletedSet.has('name:' + s.name)) {
      const key = `${s.type}:${norm(s.leftPath)}=>${norm(s.rightPath)}`;
      const nameKey = `${s.type}:${(s.name || '').toLowerCase()}`;
      if (!autoMap.has(key) && !nameMap.has(nameKey)) {
        autoMap.set(key, s);
      }
    }
  });

  const allAutoSaved = Array.from(autoMap.values()).map(s => ({
    ...s,
    group: getRelativeDateGroup(s.lastModified)
  }));

  // Sort autoSaved chronologically descending (newest first)
  allAutoSaved.sort((a, b) => {
    const timeA = new Date((a.lastModified || '').replace(' ', 'T')).getTime() || 0;
    const timeB = new Date((b.lastModified || '').replace(' ', 'T')).getTime() || 0;
    return timeB - timeA;
  });

  // Combine custom saved sessions
  const savedMap = new Map();
  diffCoreSaved.forEach(s => {
    if (!deletedSet.has(s.id) && !deletedSet.has('name:' + s.name)) {
      savedMap.set(s.name, s);
    }
  });
  bcSaved.forEach(s => {
    if (!deletedSet.has(s.id) && !deletedSet.has('name:' + s.name) && !savedMap.has(s.name)) {
      savedMap.set(s.name, s);
    }
  });

  const allSaved = Array.from(savedMap.values());

  return {
    sessions: allSaved,
    autoSaved: allAutoSaved
  };
}

/**
 * Save or update a session in DiffCore
 */
function saveSession(sessionData) {
  try {
    let list = [];
    if (fs.existsSync(DIFFCORE_SESSIONS_FILE)) {
      list = JSON.parse(fs.readFileSync(DIFFCORE_SESSIONS_FILE, 'utf8'));
    }

    const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const session = {
      ...sessionData,
      id: sessionData.id || ('dc-' + Date.now().toString(36)),
      lastModified: nowStr
    };

    const idx = list.findIndex(s => s.id === session.id || s.name === session.name);
    if (idx >= 0) {
      list[idx] = session;
    } else {
      list.unshift(session);
    }

    fs.writeFileSync(DIFFCORE_SESSIONS_FILE, JSON.stringify(list, null, 2), 'utf8');
    return { success: true, session };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Delete a session from DiffCore and Beyond Compare 5
 */
function deleteSession(sessionId) {
  try {
    let deletedName = null;

    // 1. Delete from DiffCore sessions file
    if (fs.existsSync(DIFFCORE_SESSIONS_FILE)) {
      let list = JSON.parse(fs.readFileSync(DIFFCORE_SESSIONS_FILE, 'utf8'));
      const target = list.find(s => s.id === sessionId);
      if (target) deletedName = target.name;
      list = list.filter(s => s.id !== sessionId);
      fs.writeFileSync(DIFFCORE_SESSIONS_FILE, JSON.stringify(list, null, 2), 'utf8');
    }

    // 2. Delete from DiffCore autoSaved file
    if (fs.existsSync(DIFFCORE_AUTOSAVED_FILE)) {
      let list = JSON.parse(fs.readFileSync(DIFFCORE_AUTOSAVED_FILE, 'utf8'));
      const target = list.find(s => s.id === sessionId);
      if (target) deletedName = target.name;
      list = list.filter(s => s.id !== sessionId);
      fs.writeFileSync(DIFFCORE_AUTOSAVED_FILE, JSON.stringify(list, null, 2), 'utf8');
    }

    // 3. Delete from Beyond Compare 5 BCSessions.xml if applicable
    const bcDir = getBCConfigDir();
    const bcSessionsFile = path.join(bcDir, 'BCSessions.xml');
    if (fs.existsSync(bcSessionsFile)) {
      let xml = fs.readFileSync(bcSessionsFile, 'utf8');
      const { autoSaved, savedSessions } = parseBCSessionsXml(bcSessionsFile);
      const allBc = [...autoSaved, ...savedSessions];
      const targetBc = allBc.find(s => s.id === sessionId || (deletedName && s.name === deletedName));
      if (targetBc) {
        deletedName = targetBc.name;
        const escapedName = targetBc.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const sessionBlockRegex = new RegExp(
          `[ \\t]*<(?:TDirCompareSession|TTextCompareSession|TTableCompareSession|TTextMergeSession|THexCompareSession|TPictureCompareSession|TMediaCompareSession|TFolderMergeSession)\\s+Value="${escapedName}">[\\s\\S]*?<\\/(?:TDirCompareSession|TTextCompareSession|TTableCompareSession|TTextMergeSession|THexCompareSession|TPictureCompareSession|TMediaCompareSession|TFolderMergeSession)>\\r?\\n?`,
          'g'
        );
        const newXml = xml.replace(sessionBlockRegex, '');
        if (newXml !== xml) {
          fs.writeFileSync(bcSessionsFile, newXml, 'utf8');
        }
      }
    }

    // 4. Persist tombstone so fallback or cache never resurrects it
    recordDeletedSessionId(sessionId, deletedName);

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = {
  getBCConfigDir,
  getAllSessions,
  saveSession,
  recordAutoSavedSession,
  deleteSession
};
