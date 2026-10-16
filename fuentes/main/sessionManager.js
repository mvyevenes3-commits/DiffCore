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
    return path.join(os.homedir(), '.config/bcompare');
  }
}

const DIFFCORE_SESSIONS_FILE = path.join(os.homedir(), '.diffcore_sessions.json');

/**
 * Calculate relative group name (e.g. "Today", "Yesterday", "2 days ago", "Last week", "Older")
 */
function getRelativeDateGroup(dateStr) {
  if (!dateStr) return 'Other';
  const targetDate = new Date(dateStr.replace(' ', 'T'));
  if (isNaN(targetDate.getTime())) return 'Other';

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTarget = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());

  const diffDays = Math.round((startOfToday - startOfTarget) / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays === 2) return '2 days ago';
  if (diffDays <= 7) return 'Last week';
  if (diffDays <= 30) return 'Earlier this month';
  return 'Older';
}

/**
 * Parse Beyond Compare 5 BCSessions.xml
 */
function parseBCSessionsXml(filePath) {
  const sessions = [];
  try {
    if (!fs.existsSync(filePath)) return sessions;
    const xml = fs.readFileSync(filePath, 'utf8');

    const typeTagMap = {
      TDirCompareSession: 'folder_compare',
      TTextCompareSession: 'text_compare',
      TTableCompareSession: 'table_compare',
      TTextMergeSession: 'text_merge',
      THexCompareSession: 'hex_compare',
      TPictureCompareSession: 'picture_compare',
      TMediaCompareSession: 'media_compare'
    };

    // Match all Beyond Compare 5 session blocks
    const sessionRegex = /<(TDirCompareSession|TTextCompareSession|TTableCompareSession|TTextMergeSession|THexCompareSession|TPictureCompareSession|TMediaCompareSession)(?:\s+Value="([^"]*)")?>([\s\S]*?)<\/\1>/g;
    let match;
    while ((match = sessionRegex.exec(xml)) !== null) {
      const typeTag = match[1];
      const rawName = match[2] || '';
      const name = rawName
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .trim();
      const body = match[3];

      const lastModMatch = body.match(/<LastModified\s+Value="([^"]*)"/);
      const lastModified = lastModMatch ? lastModMatch[1] : null;

      const leftMatch = body.match(/<Left\s+Value="([^"]*)"/);
      const rightMatch = body.match(/<Right\s+Value="([^"]*)"/);

      const leftPath = leftMatch ? leftMatch[1] : '';
      const rightPath = rightMatch ? rightMatch[1] : '';

      // Only add sessions that have a valid name or paths
      if (name && (leftPath || rightPath)) {
        sessions.push({
          id: 'bc-' + Buffer.from(name).toString('hex').slice(0, 10),
          name: name,
          type: typeTagMap[typeTag] || 'folder_compare',
          leftPath: leftPath,
          rightPath: rightPath,
          lastModified: lastModified || new Date().toISOString().replace('T', ' ').slice(0, 19),
          group: getRelativeDateGroup(lastModified),
          source: 'Beyond Compare 5'
        });
      }
    }
  } catch (err) {
    console.error('Error parsing BCSessions.xml:', err);
  }
  return sessions;
}

/**
 * Parse Beyond Compare 5 BCState.xml for Auto-saved MRU items
 */
function parseBCStateXml(filePath) {
  const autoSaved = [];
  try {
    if (!fs.existsSync(filePath)) return autoSaved;
    const xml = fs.readFileSync(filePath, 'utf8');

    // Extract LeftMRUSpecs and RightMRUSpecs
    const leftBlock = xml.match(/<LeftMRUSpecs>([\s\S]*?)<\/LeftMRUSpecs>/);
    const rightBlock = xml.match(/<RightMRUSpecs>([\s\S]*?)<\/RightMRUSpecs>/);

    if (leftBlock && rightBlock) {
      const leftValues = [...leftBlock[1].matchAll(/<_\d+\s+Value="([^"]*)"/g)].map(m => m[1]);
      const rightValues = [...rightBlock[1].matchAll(/<_\d+\s+Value="([^"]*)"/g)].map(m => m[1]);

      const count = Math.min(leftValues.length, rightValues.length);
      for (let i = 0; i < count; i++) {
        const left = leftValues[i];
        const right = rightValues[i];
        const leftName = path.basename(left) || left;
        const rightName = path.basename(right) || right;
        const name = `${leftName} ⇄ ${rightName}`;

        autoSaved.push({
          id: `auto-${i}`,
          name: name,
          type: 'folder_compare',
          leftPath: left,
          rightPath: right,
          lastModified: new Date().toISOString().replace('T', ' ').slice(0, 19),
          group: 'Auto-saved',
          source: 'BC5 History'
        });
      }
    }
  } catch (err) {
    console.error('Error parsing BCState.xml:', err);
  }
  return autoSaved;
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
 * Load all sessions (Beyond Compare + DiffCore native)
 */
function getAllSessions() {
  const bcDir = getBCConfigDir();
  const bcSessionsFile = path.join(bcDir, 'BCSessions.xml');
  const bcStateFile = path.join(bcDir, 'BCState.xml');

  const bcSessions = parseBCSessionsXml(bcSessionsFile);
  const autoSavedSessions = parseBCStateXml(bcStateFile);
  const diffCoreSessions = loadDiffCoreSessions();

  // Deduplicate by name/paths
  const combinedMap = new Map();

  // 1. Add DiffCore custom sessions first
  diffCoreSessions.forEach(s => combinedMap.set(s.name, s));

  // 2. Add BC5 official sessions
  bcSessions.forEach(s => {
    if (!combinedMap.has(s.name)) {
      combinedMap.set(s.name, s);
    }
  });

  const deletedSet = loadDeletedSessionIds();
  const allSessions = Array.from(combinedMap.values()).filter(
    s => !deletedSet.has(s.id) && !deletedSet.has('name:' + s.name)
  );

  return {
    sessions: allSessions,
    autoSaved: autoSavedSessions
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

const DIFFCORE_DELETED_FILE = path.join(os.homedir(), '.diffcore_deleted_sessions.json');

function loadDeletedSessionIds() {
  try {
    if (fs.existsSync(DIFFCORE_DELETED_FILE)) {
      return new Set(JSON.parse(fs.readFileSync(DIFFCORE_DELETED_FILE, 'utf8')));
    }
  } catch {}
  return new Set();
}

function recordDeletedSessionId(id, name) {
  try {
    const set = loadDeletedSessionIds();
    if (id) set.add(id);
    if (name) set.add('name:' + name);
    fs.writeFileSync(DIFFCORE_DELETED_FILE, JSON.stringify([...set], null, 2), 'utf8');
  } catch {}
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

    // 2. Delete from Beyond Compare 5 BCSessions.xml if applicable
    const bcDir = getBCConfigDir();
    const bcSessionsFile = path.join(bcDir, 'BCSessions.xml');
    if (fs.existsSync(bcSessionsFile)) {
      let xml = fs.readFileSync(bcSessionsFile, 'utf8');
      const allBc = parseBCSessionsXml(bcSessionsFile);
      const targetBc = allBc.find(s => s.id === sessionId || (deletedName && s.name === deletedName));
      if (targetBc) {
        deletedName = targetBc.name;
        // Escape special chars for regex
        const escapedName = targetBc.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const sessionBlockRegex = new RegExp(
          `[ \\t]*<(?:TDirCompareSession|TTextCompareSession|TTableCompareSession|TTextMergeSession|THexCompareSession|TPictureCompareSession|TMediaCompareSession)\\s+Value="${escapedName}">[\\s\\S]*?<\\/(?:TDirCompareSession|TTextCompareSession|TTableCompareSession|TTextMergeSession|THexCompareSession|TPictureCompareSession|TMediaCompareSession)>\\r?\\n?`,
          'g'
        );
        const newXml = xml.replace(sessionBlockRegex, '');
        if (newXml !== xml) {
          fs.writeFileSync(bcSessionsFile, newXml, 'utf8');
        }
      }
    }

    // 3. Persist tombstone so fallback or cache never resurrects it
    recordDeletedSessionId(sessionId, deletedName);

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = {
  getAllSessions,
  saveSession,
  deleteSession
};
