// DiffCore - Beyond Compare 5 Engine Frontend

// Global Application State
let appState = {
  sessions: [],
  autoSaved: [],
  selectedSession: null,
  activeFolderSession: null,
  activeView: 'home',
  
  // Folder Compare State
  leftPath: '',
  rightPath: '',
  comparisonItems: [],
  treeRoot: null,
  treeNodeMap: new Map(),
  filteredItems: [],
  folderOpenState: new Map(),
  structureMode: true,
  selectedIndex: -1,
  selectedIndices: new Set(),
  lastClickedIndex: -1,
  currentFilter: localStorage.getItem('diffcore_filter') || 'diffs', // 'all', 'diffs', 'same', 'orphans' (default diffs)
  tableSearchQuery: '',
  contextItem: null,
  
  // Text Compare State
  currentTextFile: {
    relativePath: '',
    leftFullPath: '',
    rightFullPath: '',
    leftLines: [],
    rightLines: [],
    diffIndices: [],
    currentDiffIndex: -1
  }
};

// --- INITIALIZATION ---
window.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  setupLogging();
  setupCliListener();
  setupSyncScroll();
  setupTextSyncScroll();
  setupTextDragAndDrop();
  setupTableEventDelegation();
  setupFolderKeyboardNavigation();
  setupWindowClickHandlers();

  // Apply persisted or default filter ('diffs')
  setFilter(appState.currentFilter);

  // Re-calculate visible virtual window and sync scrollbars on resize
  window.addEventListener('resize', () => {
    if (appState.activeView === 'folder') {
      virtualScrollState.lastRenderedStart = -1;
      virtualScrollState.lastRenderedEnd = -1;
      renderVisibleWindow(true);
      if (typeof folderSyncScrollbar !== 'undefined' && folderSyncScrollbar) folderSyncScrollbar.update();
    } else if (appState.activeView === 'text') {
      syncHorizontalScrollWidths();
      renderVisibleTextWindow(true);
      if (typeof textSyncScrollbar !== 'undefined' && textSyncScrollbar) textSyncScrollbar.update();
    }
  });

  // Load dynamic sessions from Beyond Compare & DiffCore
  await reloadSessions();

  // Load system disk info
  loadSystemInfo();

  // Do not show or force any session by default if none is open
  clearSessionDetails();

  // Initialize app title and tabs nav state
  updateAppHeader();

  // Horizontal mouse-wheel scroll on tabs bar
  const tabsList = document.getElementById('appTabsList');
  if (tabsList) {
    tabsList.addEventListener('wheel', (e) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        tabsList.scrollLeft += e.deltaY;
      }
    }, { passive: false });
  }
});

function setupLogging() {
  window.api.onLogMessage((msg) => appendLog(msg));
}

function appendLog(text) {
  const logConsole = document.getElementById('logConsole');
  if (logConsole) {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.textContent = text;
    logConsole.appendChild(entry);
    logConsole.scrollTop = logConsole.scrollHeight;
  }
}

function toggleLogPanel() {
  const panel = document.getElementById('logPanel');
  panel.classList.toggle('collapsed');
}

function setupCliListener() {
  window.api.onCliLaunch((data) => {
    if (data.type === 'folder_compare') {
      openFolderCompare(data.left, data.right, 'CLI Compare');
    } else if (data.type === 'text_compare') {
      openTextCompare(data.left, data.right, data.left);
    }
  });
}

function setupWindowClickHandlers() {
  window.addEventListener('click', (event) => {
    const menu = document.getElementById('folderContextMenu');
    if (menu && menu.style.display !== 'none') {
      if (!menu.contains(event.target)) {
        menu.style.display = 'none';
      }
    }
  });
}

// --- DYNAMIC SESSIONS MANAGEMENT ---
async function reloadSessions() {
  try {
    const data = await window.api.loadSessions();
    appState.sessions = data.sessions || [];
    appState.autoSaved = data.autoSaved || [];
    renderSessionsTree();
    updateAutoSavedBadge();
  } catch (err) {
    appendLog(`Error loading sessions: ${err.message}`);
  }
}

function updateAutoSavedBadge() {
  const badge = document.getElementById('autoSavedCountBadge');
  if (badge) badge.textContent = (appState.autoSaved || []).length;
}

function renderSessionsTree() {
  const container = document.getElementById('dynamicSessionsTree');
  if (!container) return;
  container.innerHTML = '';

  const query = (appState.sessionSearchQuery || '').toLowerCase();

  // Initialize expanded groups set if not yet present
  if (!appState.expandedSessionGroups) {
    appState.expandedSessionGroups = new Set(['auto-saved', 'Today', 'Yesterday']);
  }

  const iconMap = {
    folder_compare: '<span class="dc-icon dc-icon-folder"></span>',
    folder_sync: '<span class="dc-icon dc-icon-sync"></span>',
    folder_merge: '<span class="dc-icon dc-icon-merge"></span>',
    text_compare: '<span class="dc-icon dc-icon-file-text"></span>',
    text_merge: '<span class="dc-icon dc-icon-merge"></span>',
    text_edit: '<span class="dc-icon dc-icon-edit"></span>',
    hex_compare: '<span class="dc-icon dc-icon-hex"></span>',
    picture_compare: '<span class="dc-icon dc-icon-picture"></span>',
    table_compare: '<span class="dc-icon dc-icon-table"></span>',
    media_compare: '<span class="dc-icon dc-icon-music"></span>'
  };

  // 1. AUTO-SAVED GROUP
  const autoSavedList = appState.autoSaved || [];
  const filteredAutoSaved = autoSavedList.filter(sess => {
    if (!query) return true;
    return (sess.name && sess.name.toLowerCase().includes(query)) ||
           (sess.leftPath && sess.leftPath.toLowerCase().includes(query)) ||
           (sess.rightPath && sess.rightPath.toLowerCase().includes(query));
  });

  // Group auto-saved sessions by their relative date group
  const dateGroupsMap = new Map();
  const dateGroupOrder = [
    'Today',
    'Yesterday',
    '2 days ago',
    '3 days ago',
    '4 days ago',
    '5 days ago',
    '6 days ago',
    'More than 6 days ago',
    'Other'
  ];

  filteredAutoSaved.forEach(sess => {
    const gName = sess.group || 'More than 6 days ago';
    if (!dateGroupsMap.has(gName)) dateGroupsMap.set(gName, []);
    dateGroupsMap.get(gName).push(sess);
  });

  // If query is present, auto-expand all groups
  if (query) {
    appState.expandedSessionGroups.add('auto-saved');
    dateGroupsMap.forEach((_, gName) => appState.expandedSessionGroups.add(gName));
  } else {
    // If Today and Yesterday are both empty, expand the first available date group
    const hasRecent = dateGroupsMap.has('Today') || dateGroupsMap.has('Yesterday');
    if (!hasRecent && dateGroupsMap.size > 0) {
      const firstAvailable = Array.from(dateGroupsMap.keys())[0];
      appState.expandedSessionGroups.add(firstAvailable);
    }
  }

  const isAutoRootExpanded = appState.expandedSessionGroups.has('auto-saved');
  const autoSavedRoot = document.createElement('div');
  autoSavedRoot.className = 'session-group';

  const autoRootHeader = document.createElement('div');
  autoRootHeader.className = `session-group-header ${isAutoRootExpanded ? '' : 'collapsed'}`;
  autoRootHeader.innerHTML = `
    <span><span class="group-arrow">▼</span> <span>💾</span> Auto-saved</span>
    <span class="session-sub" id="autoSavedCountBadge">${filteredAutoSaved.length}</span>
  `;
  autoRootHeader.onclick = (e) => {
    e.stopPropagation();
    if (appState.expandedSessionGroups.has('auto-saved')) {
      appState.expandedSessionGroups.delete('auto-saved');
    } else {
      appState.expandedSessionGroups.add('auto-saved');
    }
    renderSessionsTree();
  };

  const autoRootItems = document.createElement('div');
  autoRootItems.className = `session-group-items ${isAutoRootExpanded ? '' : 'collapsed'}`;

  // Sort available date groups by predefined order
  const availableGroups = Array.from(dateGroupsMap.keys()).sort((a, b) => {
    const idxA = dateGroupOrder.indexOf(a);
    const idxB = dateGroupOrder.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
  });

  availableGroups.forEach(gName => {
    const list = dateGroupsMap.get(gName);
    const isGroupExpanded = appState.expandedSessionGroups.has(gName);

    const subGroup = document.createElement('div');
    subGroup.className = 'session-subgroup';

    const subHeader = document.createElement('div');
    subHeader.className = `session-subgroup-header ${isGroupExpanded ? '' : 'collapsed'}`;
    subHeader.innerHTML = `
      <span><span class="group-arrow">▼</span> 📁 ${escapeHtml(gName)}</span>
      <span class="session-sub">${list.length}</span>
    `;
    subHeader.onclick = (e) => {
      e.stopPropagation();
      if (appState.expandedSessionGroups.has(gName)) {
        appState.expandedSessionGroups.delete(gName);
      } else {
        appState.expandedSessionGroups.add(gName);
      }
      renderSessionsTree();
    };

    const subItems = document.createElement('div');
    subItems.className = `session-subgroup-items ${isGroupExpanded ? '' : 'collapsed'}`;

    list.forEach(sess => {
      const itemEl = document.createElement('div');
      itemEl.className = 'session-item';
      if (appState.selectedSession && appState.selectedSession.id === sess.id) {
        itemEl.classList.add('selected');
      }
      itemEl.id = `sess-${sess.id}`;
      const icon = iconMap[sess.type] || '<span class="dc-icon dc-icon-folder"></span>';
      itemEl.innerHTML = `
        <span>${icon}</span>
        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;" title="${escapeHtml(sess.name)}">${escapeHtml(sess.name)}</span>
      `;
      itemEl.onclick = (e) => {
        e.stopPropagation();
        selectSession(sess.id);
      };
      itemEl.ondblclick = (e) => {
        e.stopPropagation();
        selectSession(sess.id);
        launchSelectedSession();
      };

      subItems.appendChild(itemEl);
    });

    subGroup.appendChild(subHeader);
    subGroup.appendChild(subItems);
    autoRootItems.appendChild(subGroup);
  });

  autoSavedRoot.appendChild(autoRootHeader);
  autoSavedRoot.appendChild(autoRootItems);
  container.appendChild(autoSavedRoot);

  // 2. SAVED SESSIONS GROUP (DiffCore custom saved sessions if any)
  const savedList = (appState.sessions || []).filter(sess => {
    if (!query) return true;
    return (sess.name && sess.name.toLowerCase().includes(query)) ||
           (sess.leftPath && sess.leftPath.toLowerCase().includes(query)) ||
           (sess.rightPath && sess.rightPath.toLowerCase().includes(query));
  });

  if (savedList.length > 0) {
    const isSavedExpanded = appState.expandedSessionGroups.has('saved-sessions');
    const savedRoot = document.createElement('div');
    savedRoot.className = 'session-group';

    const savedHeader = document.createElement('div');
    savedHeader.className = `session-group-header ${isSavedExpanded ? '' : 'collapsed'}`;
    savedHeader.innerHTML = `
      <span><span class="group-arrow">▼</span> 📁 Saved Sessions</span>
      <span class="session-sub">${savedList.length}</span>
    `;
    savedHeader.onclick = (e) => {
      e.stopPropagation();
      if (appState.expandedSessionGroups.has('saved-sessions')) {
        appState.expandedSessionGroups.delete('saved-sessions');
      } else {
        appState.expandedSessionGroups.add('saved-sessions');
      }
      renderSessionsTree();
    };

    const savedItems = document.createElement('div');
    savedItems.className = `session-group-items ${isSavedExpanded ? '' : 'collapsed'}`;

    savedList.forEach(sess => {
      const itemEl = document.createElement('div');
      itemEl.className = 'session-item';
      if (appState.selectedSession && appState.selectedSession.id === sess.id) {
        itemEl.classList.add('selected');
      }
      itemEl.id = `sess-${sess.id}`;
      const icon = iconMap[sess.type] || '<span class="dc-icon dc-icon-folder"></span>';
      itemEl.innerHTML = `
        <span>${icon}</span>
        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;" title="${escapeHtml(sess.name)}">${escapeHtml(sess.name)}</span>
      `;
      itemEl.onclick = (e) => {
        e.stopPropagation();
        selectSession(sess.id);
      };
      itemEl.ondblclick = (e) => {
        e.stopPropagation();
        selectSession(sess.id);
        launchSelectedSession();
      };
      savedItems.appendChild(itemEl);
    });

    savedRoot.appendChild(savedHeader);
    savedRoot.appendChild(savedItems);
    container.appendChild(savedRoot);
  }
}

function selectSession(sessionId) {
  const sess = (appState.selectedSession && appState.selectedSession.id === sessionId) ?
               appState.selectedSession :
               (appState.sessions.find(s => s.id === sessionId) || appState.autoSaved.find(s => s.id === sessionId));
  if (!sess) {
    clearSessionDetails();
    return;
  }

  appState.selectedSession = sess;

  // Update UI selection highlight
  document.querySelectorAll('.session-item').forEach(el => el.classList.remove('selected'));
  const el = document.getElementById(`sess-${sessionId}`);
  if (el) el.classList.add('selected');

  // Show Top Details Card
  const headerCard = document.getElementById('sessionHeaderDetails');
  if (headerCard) headerCard.style.display = 'block';

  // Update Top Details Card icon and text
  const iconMap = {
    folder_compare: '<span class="dc-icon dc-icon-folder"></span>',
    folder_sync: '<span class="dc-icon dc-icon-sync"></span>',
    folder_merge: '<span class="dc-icon dc-icon-merge"></span>',
    text_compare: '<span class="dc-icon dc-icon-file-text"></span>',
    text_merge: '<span class="dc-icon dc-icon-merge"></span>',
    text_edit: '<span class="dc-icon dc-icon-edit"></span>',
    hex_compare: '<span class="dc-icon dc-icon-hex"></span>',
    picture_compare: '<span class="dc-icon dc-icon-picture"></span>',
    table_compare: '<span class="dc-icon dc-icon-table"></span>',
    media_compare: '<span class="dc-icon dc-icon-music"></span>'
  };
  const iconEl = document.getElementById('sessionDetailIcon');
  if (iconEl) iconEl.innerHTML = iconMap[sess.type] || '<span class="dc-icon dc-icon-folder"></span>';
  const titleEl = document.getElementById('sessionDetailTitle');
  if (titleEl) titleEl.textContent = sess.name;
  const leftEl = document.getElementById('sessionDetailLeft');
  if (leftEl) leftEl.textContent = sess.leftPath || '(empty)';
  const rightEl = document.getElementById('sessionDetailRight');
  if (rightEl) rightEl.textContent = sess.rightPath || '(empty)';
  const srcEl = document.getElementById('sessionDetailSource');
  if (srcEl) srcEl.textContent = sess.source ? `(${sess.source})` : '';

  // Pre-fill Folder Compare inputs
  appState.leftPath = sess.leftPath || '';
  appState.rightPath = sess.rightPath || '';
  const inL = document.getElementById('leftPathInput');
  const inR = document.getElementById('rightPathInput');
  if (inL) inL.value = sess.leftPath || '';
  if (inR) inR.value = sess.rightPath || '';
}

function clearSessionDetails() {
  appState.selectedSession = null;
  const headerCard = document.getElementById('sessionHeaderDetails');
  if (headerCard) headerCard.style.display = 'none';
  const titleEl = document.getElementById('sessionDetailTitle');
  if (titleEl) titleEl.textContent = '';
  const leftEl = document.getElementById('sessionDetailLeft');
  if (leftEl) leftEl.textContent = '';
  const rightEl = document.getElementById('sessionDetailRight');
  if (rightEl) rightEl.textContent = '';
  const srcEl = document.getElementById('sessionDetailSource');
  if (srcEl) srcEl.textContent = '';
  document.querySelectorAll('.session-item').forEach(el => el.classList.remove('selected'));
}

function launchSelectedSession() {
  if (!appState.selectedSession) return;
  const sess = appState.selectedSession;
  const type = sess.type || 'folder_compare';
  if (type === 'text_compare') {
    openTextCompare(sess.leftPath, sess.rightPath, sess.name);
  } else if (type === 'table_compare') {
    openTableCompare(sess.leftPath, sess.rightPath, sess.name);
  } else if (type === 'hex_compare') {
    openHexCompare(sess.leftPath, sess.rightPath, sess.name);
  } else if (type === 'picture_compare') {
    openPictureCompare(sess.leftPath, sess.rightPath, sess.name);
  } else if (type === 'media_compare') {
    openMediaCompare(sess.leftPath, sess.rightPath, sess.name);
  } else if (type === 'folder_sync') {
    openFolderSync(sess.leftPath, sess.rightPath, sess.name);
  } else if (type === 'folder_merge') {
    openFolderMerge(sess.leftPath, '', sess.rightPath, sess.name);
  } else if (type === 'text_merge') {
    openTextMerge(sess.leftPath, '', sess.rightPath, sess.name);
  } else if (type === 'text_edit') {
    openTextEdit(sess.leftPath || sess.rightPath, sess.name);
  } else {
    openFolderCompare(sess.leftPath, sess.rightPath, sess.name);
  }
}

function openFolderCompare(left = '', right = '', sessionName = 'Folder Compare') {
  appState.leftPath = left || '';
  appState.rightPath = right || '';

  const inL = document.getElementById('leftPathInput');
  const inR = document.getElementById('rightPathInput');
  if (inL) {
    inL.value = left || '';
    inL.placeholder = 'Enter path here';
  }
  if (inR) {
    inR.value = right || '';
    inR.placeholder = 'Enter path here';
  }

  const tabTitle = document.getElementById('currentSessionTabTitle');
  if (tabTitle) {
    const clean = (sessionName || 'Folder Compare').replace(/^New\s+/, '').replace(/\s*-\s*Folder Compare$/, '');
    tabTitle.textContent = clean || 'Folder Compare';
  }

  const tabFolderBtn = document.getElementById('tabFolderBtn');
  if (tabFolderBtn) tabFolderBtn.style.display = 'flex';

  switchView('folder');

  if (left || right) {
    appState.selectedSession = {
      id: 'active-folder',
      name: sessionName || 'Folder Compare',
      type: 'folder_compare',
      leftPath: left,
      rightPath: right,
      source: 'Active'
    };
    appState.activeFolderSession = appState.selectedSession;
  }

  if (!left && !right) {
    renderEmptyFolderCompare(sessionName);
    setTimeout(() => {
      if (inL) inL.focus();
    }, 50);
    return;
  }

  if (left && !right) {
    runSingleSideFolder('left');
    return;
  }
  if (!left && right) {
    runSingleSideFolder('right');
    return;
  }

  runFolderComparison();
}

function renderEmptyFolderCompare(sessionName = 'New Folder Compare') {
  appState.leftPath = '';
  appState.rightPath = '';
  appState.comparisonItems = [];
  appState.treeRoot = null;
  appState.treeFlattened = [];

  const inL = document.getElementById('leftPathInput');
  const inR = document.getElementById('rightPathInput');
  if (inL) inL.value = '';
  if (inR) inR.value = '';

  const tabTitle = document.getElementById('currentSessionTabTitle');
  if (tabTitle) tabTitle.textContent = sessionName.includes('-') ? sessionName : `${sessionName} - Folder Compare`;

  const leftBody = document.getElementById('leftTableBody');
  const rightBody = document.getElementById('rightTableBody');
  if (leftBody) {
    leftBody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; padding: 80px 20px; color: #666; font-family: var(--font-sans); cursor: pointer;" onclick="browseFolder('left')">
          <div style="font-size: 40px; margin-bottom: 8px; opacity: 0.6;">📁</div>
          <div style="font-size: 13px; font-weight: 500;">Drop left folder here, or click 📁▾ to browse</div>
        </td>
      </tr>
    `;
  }
  if (rightBody) {
    rightBody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; padding: 80px 20px; color: #666; font-family: var(--font-sans); cursor: pointer;" onclick="browseFolder('right')">
          <div style="font-size: 40px; margin-bottom: 8px; opacity: 0.6;">📁</div>
          <div style="font-size: 13px; font-weight: 500;">Drop right folder here, or click 📁▾ to browse</div>
        </td>
      </tr>
    `;
  }

  const sLC = document.getElementById('statusLeftCount');
  const sLS = document.getElementById('statusLeftSize');
  const sLD = document.getElementById('statusLeftDisk');
  const sRC = document.getElementById('statusRightCount');
  const sRS = document.getElementById('statusRightSize');
  const sRD = document.getElementById('statusRightDisk');

  if (sLC) sLC.textContent = '0 items';
  if (sLS) sLS.textContent = '0 bytes';
  if (sLD) sLD.textContent = 'Editing disabled';
  if (sRC) sRC.textContent = '0 items';
  if (sRS) sRS.textContent = '0 bytes';
  if (sRD) sRD.textContent = 'Editing disabled';

  appendLog('Load comparison: <-->');
}

function handleFolderPathKeydown(event, side) {
  if (event.key === 'Enter') {
    handleFolderPathBlur(side);
  }
}

async function handleFolderPathBlur(side) {
  const inL = document.getElementById('leftPathInput');
  const inR = document.getElementById('rightPathInput');
  const pathL = inL ? inL.value.trim() : '';
  const pathR = inR ? inR.value.trim() : '';

  appState.leftPath = pathL;
  appState.rightPath = pathR;

  if (pathL && pathR) {
    runFolderComparison();
  } else if (pathL || pathR) {
    const activeSide = pathL ? 'left' : 'right';
    runSingleSideFolder(activeSide);
  } else {
    renderEmptyFolderCompare();
  }
}

async function runSingleSideFolder(loadedSide) {
  const p = loadedSide === 'left' ? appState.leftPath : appState.rightPath;
  if (!p) {
    renderEmptyFolderCompare();
    return;
  }

  // Clear folder open state so folders appear collapsed by default
  appState.folderOpenState.clear();

  appendLog(`Load folder: ${p}`);
  const result = await window.api.compareFolders(
    loadedSide === 'left' ? p : '',
    loadedSide === 'right' ? p : ''
  );

  if (result.success) {
    appState.comparisonItems = result.items;
    appState.treeRoot = buildComparisonTree(result.items);
    applyFilterAndRender();
    updateStatusBar();
  } else {
    showToast(`Error scanning folder: ${result.error}`, 'error');
  }
}

function toggleAutoSavedGroup() {
  if (!appState.expandedSessionGroups) {
    appState.expandedSessionGroups = new Set(['auto-saved', 'Today', 'Yesterday']);
  }
  if (appState.expandedSessionGroups.has('auto-saved')) {
    appState.expandedSessionGroups.delete('auto-saved');
  } else {
    appState.expandedSessionGroups.add('auto-saved');
  }
  renderSessionsTree();
}

function filterSessionsList() {
  const val = document.getElementById('sessionSearchInput').value;
  appState.sessionSearchQuery = val;
  renderSessionsTree();
}

// --- MODAL: CREATE / EDIT SESSION ---
function promptNewSession() {
  document.getElementById('sessionModalHeaderTitle').textContent = 'New Comparison Session';
  document.getElementById('editSessionName').value = 'New Folder Compare';
  document.getElementById('editSessionLeft').value = appState.leftPath || '';
  document.getElementById('editSessionRight').value = appState.rightPath || '';
  document.getElementById('sessionEditModal').classList.add('active');
  document.getElementById('sessionEditModal').dataset.mode = 'new';
}

function editSelectedSession() {
  if (!appState.selectedSession) return;
  const sess = appState.selectedSession;
  document.getElementById('sessionModalHeaderTitle').textContent = 'Edit Session';
  document.getElementById('editSessionName').value = sess.name;
  document.getElementById('editSessionLeft').value = sess.leftPath;
  document.getElementById('editSessionRight').value = sess.rightPath;
  document.getElementById('sessionEditModal').classList.add('active');
  document.getElementById('sessionEditModal').dataset.mode = 'edit';
  document.getElementById('sessionEditModal').dataset.id = sess.id;
}

function closeSessionModal() {
  document.getElementById('sessionEditModal').classList.remove('active');
}

async function browseModalFolder(side) {
  const currentVal = side === 'left' ? 
    document.getElementById('editSessionLeft').value : 
    document.getElementById('editSessionRight').value;
  const selected = await window.api.selectFolder(currentVal);
  if (selected) {
    if (side === 'left') document.getElementById('editSessionLeft').value = selected;
    else document.getElementById('editSessionRight').value = selected;
  }
}

async function saveSessionFromModal() {
  const name = document.getElementById('editSessionName').value.trim();
  const left = document.getElementById('editSessionLeft').value.trim();
  const right = document.getElementById('editSessionRight').value.trim();

  if (!name) {
    alert('Please enter a session name.');
    return;
  }

  const modal = document.getElementById('sessionEditModal');
  const mode = modal.dataset.mode;
  const id = mode === 'edit' ? modal.dataset.id : null;

  const res = await window.api.saveSession({
    id,
    name,
    type: 'folder_compare',
    leftPath: left,
    rightPath: right
  });

  if (res.success) {
    closeSessionModal();
    await reloadSessions();
    if (res.session) selectSession(res.session.id);
  } else {
    alert('Error saving session: ' + (res.error || 'Unknown error'));
  }
}

async function deleteSelectedSession() {
  if (!appState.selectedSession) return;
  const sess = appState.selectedSession;
  if (!confirm(`Are you sure you want to delete session "${sess.name}"?`)) return;

  await window.api.deleteSession(sess.id);
  clearSessionDetails();
  await reloadSessions();
}

// --- TOOLS GRID LAUNCHER (10 Tools from Image 3) ---
function openTool(toolName) {
  appendLog(`Tool selected: ${toolName}`);
  if (toolName === 'folder_compare') {
    openFolderCompare('', '', 'Folder Compare');
  } else if (toolName === 'folder_merge') {
    openFolderMerge('', '', '', 'Folder Merge');
  } else if (toolName === 'folder_sync') {
    openFolderSync('', '', 'Folder Sync');
  } else if (toolName === 'text_compare') {
    openTextCompare('', '', 'Text Compare');
  } else if (toolName === 'text_merge') {
    openTextMerge('', '', '', 'Text Merge');
  } else if (toolName === 'text_edit') {
    openTextEdit('', 'Text Edit');
  } else if (toolName === 'hex_compare') {
    openHexCompare('', '', 'Hex Compare');
  } else if (toolName === 'picture_compare') {
    openPictureCompare('', '', 'Picture Compare');
  } else if (toolName === 'media_compare') {
    openMediaCompare('', '', 'Media Compare');
  } else if (toolName === 'table_compare') {
    openTableCompare('', '', 'Table Compare');
  } else {
    openFolderCompare('', '', 'Folder Compare');
  }
}

async function openTextCompareDialog() {
  const leftFile = await window.api.selectFile(appState.leftPath);
  if (!leftFile) return;
  const rightFile = await window.api.selectFile(appState.rightPath || leftFile);
  if (!rightFile) return;
  openTextCompare(leftFile, rightFile, leftFile);
}

// --- VIEW / TABS SWITCHING ---
function switchView(viewName) {
  appState.activeView = viewName;
  document.querySelectorAll('.view-container').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));

  const viewMap = {
    folder: { view: 'folderView', tab: 'tabFolderBtn' },
    foldersync: { view: 'folderSyncView', tab: 'tabFolderSyncBtn' },
    foldermerge: { view: 'folderMergeView', tab: 'tabFolderMergeBtn' },
    text: { view: 'textView', tab: 'tabTextBtn' },
    textmerge: { view: 'textMergeView', tab: 'tabTextMergeBtn' },
    textedit: { view: 'textEditView', tab: 'tabTextEditBtn' },
    hex: { view: 'hexView', tab: 'tabHexBtn' },
    picture: { view: 'pictureView', tab: 'tabPictureBtn' },
    table: { view: 'tableCompareView', tab: 'tabTableBtn' },
    media: { view: 'mediaView', tab: 'tabMediaBtn' }
  };

  if (viewName === 'home') {
    const vEl = document.getElementById('homeView');
    if (vEl) vEl.classList.add('active');

    updateAppHeader();
    reloadSessions();

    const targetSession = appState.activeFolderSession || appState.selectedSession;
    if (targetSession && targetSession.id) {
      selectSession(targetSession.id);
    } else {
      clearSessionDetails();
    }
    return;
  }

  const target = viewMap[viewName];
  if (target) {
    const vEl = document.getElementById(target.view);
    const tEl = document.getElementById(target.tab);
    if (vEl) vEl.classList.add('active');
    if (tEl) {
      tEl.classList.add('active');
      tEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }

  if (viewName === 'folder' && typeof folderSyncScrollbar !== 'undefined' && folderSyncScrollbar) {
    requestAnimationFrame(() => folderSyncScrollbar.update());
  } else if (viewName === 'text' && typeof textSyncScrollbar !== 'undefined' && textSyncScrollbar) {
    requestAnimationFrame(() => textSyncScrollbar.update());
  }

  updateAppHeader();
}

function updateAppHeader() {
  const titleEl = document.getElementById('appTitleCenter');
  let title = 'DiffCore';

  switch (appState.activeView) {
    case 'home':
      title = 'Home';
      break;
    case 'folder': {
      const name = document.getElementById('currentSessionTabTitle')?.textContent?.trim() || 'Folder Compare';
      title = `${name} - Folder Compare`;
      break;
    }
    case 'foldersync': {
      const name = document.getElementById('currentFolderSyncTabTitle')?.textContent?.trim() || 'Folder Sync';
      title = `${name} - Folder Sync`;
      break;
    }
    case 'foldermerge': {
      const name = document.getElementById('currentFolderMergeTabTitle')?.textContent?.trim() || 'Folder Merge';
      title = `${name} - Folder Merge`;
      break;
    }
    case 'text': {
      const name = document.getElementById('currentTextTabTitle')?.textContent?.trim() || 'Text Compare';
      title = `${name} - Text Compare`;
      break;
    }
    case 'textmerge': {
      const name = document.getElementById('currentTextMergeTabTitle')?.textContent?.trim() || 'Text Merge';
      title = `${name} - Text Merge`;
      break;
    }
    case 'textedit': {
      const name = document.getElementById('currentTextEditTabTitle')?.textContent?.trim() || 'Text Edit';
      title = `${name} - Text Edit`;
      break;
    }
    case 'hex': {
      const name = document.getElementById('currentHexTabTitle')?.textContent?.trim() || 'Hex Compare';
      title = `${name} - Hex Compare`;
      break;
    }
    case 'picture': {
      const name = document.getElementById('currentPictureTabTitle')?.textContent?.trim() || 'Picture Compare';
      title = `${name} - Picture Compare`;
      break;
    }
    case 'table': {
      const name = document.getElementById('currentTableTabTitle')?.textContent?.trim() || 'Table Compare';
      title = `${name} - Table Compare`;
      break;
    }
    case 'media': {
      const name = document.getElementById('currentMediaTabTitle')?.textContent?.trim() || 'Media Compare';
      title = `${name} - Media Compare`;
      break;
    }
    default:
      title = 'DiffCore';
      break;
  }

  if (titleEl) {
    titleEl.textContent = title;
  }
  document.title = `${title} - DiffCore`;

  updateTabsNavState();
}

function updateTabsNavState() {
  const tabsList = document.getElementById('appTabsList');
  const leftBtn = document.getElementById('tabNavLeftBtn');
  const rightBtn = document.getElementById('tabNavRightBtn');
  if (!tabsList || !leftBtn || !rightBtn) return;

  const visibleTabs = Array.from(tabsList.querySelectorAll('.tab-btn'))
    .filter(btn => btn.style.display !== 'none' && window.getComputedStyle(btn).display !== 'none');

  if (visibleTabs.length <= 1) {
    leftBtn.style.display = 'none';
    rightBtn.style.display = 'none';
  } else {
    leftBtn.style.display = 'inline-flex';
    rightBtn.style.display = 'inline-flex';
  }
}

// --- TAB SCROLLING & NAVIGATION ---
function handleTabNavClick(direction, event) {
  if (event) event.stopPropagation();
  // Shift+Click navigates directly between tabs
  if (event && event.shiftKey) {
    navigateNextPrevTab(direction === 'left' ? -1 : 1);
    return;
  }
  // Standard scroll by clicking arrow buttons
  scrollTabs(direction);
}

function scrollTabs(direction) {
  const tabsList = document.getElementById('appTabsList');
  if (!tabsList) return;
  const scrollStep = 180;
  if (direction === 'left') {
    tabsList.scrollBy({ left: -scrollStep, behavior: 'smooth' });
  } else {
    tabsList.scrollBy({ left: scrollStep, behavior: 'smooth' });
  }
}

function navigateNextPrevTab(direction) {
  const tabs = Array.from(document.querySelectorAll('#appTabsList .tab-btn'))
    .filter(btn => window.getComputedStyle(btn).display !== 'none');
  if (tabs.length === 0) return;
  const activeIdx = tabs.findIndex(btn => btn.classList.contains('active'));
  if (activeIdx === -1) {
    tabs[0].click();
    return;
  }
  if (tabs.length <= 1) return;
  const nextIdx = (activeIdx + direction + tabs.length) % tabs.length;
  tabs[nextIdx].click();
}

function switchToRemainingTabOrHome() {
  const tabsList = document.getElementById('appTabsList');
  if (!tabsList) {
    switchView('home');
    return;
  }
  const visibleTabs = Array.from(tabsList.querySelectorAll('.tab-btn'))
    .filter(btn => btn.style.display !== 'none' && window.getComputedStyle(btn).display !== 'none');

  if (visibleTabs.length > 0) {
    visibleTabs[visibleTabs.length - 1].click();
  } else {
    switchView('home');
  }
}

function closeAllComparisonTabsAndGoHome() {
  // Hide all comparison tab buttons
  document.querySelectorAll('#appTabsList .tab-btn').forEach(btn => {
    btn.style.display = 'none';
    btn.classList.remove('active');
  });

  // Clear active and selected sessions
  appState.activeFolderSession = null;
  appState.selectedSession = null;
  clearSessionDetails();

  // Reset folder compare inputs and trees
  appState.leftPath = '';
  appState.rightPath = '';
  const inL = document.getElementById('leftPathInput');
  const inR = document.getElementById('rightPathInput');
  if (inL) {
    inL.value = '';
    inL.placeholder = 'Enter path here';
  }
  if (inR) {
    inR.value = '';
    inR.placeholder = 'Enter path here';
  }
  const treeL = document.getElementById('folderTreeLeft');
  const treeR = document.getElementById('folderTreeRight');
  if (treeL) treeL.innerHTML = '';
  if (treeR) treeR.innerHTML = '';
  appState.folderItems = [];
  appState.visibleFlatList = [];

  const statusSummary = document.getElementById('folderStatusSummary');
  if (statusSummary) statusSummary.textContent = '0 files, 0 folders';

  // Switch to clean home
  switchView('home');
}

function handleToolbarHomeClick() {
  const currentView = appState.activeView;
  const tabFolderBtn = document.getElementById('tabFolderBtn');
  const isFolderActive = tabFolderBtn && tabFolderBtn.style.display !== 'none';

  // Scenario 1: Inside child file compare view and Folder Compare is the active parent
  if (currentView !== 'folder' && isFolderActive) {
    if (currentView === 'text') {
      const file = appState.currentTextFile;
      const isLeftDirty = file.originalLeftContent !== undefined && file.leftContent !== file.originalLeftContent;
      const isRightDirty = file.originalRightContent !== undefined && file.rightContent !== file.originalRightContent;

      if (isLeftDirty || isRightDirty) {
        let side = 'file';
        if (isLeftDirty && isRightDirty) side = 'files';
        else if (isLeftDirty) side = 'left file';
        else if (isRightDirty) side = 'right file';

        const modal = document.getElementById('saveConfirmModal');
        const msg = document.getElementById('saveConfirmMessage');
        if (msg) msg.textContent = `Save changes to ${side}?`;
        if (modal) modal.classList.add('active');

        pendingCloseAction = async (decision) => {
          if (decision === 'yes') {
            if (isLeftDirty) await saveTextFile('left');
            if (isRightDirty) await saveTextFile('right');
            const tabTextBtn = document.getElementById('tabTextBtn');
            if (tabTextBtn) tabTextBtn.style.display = 'none';
            switchView('folder');
          } else if (decision === 'no') {
            const tabTextBtn = document.getElementById('tabTextBtn');
            if (tabTextBtn) tabTextBtn.style.display = 'none';
            switchView('folder');
          }
          // If cancel, stay in text compare
        };
        return;
      }

      const tabTextBtn = document.getElementById('tabTextBtn');
      if (tabTextBtn) tabTextBtn.style.display = 'none';
      switchView('folder');
      return;
    }

    // Other child views (hex, picture, table, media)
    const childMap = {
      hex: 'tabHexBtn',
      picture: 'tabPictureBtn',
      table: 'tabTableBtn',
      media: 'tabMediaBtn',
      textedit: 'tabTextEditBtn',
      textmerge: 'tabTextMergeBtn',
      foldersync: 'tabFolderSyncBtn',
      foldermerge: 'tabFolderMergeBtn'
    };
    const childBtnId = childMap[currentView];
    if (childBtnId) {
      const btn = document.getElementById(childBtnId);
      if (btn) btn.style.display = 'none';
    }
    switchView('folder');
    return;
  }

  // Scenario 2: Inside standalone text compare with unsaved changes
  if (currentView === 'text') {
    const file = appState.currentTextFile;
    const isLeftDirty = file.originalLeftContent !== undefined && file.leftContent !== file.originalLeftContent;
    const isRightDirty = file.originalRightContent !== undefined && file.rightContent !== file.originalRightContent;

    if (isLeftDirty || isRightDirty) {
      let side = 'file';
      if (isLeftDirty && isRightDirty) side = 'files';
      else if (isLeftDirty) side = 'left file';
      else if (isRightDirty) side = 'right file';

      const modal = document.getElementById('saveConfirmModal');
      const msg = document.getElementById('saveConfirmMessage');
      if (msg) msg.textContent = `Save changes to ${side}?`;
      if (modal) modal.classList.add('active');

      pendingCloseAction = async (decision) => {
        if (decision === 'yes') {
          if (isLeftDirty) await saveTextFile('left');
          if (isRightDirty) await saveTextFile('right');
          closeAllComparisonTabsAndGoHome();
        } else if (decision === 'no') {
          closeAllComparisonTabsAndGoHome();
        }
      };
      return;
    }
  }

  // Scenario 3: In Folder Compare or standalone tool with no parent -> close all tabs and show clean Home
  closeAllComparisonTabsAndGoHome();
}

function closeFolderTab(event) {
  if (event) event.stopPropagation();
  const tabFolderBtn = document.getElementById('tabFolderBtn');
  if (tabFolderBtn) tabFolderBtn.style.display = 'none';
  appState.activeFolderSession = null;
  if (appState.selectedSession && appState.selectedSession.id === 'active-folder') {
    appState.selectedSession = null;
    clearSessionDetails();
  }
  switchToRemainingTabOrHome();
}

let pendingCloseAction = null;

function closeTextTab(event) {
  if (event) event.stopPropagation();
  closeTextCompareWithPrompt();
}

function closeTextCompareWithPrompt() {
  const file = appState.currentTextFile;
  const isLeftDirty = file.originalLeftContent !== undefined && file.leftContent !== file.originalLeftContent;
  const isRightDirty = file.originalRightContent !== undefined && file.rightContent !== file.originalRightContent;

  if (isLeftDirty || isRightDirty) {
    let side = 'file';
    if (isLeftDirty && isRightDirty) side = 'files';
    else if (isLeftDirty) side = 'left file';
    else if (isRightDirty) side = 'right file';

    const modal = document.getElementById('saveConfirmModal');
    const msg = document.getElementById('saveConfirmMessage');
    if (msg) msg.textContent = `Save changes to ${side}?`;
    if (modal) modal.classList.add('active');

    pendingCloseAction = async (decision) => {
      if (decision === 'yes') {
        if (isLeftDirty) await saveTextFile('left');
        if (isRightDirty) await saveTextFile('right');
        exitTextCompareView();
      } else if (decision === 'no') {
        exitTextCompareView();
      }
      // If cancel, do nothing
    };
  } else {
    exitTextCompareView();
  }
}

function handleSaveConfirmResponse(decision) {
  const modal = document.getElementById('saveConfirmModal');
  if (modal) modal.classList.remove('active');
  if (pendingCloseAction) {
    const action = pendingCloseAction;
    pendingCloseAction = null;
    action(decision);
  }
}

function exitTextCompareView() {
  const tabTextBtn = document.getElementById('tabTextBtn');
  if (tabTextBtn) tabTextBtn.style.display = 'none';
  switchToRemainingTabOrHome();
}

function openNewCompareTab() {
  promptNewSession();
}

// --- BROWSE FOLDERS ---
async function browseFolder(side) {
  const currentPath = side === 'left' ? 
    document.getElementById('leftPathInput').value : 
    document.getElementById('rightPathInput').value;

  const selected = await window.api.selectFolder(currentPath);
  if (selected) {
    if (side === 'left') {
      document.getElementById('leftPathInput').value = selected;
      appState.leftPath = selected;
    } else {
      document.getElementById('rightPathInput').value = selected;
      appState.rightPath = selected;
    }
    runFolderComparison();
  }
}

function swapSides() {
  const temp = appState.leftPath;
  appState.leftPath = appState.rightPath;
  appState.rightPath = temp;

  document.getElementById('leftPathInput').value = appState.leftPath;
  document.getElementById('rightPathInput').value = appState.rightPath;

  appendLog('Swapped left and right sides.');
  runFolderComparison();
}

function goUpFolder(side) {
  if (side === 'left' && appState.leftPath) {
    const parentLeft = appState.leftPath.split('/').slice(0, -1).join('/') || '/';
    appState.leftPath = parentLeft;
    document.getElementById('leftPathInput').value = parentLeft;
  } else if (side === 'right' && appState.rightPath) {
    const parentRight = appState.rightPath.split('/').slice(0, -1).join('/') || '/';
    appState.rightPath = parentRight;
    document.getElementById('rightPathInput').value = parentRight;
  } else {
    if (appState.leftPath) {
      const parentLeft = appState.leftPath.split('/').slice(0, -1).join('/') || '/';
      appState.leftPath = parentLeft;
      document.getElementById('leftPathInput').value = parentLeft;
    }
    if (appState.rightPath) {
      const parentRight = appState.rightPath.split('/').slice(0, -1).join('/') || '/';
      appState.rightPath = parentRight;
      document.getElementById('rightPathInput').value = parentRight;
    }
  }
  runFolderComparison();
}

function showPathHistory(side) {
  const recentPaths = Array.from(new Set(
    appState.sessions.concat(appState.autoSaved)
      .map(s => side === 'left' ? s.leftPath : s.rightPath)
      .filter(Boolean)
  ));
  if (recentPaths.length === 0) {
    alert('No recent paths found.');
    return;
  }
  const chosen = prompt(`Recent ${side.toUpperCase()} paths:\n\n` + recentPaths.slice(0, 8).map((p, i) => `${i + 1}: ${p}`).join('\n') + '\n\nEnter number (1-' + Math.min(recentPaths.length, 8) + '):');
  if (chosen) {
    const idx = parseInt(chosen.trim(), 10) - 1;
    if (recentPaths[idx]) {
      if (side === 'left') {
        document.getElementById('leftPathInput').value = recentPaths[idx];
        appState.leftPath = recentPaths[idx];
      } else {
        document.getElementById('rightPathInput').value = recentPaths[idx];
        appState.rightPath = recentPaths[idx];
      }
      runFolderComparison();
    }
  }
}

// --- RUN FOLDER COMPARISON ---
async function runFolderComparison() {
  const left = document.getElementById('leftPathInput').value.trim();
  const right = document.getElementById('rightPathInput').value.trim();

  appState.leftPath = left;
  appState.rightPath = right;

  if (!left && !right) {
    appendLog('No paths specified for comparison.');
    renderEmptyFolderCompare();
    return;
  }

  if (left && !right) {
    runSingleSideFolder('left');
    return;
  }
  if (!left && right) {
    runSingleSideFolder('right');
    return;
  }

  // Clear folder open state so folders appear collapsed by default
  appState.folderOpenState.clear();

  appendLog(`Running comparison: ${left} <=> ${right}`);
  const result = await window.api.compareFolders(left, right);

  if (result.success) {
    appState.comparisonItems = result.items;
    appState.treeRoot = buildComparisonTree(result.items);
    applyFilterAndRender();
    updateStatusBar();

    // Auto-save folder comparison session to history
    if (left && right) {
      window.api.recordAutoSavedSession({
        type: 'folder_compare',
        leftPath: left,
        rightPath: right
      }).then(() => reloadSessions()).catch(err => console.warn('AutoSave error:', err));
    }
  } else {
    appendLog(`Comparison failed: ${result.error}`);
    alert(`Comparison error: ${result.error}`);
  }
}

// --- HIERARCHICAL TREE ENGINE (Beyond Compare 5 Core) ---

// --- HIGH-PERFORMANCE VIRTUAL SCROLLING & HIERARCHICAL TREE ENGINE ---
const ROW_HEIGHT = 22;
let virtualScrollState = {
  lastRenderedStart: -1,
  lastRenderedEnd: -1,
  rafId: null
};

function buildComparisonTree(rawItems) {
  appState.treeNodeMap = new Map();
  const root = {
    name: '',
    relativePath: '',
    isDirectory: true,
    children: [],
    childrenMap: new Map(),
    hasDiff: false,
    hasSame: false,
    hasOrphan: false,
    leftSize: 0,
    rightSize: 0,
    leftMtime: null,
    rightMtime: null,
    isOpen: true
  };

  // 1. Build hierarchy by path segments
  for (let rIdx = 0; rIdx < rawItems.length; rIdx++) {
    const item = rawItems[rIdx];
    const parts = item.relativePath.split(/[\/\\]+/).filter(Boolean);
    let curr = root;
    let accPath = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      accPath = accPath ? `${accPath}/${part}` : part;
      const isLeaf = (i === parts.length - 1);

      let child = curr.childrenMap.get(part);
      if (!child) {
        child = {
          name: part,
          relativePath: accPath,
          isDirectory: isLeaf ? item.isDirectory : true,
          children: [],
          childrenMap: new Map(),
          hasDiff: false,
          hasSame: false,
          hasOrphan: false,
          status: isLeaf ? item.status : 'identical',
          left: isLeaf ? item.left : null,
          right: isLeaf ? item.right : null,
          leftSize: 0,
          rightSize: 0,
          leftMtime: null,
          rightMtime: null,
          isOpen: true,
          parent: curr
        };
        curr.childrenMap.set(part, child);
        curr.children.push(child);
        appState.treeNodeMap.set(accPath, child);
      } else if (isLeaf) {
        child.isDirectory = item.isDirectory;
        child.status = item.status;
        child.left = item.left;
        child.right = item.right;
      }
      curr = child;
    }
  }

  // 2. Post-order traversal for cumulative sizes and difference propagation
  function postOrder(node) {
    const bothSides = !!(appState.leftPath && appState.rightPath);
    if (!node.isDirectory) {
      node.hasLeft = !!(appState.leftPath && node.left);
      node.hasRight = !!(appState.rightPath && node.right);
      node.hasDiff = bothSides && (node.status === 'different' || node.status === 'orphan_left' || node.status === 'orphan_right');
      node.hasSame = bothSides && (node.status === 'identical');
      node.hasOrphan = bothSides && (node.status === 'orphan_left' || node.status === 'orphan_right');
      node.leftSize = node.hasLeft && node.left ? (node.left.size || 0) : 0;
      node.rightSize = node.hasRight && node.right ? (node.right.size || 0) : 0;
      node.leftMtime = node.hasLeft && node.left ? node.left.modified : null;
      node.rightMtime = node.hasRight && node.right ? node.right.modified : null;
      return;
    }

    let hasDiff = false;
    let hasSame = false;
    let hasOrphan = false;
    let leftSize = 0;
    let rightSize = 0;
    let maxLeftMtime = null;
    let maxRightMtime = null;
    let hasLeft = !!(appState.leftPath && node.left);
    let hasRight = !!(appState.rightPath && node.right);

    const children = node.children;
    for (let cIdx = 0; cIdx < children.length; cIdx++) {
      const child = children[cIdx];
      postOrder(child);
      if (child.hasLeft) {
        hasLeft = true;
        leftSize += (child.leftSize || 0);
        if (child.leftMtime) {
          if (!maxLeftMtime || child.leftMtime > maxLeftMtime) {
            maxLeftMtime = child.leftMtime;
          }
        }
      }
      if (child.hasRight) {
        hasRight = true;
        rightSize += (child.rightSize || 0);
        if (child.rightMtime) {
          if (!maxRightMtime || child.rightMtime > maxRightMtime) {
            maxRightMtime = child.rightMtime;
          }
        }
      }
      if (child.hasDiff) hasDiff = true;
      if (child.hasSame) hasSame = true;
      if (child.hasOrphan) hasOrphan = true;
    }

    if (!appState.leftPath) {
      hasLeft = false;
      leftSize = 0;
      maxLeftMtime = null;
    }
    if (!appState.rightPath) {
      hasRight = false;
      rightSize = 0;
      maxRightMtime = null;
    }
    if (!bothSides) {
      hasDiff = false;
      hasOrphan = false;
      hasSame = false;
    }

    node.hasLeft = hasLeft;
    node.hasRight = hasRight;
    node.hasDiff = hasDiff;
    node.hasSame = hasSame;
    node.hasOrphan = hasOrphan;
    node.leftSize = leftSize;
    node.rightSize = rightSize;
    node.leftMtime = maxLeftMtime;
    node.rightMtime = maxRightMtime;

    // Default to collapsed for lightning-fast loading and BC5 structure match
    if (appState.folderOpenState.has(node.relativePath)) {
      node.isOpen = appState.folderOpenState.get(node.relativePath);
    } else {
      node.isOpen = false;
      appState.folderOpenState.set(node.relativePath, false);
    }

    // High-performance sort: folders first, then files alphabetically
    node.children.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
    });
  }

  postOrder(root);
  return root;
}

// 3. Fast Tree flattening preserving container folders for diffs
function flattenVisibleTree(root, filter, searchQuery) {
  const visible = [];
  const q = searchQuery ? searchQuery.toLowerCase() : '';
  const bothSides = !!(appState.leftPath && appState.rightPath);

  function walk(node, depth, guides) {
    const children = node.children;
    const len = children.length;

    for (let i = 0; i < len; i++) {
      const child = children[i];
      const isLast = (i === len - 1);

      // Filter check: If only one side loaded, show all items of that loaded side
      let matchesFilter = true;
      if (!bothSides) {
        matchesFilter = appState.leftPath ? child.hasLeft : child.hasRight;
      } else if (filter === 'all') {
        matchesFilter = true;
      } else if (filter === 'diffs') {
        matchesFilter = child.isDirectory ? child.hasDiff : child.hasDiff;
      } else if (filter === 'same') {
        matchesFilter = child.isDirectory ? child.hasSame : child.hasSame;
      } else if (filter === 'orphans') {
        matchesFilter = child.isDirectory ? child.hasOrphan : (child.status === 'orphan_left' || child.status === 'orphan_right');
      }

      // Search query check
      let matchesQuery = true;
      if (q) {
        matchesQuery = child.name.toLowerCase().includes(q) || 
                       child.relativePath.toLowerCase().includes(q) ||
                       (child.isDirectory && subtreeMatchesQuery(child, q));
      }

      if (matchesFilter && matchesQuery) {
        child.depth = depth;
        child.isLast = isLast;
        child.guides = guides;

        visible.push(child);

        // Recurse ONLY if open directory
        if (child.isDirectory && child.isOpen) {
          const nextGuides = [...guides, !isLast];
          walk(child, depth + 1, nextGuides);
        }
      }
    }
  }

  walk(root, 0, []);
  return visible;
}

function subtreeMatchesQuery(node, query) {
  const children = node.children;
  for (let i = 0; i < children.length; i++) {
    const c = children[i];
    if (c.name.toLowerCase().includes(query) || c.relativePath.toLowerCase().includes(query)) return true;
    if (c.isDirectory && subtreeMatchesQuery(c, query)) return true;
  }
  return false;
}

// Folder Expand / Collapse Actions (Instant O(1) execution)
function toggleFolder(relPath) {
  if (!relPath || !appState.treeNodeMap) return;
  const node = appState.treeNodeMap.get(relPath);
  const current = node ? node.isOpen : (appState.folderOpenState.get(relPath) ?? false);
  const next = !current;
  appState.folderOpenState.set(relPath, next);

  if (node) {
    node.isOpen = next;
  }

  applyFilterAndRender();
}

function expandAllFolders() {
  if (!appState.treeNodeMap) return;
  for (const [relPath, node] of appState.treeNodeMap) {
    if (node.isDirectory) {
      node.isOpen = true;
      appState.folderOpenState.set(relPath, true);
    }
  }
  applyFilterAndRender();
  appendLog('Expanded all folders.');
}

function collapseAllFolders() {
  if (!appState.treeNodeMap) return;
  for (const [relPath, node] of appState.treeNodeMap) {
    if (node.isDirectory) {
      node.isOpen = false;
      appState.folderOpenState.set(relPath, false);
    }
  }
  applyFilterAndRender();
  appendLog('Collapsed all folders.');
}

// Toolbar Action Helpers
function setFilter(filterType) {
  appState.currentFilter = filterType;
  try {
    localStorage.setItem('diffcore_filter', filterType);
  } catch {}

  document.querySelectorAll('.folder-toolbar .tb-btn').forEach(btn => {
    if (btn.id.startsWith('filter')) btn.classList.remove('active');
  });

  const activeBtn = {
    'all': 'filterAllBtn',
    'diffs': 'filterDiffsBtn',
    'same': 'filterSameBtn',
    'orphans': 'filterOrphansBtn'
  }[filterType];

  if (activeBtn) {
    const el = document.getElementById(activeBtn);
    if (el) el.classList.add('active');
  }
  applyFilterAndRender();
}

function filterTableItems() {
  appState.tableSearchQuery = document.getElementById('tableFilterInput').value.trim().toLowerCase();
  applyFilterAndRender();
}

function clearTableFilter() {
  const input = document.getElementById('tableFilterInput');
  if (input) input.value = '';
  appState.tableSearchQuery = '';
  applyFilterAndRender();
}

function promptFilterInput() {
  const input = document.getElementById('tableFilterInput');
  if (input) {
    input.focus();
    input.select();
  }
}

function peekNextDiff() {
  const diffIndex = appState.filteredItems.findIndex((it, idx) => idx > appState.selectedIndex && (it.hasDiff || it.status !== 'identical'));
  if (diffIndex !== -1) {
    selectTableRow(diffIndex);
    scrollToRow(diffIndex);
  } else {
    const firstDiff = appState.filteredItems.findIndex((it) => it.hasDiff || it.status !== 'identical');
    if (firstDiff !== -1) {
      selectTableRow(firstDiff);
      scrollToRow(firstDiff);
    }
  }
}

function scrollToRow(index) {
  const leftPane = document.getElementById('leftPaneScroll');
  const rightPane = document.getElementById('rightPaneScroll');
  const targetTop = Math.max(0, index * ROW_HEIGHT - 100);
  if (leftPane) leftPane.scrollTop = targetTop;
  if (rightPane) rightPane.scrollTop = targetTop;
  renderVisibleWindow(true);
  if (typeof folderSyncScrollbar !== 'undefined' && folderSyncScrollbar) folderSyncScrollbar.update();
}

function selectAllRows() {
  appState.selectedIndices.clear();
  for (let i = 0; i < appState.filteredItems.length; i++) {
    appState.selectedIndices.add(i);
  }
  virtualScrollState.lastRenderedStart = -1;
  virtualScrollState.lastRenderedEnd = -1;
  renderVisibleWindow(true);
  if (typeof folderSyncScrollbar !== 'undefined' && folderSyncScrollbar) folderSyncScrollbar.update();
}

function toggleStructureMode() {
  appState.structureMode = !appState.structureMode;
  appendLog(`Structure mode: ${appState.structureMode ? 'Enabled' : 'Disabled'}`);
}

function toggleMinorDiffs() {
  appendLog('Toggle minor diffs');
}

function toggleFileView() {
  appendLog('Toggle files');
}

function copySelectedToRight() {
  if (appState.selectedIndex >= 0 && appState.filteredItems[appState.selectedIndex]) {
    const item = appState.filteredItems[appState.selectedIndex];
    appState.contextItem = item;
    contextAction('copy_to_right');
  }
}

function stopComparison() {
  appendLog('Comparison stopped.');
}

function applyFilterAndRender() {
  if (!appState.treeRoot && appState.comparisonItems.length > 0) {
    appState.treeRoot = buildComparisonTree(appState.comparisonItems);
  }
  if (!appState.treeRoot) return;

  const query = appState.tableSearchQuery;
  const filter = appState.currentFilter;

  appState.filteredItems = flattenVisibleTree(appState.treeRoot, filter, query);

  // Keep both panes strictly synchronized
  const leftPane = document.getElementById('leftPaneScroll');
  const rightPane = document.getElementById('rightPaneScroll');
  if (leftPane && rightPane) {
    rightPane.scrollTop = leftPane.scrollTop;
    rightPane.scrollLeft = leftPane.scrollLeft;
  }

  // Force re-render of virtual window
  virtualScrollState.lastRenderedStart = -1;
  virtualScrollState.lastRenderedEnd = -1;
  renderVisibleWindow(true);
  updateStatusBar();
  if (typeof folderSyncScrollbar !== 'undefined' && folderSyncScrollbar) folderSyncScrollbar.update();
}

// Beyond Compare 5 High-Performance Virtual Table Windowing
function renderVisibleWindow(force = false) {
  const leftPane = document.getElementById('leftPaneScroll');
  const rightPane = document.getElementById('rightPaneScroll');
  if (!leftPane || !rightPane) return;

  const items = appState.filteredItems;
  const totalItems = items.length;

  const scrollTop = leftPane.scrollTop;
  const viewportHeight = leftPane.clientHeight || 600;

  const firstVis = Math.floor(scrollTop / ROW_HEIGHT);
  const lastVis = Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT);

  const atTop = virtualScrollState.lastRenderedStart === 0 && firstVis <= 6;
  const atBottom = virtualScrollState.lastRenderedEnd >= totalItems && lastVis >= totalItems - 6;

  // Safe buffer thresholding: skip DOM rebuild if visible rows are safely within rendered buffer
  if (!force &&
      virtualScrollState.lastRenderedStart >= 0 &&
      (firstVis >= virtualScrollState.lastRenderedStart + 6 || atTop) &&
      (lastVis <= virtualScrollState.lastRenderedEnd - 6 || atBottom)) {
    return;
  }

  // Window calculation with 30 rows overscan
  const overscan = 30;
  const startIndex = Math.max(0, firstVis - overscan);
  const endIndex = Math.min(totalItems, lastVis + overscan);

  // Skip DOM rebuild if window didn't shift
  if (!force && startIndex === virtualScrollState.lastRenderedStart && endIndex === virtualScrollState.lastRenderedEnd) {
    return;
  }

  virtualScrollState.lastRenderedStart = startIndex;
  virtualScrollState.lastRenderedEnd = endIndex;

  const topHeight = startIndex * ROW_HEIGHT;
  const bottomHeight = Math.max(0, (totalItems - endIndex) * ROW_HEIGHT);

  let leftRowsHtml = '';
  let rightRowsHtml = '';

  // Top spacer row to maintain exact native scroll position
  if (topHeight > 0) {
    leftRowsHtml += `<tr class="virtual-spacer" style="height:${topHeight}px;"><td colspan="4" style="height:${topHeight}px;"></td></tr>`;
    rightRowsHtml += `<tr class="virtual-spacer" style="height:${topHeight}px;"><td colspan="4" style="height:${topHeight}px;"></td></tr>`;
  }

  // Render ONLY visible rows (approx. 40 to 60 rows)
  for (let index = startIndex; index < endIndex; index++) {
    const item = items[index];
    const isSelected = appState.selectedIndices.has(index);
    const isDir = item.isDirectory;
    const bothSidesLoaded = !!(appState.leftPath && appState.rightPath);
    const isDiff = bothSidesLoaded && (item.status === 'different');
    const isOrphanLeft = bothSidesLoaded && (item.status === 'orphan_left');
    const isOrphanRight = bothSidesLoaded && (item.status === 'orphan_right');
    const hasDiff = bothSidesLoaded && (item.hasDiff || isDiff || isOrphanLeft || isOrphanRight);

    // Tree indentation guides
    let guidesHtml = '';
    if (item.guides) {
      for (let g = 0; g < item.guides.length; g++) {
        guidesHtml += `<span class="tree-guide ${item.guides[g] ? 'line' : ''}"></span>`;
      }
    }
    if (item.depth > 0) {
      guidesHtml += `<span class="tree-branch ${item.isLast ? 'last' : ''}"></span>`;
    }

    const toggleHtml = isDir
      ? `<span class="tree-toggle" data-relpath="${escapeHtml(item.relativePath)}">${item.isOpen ? '▼' : '▶'}</span>`
      : `<span class="tree-toggle-spacer"></span>`;

    let iconHtml = '';
    if (isDir) {
      if (item.hasDiff && bothSidesLoaded) {
        iconHtml = `<span class="tree-icon dc-icon dc-icon-folder-diff" title="Folder contains differences"></span>`;
      } else {
        iconHtml = `<span class="tree-icon dc-icon dc-icon-folder"></span>`;
      }
    } else {
      iconHtml = `<span class="tree-icon dc-icon dc-icon-file"></span>`;
    }

    const diffMarkerBox = hasDiff ? '<span class="red-diff-box" title="Difference"></span>' : '';
    const zebraClass = (index % 2 === 0 ? 'even' : 'odd');
    const selectedClass = isSelected ? 'selected' : '';

    // LEFT ROW
    if (item.hasLeft) {
      const leftSizeText = isDir ? formatTreeSize(item.leftSize) : (item.left ? formatTreeSize(item.left.size) : '');
      const leftDateText = isDir ? formatTreeDate(item.leftMtime) : (item.left ? formatTreeDate(item.left.modified) : '');
      const leftLabelClass = isOrphanLeft ? 'text-orphan' : '';

      leftRowsHtml += `
        <tr class="diff-row ${zebraClass} ${selectedClass}" data-index="${index}">
          <td>
            <div class="tree-cell">
              ${guidesHtml}
              ${toggleHtml}
              ${iconHtml}
              <span class="tree-label ${leftLabelClass}">${escapeHtml(item.name)}</span>
            </div>
          </td>
          <td style="text-align: right; color: ${isDir ? '#888' : 'inherit'};">${leftSizeText}</td>
          <td style="color: ${isDir ? '#888' : 'inherit'};">${leftDateText}</td>
          <td class="diff-marker-cell">${diffMarkerBox}</td>
        </tr>`;
    } else {
      leftRowsHtml += `
        <tr class="diff-row empty-ghost ${zebraClass} ${selectedClass}" data-index="${index}">
          <td></td><td></td><td></td><td class="diff-marker-cell"></td>
        </tr>`;
    }

    // RIGHT ROW
    if (item.hasRight) {
      const rightSizeText = isDir ? formatTreeSize(item.rightSize) : (item.right ? formatTreeSize(item.right.size) : '');
      const rightDateText = isDir ? formatTreeDate(item.rightMtime) : (item.right ? formatTreeDate(item.right.modified) : '');
      const rightLabelClass = isDiff ? 'text-diff' : (isOrphanRight ? 'text-orphan' : '');
      const rightMetaClass = isDiff ? 'text-diff' : '';

      rightRowsHtml += `
        <tr class="diff-row ${zebraClass} ${selectedClass}" data-index="${index}">
          <td>
            <div class="tree-cell">
              ${guidesHtml}
              ${toggleHtml}
              ${iconHtml}
              <span class="tree-label ${rightLabelClass}">${escapeHtml(item.name)}</span>
            </div>
          </td>
          <td style="text-align: right;" class="${rightMetaClass}">${rightSizeText}</td>
          <td class="${rightMetaClass}">${rightDateText}</td>
          <td class="diff-marker-cell">${diffMarkerBox}</td>
        </tr>`;
    } else {
      rightRowsHtml += `
        <tr class="diff-row empty-ghost ${zebraClass} ${selectedClass}" data-index="${index}">
          <td></td><td></td><td></td><td class="diff-marker-cell"></td>
        </tr>`;
    }
  }

  // Bottom spacer
  if (bottomHeight > 0) {
    leftRowsHtml += `<tr class="virtual-spacer" style="height:${bottomHeight}px;"><td colspan="4" style="height:${bottomHeight}px;"></td></tr>`;
    rightRowsHtml += `<tr class="virtual-spacer" style="height:${bottomHeight}px;"><td colspan="4" style="height:${bottomHeight}px;"></td></tr>`;
  }

  // Only show drop targets if BOTH sides are completely empty (no comparison loaded)
  if (!appState.leftPath && !appState.rightPath) {
    leftRowsHtml = `<tr><td colspan="4" style="text-align: center; padding: 80px 20px; color: #666; font-family: var(--font-sans); cursor: pointer;" onclick="browseFolder('left')"><div style="font-size: 40px; margin-bottom: 8px; opacity: 0.6;">📁</div><div style="font-size: 13px; font-weight: 500;">Drop left folder here, or click 📁▾ to browse</div></td></tr>`;
    rightRowsHtml = `<tr><td colspan="4" style="text-align: center; padding: 80px 20px; color: #666; font-family: var(--font-sans); cursor: pointer;" onclick="browseFolder('right')"><div style="font-size: 40px; margin-bottom: 8px; opacity: 0.6;">📁</div><div style="font-size: 13px; font-weight: 500;">Drop right folder here, or click 📁▾ to browse</div></td></tr>`;
  }

  const leftTbody = document.getElementById('leftTableBody');
  const rightTbody = document.getElementById('rightTableBody');
  leftTbody.innerHTML = leftRowsHtml;
  rightTbody.innerHTML = rightRowsHtml;
}

// O(1) Instant Selection with Multi-Select Support
function selectTableRow(index, event) {
  const isMeta = event && (event.metaKey || event.ctrlKey);
  const isShift = event && event.shiftKey;

  if (isShift && appState.lastClickedIndex >= 0) {
    // Range selection: select all rows from lastClickedIndex to index
    const start = Math.min(appState.lastClickedIndex, index);
    const end = Math.max(appState.lastClickedIndex, index);
    if (!isMeta) {
      appState.selectedIndices.clear();
    }
    for (let i = start; i <= end; i++) {
      appState.selectedIndices.add(i);
    }
  } else if (isMeta) {
    // Toggle individual selection
    if (appState.selectedIndices.has(index)) {
      appState.selectedIndices.delete(index);
    } else {
      appState.selectedIndices.add(index);
    }
    appState.lastClickedIndex = index;
  } else {
    // Normal click: select only this row
    appState.selectedIndices.clear();
    appState.selectedIndices.add(index);
    appState.lastClickedIndex = index;
  }

  appState.selectedIndex = index;
  updateSelectionDOM();
}

function updateSelectionDOM() {
  document.querySelectorAll('#leftTableBody tr.diff-row, #rightTableBody tr.diff-row').forEach(tr => {
    const idx = parseInt(tr.dataset.index, 10);
    if (!isNaN(idx)) {
      if (appState.selectedIndices.has(idx)) {
        tr.classList.add('selected');
      } else {
        tr.classList.remove('selected');
      }
    }
  });
}

function setupFolderKeyboardNavigation() {
  window.addEventListener('keydown', (event) => {
    if (appState.activeView !== 'folder') return;
    const tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea') return;

    if (document.querySelector('.modal-backdrop.active')) return;

    const total = appState.filteredItems.length;
    if (total === 0) return;

    const isMeta = event.metaKey || event.ctrlKey;

    if (isMeta && (event.key === 'a' || event.key === 'A')) {
      event.preventDefault();
      selectAllRows();
      return;
    }

    if (event.key === 'Escape') {
      appState.selectedIndices.clear();
      updateSelectionDOM();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const curr = appState.selectedIndex >= 0 ? appState.selectedIndex : -1;
      const next = Math.min(total - 1, curr + 1);
      selectTableRow(next, event);
      scrollToRow(next);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const curr = appState.selectedIndex >= 0 ? appState.selectedIndex : total;
      const prev = Math.max(0, curr - 1);
      selectTableRow(prev, event);
      scrollToRow(prev);
      return;
    }

    if (event.key === 'Enter') {
      if (appState.selectedIndex >= 0 && appState.filteredItems[appState.selectedIndex]) {
        const item = appState.filteredItems[appState.selectedIndex];
        if (item.isDirectory) {
          toggleFolder(item.relativePath);
        } else {
          handleRowDoubleClick(item);
        }
      }
    }
  });
}

function handleRowDoubleClick(item) {
  if (item.isDirectory) {
    appendLog(`Folder toggled: ${item.relativePath}`);
    return;
  }
  const fullLeft = item.left ? item.left.fullPath : '';
  const fullRight = item.right ? item.right.fullPath : '';
  const ext = (item.name || item.relativePath || '').split('.').pop().toLowerCase();

  if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'ico'].includes(ext)) {
    openPictureCompare(fullLeft, fullRight, item.name);
  } else if (['xlsx', 'xls', 'csv', 'tsv'].includes(ext)) {
    openTableCompare(fullLeft, fullRight, item.name);
  } else if (['mp3', 'wav', 'ogg', 'mp4', 'm4a', 'flac'].includes(ext)) {
    openMediaCompare(fullLeft, fullRight, item.name);
  } else {
    // Open in Text Compare (code, properties, xml, text, etc.) as child inspection
    openTextCompare(fullLeft, fullRight, item.relativePath, true);
  }
}

// --- BEYOND COMPARE 5 AUTHENTIC CONTEXT MENUS (Image 1 Folder / Image 2 File) ---
let toastTimeout = null;
function showToast(message, type = 'info') {
  const toast = document.getElementById('toastNotification');
  if (!toast) return;
  toast.className = `toast-notification ${type} show`;
  toast.textContent = message;
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 3200);
}

function handleTableContextMenu(event) {
  event.preventDefault();
  const row = event.target.closest('tr.diff-row');
  if (!row) return;

  const index = parseInt(row.dataset.index, 10);
  if (isNaN(index)) return;

  if (!appState.selectedIndices.has(index)) {
    selectTableRow(index);
  }
  const item = appState.filteredItems[index];
  if (!item) return;

  const isLeft = !!row.closest('#leftTableBody');
  const clickedSide = isLeft ? 'left' : 'right';
  const otherSideCapitalized = isLeft ? 'Right' : 'Left';

  appState.contextItem = item;
  appState.contextSide = clickedSide;

  const menu = document.getElementById('folderContextMenu');
  if (!menu) return;

  let menuHtml = '';
  if (item.isDirectory) {
    // IMAGE 1: Authentic Folder Context Menu
    const folderStateLabel = item.isOpen ? 'Close Folder' : 'Open Folder';
    const folderStateAction = item.isOpen ? 'close_folder' : 'open_folder';
    menuHtml = `
      <div class="context-menu-item" onclick="contextAction('${folderStateAction}')">
        <span>${folderStateLabel}</span>
      </div>
      <div class="context-menu-item" onclick="contextAction('open_subfolders')">
        <span>Open Subfolders</span>
      </div>
      <div class="context-menu-item" onclick="contextAction('close_subfolders')">
        <span>Close Subfolders</span>
      </div>
      <div class="context-menu-item" onclick="contextAction('set_base_folders')">
        <span>Set as Base Folders</span>
      </div>
      <div class="context-menu-item" onclick="contextAction('open_in_new_view')">
        <span>Open in New View</span>
      </div>
      <div class="context-menu-item has-submenu">
        <span>Open With</span>
        <span class="ctx-arrow">›</span>
        <div class="context-submenu">
          <div class="context-menu-item" onclick="contextAction('open_with_finder')"><span>Finder</span></div>
          <div class="context-menu-item" onclick="contextAction('open_with_terminal')"><span>Terminal</span></div>
          <div class="context-menu-item" onclick="contextAction('open_with_default')"><span>System Default</span></div>
        </div>
      </div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item" onclick="contextAction('compare_contents')">
        <span>Compare Contents...</span>
      </div>
      <div class="context-menu-item" onclick="contextAction('copy_to_side')">
        <span>Copy to Side...</span>
      </div>
      <div class="context-menu-item" onclick="contextAction('move_to_side')">
        <span>Move to Side...</span>
      </div>
      <div class="context-menu-item" onclick="contextAction('copy_to_folder')">
        <span>Copy to Folder...</span>
      </div>
      <div class="context-menu-item" onclick="contextAction('move_to_folder')">
        <span>Move to Folder...</span>
      </div>
      <div class="context-menu-item" onclick="contextAction('delete')">
        <span>Delete...</span>
      </div>
      <div class="context-menu-item" onclick="contextAction('rename')">
        <span>Rename...</span>
      </div>
      <div class="context-menu-item" onclick="contextAction('attributes')">
        <span>Attributes...</span>
      </div>
      <div class="context-menu-item" onclick="contextAction('touch')">
        <span>Touch...</span>
      </div>
      <div class="context-menu-item" onclick="contextAction('exclude')">
        <span>Exclude</span>
      </div>
      <div class="context-menu-item" onclick="contextAction('new_folder')">
        <span>New Folder...</span>
      </div>
      <div class="context-menu-item" onclick="contextAction('copy_filename')">
        <span>Copy Filename</span>
      </div>
      <div class="context-menu-item" onclick="contextAction('ignored')">
        <span>Ignored</span>
      </div>
      <div class="context-menu-item" onclick="contextAction('refresh_selection')">
        <span>Refresh Selection</span>
      </div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item has-submenu">
        <span>Synchronize</span>
        <span class="ctx-arrow">›</span>
        <div class="context-submenu">
          <div class="context-menu-item" onclick="contextAction('sync_update_right')"><span>Update Right</span></div>
          <div class="context-menu-item" onclick="contextAction('sync_update_left')"><span>Update Left</span></div>
          <div class="context-menu-item" onclick="contextAction('sync_mirror_right')"><span>Mirror Right</span></div>
          <div class="context-menu-item" onclick="contextAction('sync_mirror_left')"><span>Mirror Left</span></div>
        </div>
      </div>
    `;
  } else {
    // IMAGE 2: Authentic File Context Menu
    menuHtml = `
      <div class="context-menu-item" onclick="contextAction('open')">
        <span>Open</span>
      </div>
      <div class="context-menu-item has-submenu">
        <span>Open With</span>
        <span class="ctx-arrow">›</span>
        <div class="context-submenu">
          <div class="context-menu-item" onclick="contextAction('open_with_finder')"><span>Finder</span></div>
          <div class="context-menu-item" onclick="contextAction('open_with_default')"><span>System Default</span></div>
          <div class="context-menu-item" onclick="contextAction('open_with_hex')"><span>Hex Compare</span></div>
          <div class="context-menu-item" onclick="contextAction('open_with_text')"><span>Text Compare</span></div>
        </div>
      </div>
      <div class="context-menu-item" onclick="contextAction('quick_compare')">
        <span>Quick Compare</span>
      </div>
      <div class="context-menu-item" onclick="contextAction('compare_to')">
        <span>Compare To...</span>
      </div>
      <div class="context-menu-item" onclick="contextAction('align_with')">
        <span>Align With...</span>
      </div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item" onclick="contextAction('compare_contents')">
        <span>Compare Contents...</span>
      </div>
      <div class="context-menu-item" onclick="contextAction('copy_to_side')">
        <span>Copy to ${otherSideCapitalized}...</span>
      </div>
      <div class="context-menu-item" onclick="contextAction('move_to_side')">
        <span>Move to ${otherSideCapitalized}...</span>
      </div>
      <div class="context-menu-item" onclick="contextAction('copy_to_folder')">
        <span>Copy to Folder...</span>
      </div>
      <div class="context-menu-item" onclick="contextAction('move_to_folder')">
        <span>Move to Folder...</span>
      </div>
      <div class="context-menu-item" onclick="contextAction('delete')">
        <span>Delete...</span>
      </div>
      <div class="context-menu-item" onclick="contextAction('rename')">
        <span>Rename</span>
      </div>
      <div class="context-menu-item" onclick="contextAction('attributes')">
        <span>Attributes...</span>
      </div>
      <div class="context-menu-item" onclick="contextAction('touch')">
        <span>Touch...</span>
      </div>
      <div class="context-menu-item" onclick="contextAction('exclude')">
        <span>Exclude...</span>
      </div>
      <div class="context-menu-item" onclick="contextAction('new_folder')">
        <span>New Folder...</span>
      </div>
      <div class="context-menu-item" onclick="contextAction('copy_filename')">
        <span>Copy Filename</span>
      </div>
      <div class="context-menu-item" onclick="contextAction('ignored')">
        <span>Ignored</span>
      </div>
      <div class="context-menu-item" onclick="contextAction('refresh_selection')">
        <span>Refresh Selection</span>
      </div>
      <div class="context-menu-item" onclick="contextAction('file_compare_report')">
        <span>File Compare Report...</span>
      </div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item has-submenu">
        <span>Synchronize</span>
        <span class="ctx-arrow">›</span>
        <div class="context-submenu">
          <div class="context-menu-item" onclick="contextAction('sync_update_right')"><span>Update Right</span></div>
          <div class="context-menu-item" onclick="contextAction('sync_update_left')"><span>Update Left</span></div>
          <div class="context-menu-item" onclick="contextAction('sync_mirror_right')"><span>Mirror Right</span></div>
          <div class="context-menu-item" onclick="contextAction('sync_mirror_left')"><span>Mirror Left</span></div>
        </div>
      </div>
    `;
  }

  menu.innerHTML = menuHtml;
  menu.style.display = 'block';

  const menuWidth = 220;
  const menuHeight = item.isDirectory ? 490 : 510;
  let posX = event.clientX;
  let posY = event.clientY;

  if (posX + menuWidth > window.innerWidth - 10) {
    posX = Math.max(10, window.innerWidth - menuWidth - 10);
  }
  if (posY + menuHeight > window.innerHeight - 10) {
    posY = Math.max(10, window.innerHeight - menuHeight - 10);
  }

  // Flip submenu to the left if near right edge
  if (posX + menuWidth + 180 > window.innerWidth) {
    menu.classList.add('open-left');
  } else {
    menu.classList.remove('open-left');
  }

  menu.style.left = `${posX}px`;
  menu.style.top = `${posY}px`;
}

async function contextAction(action) {
  const item = appState.contextItem;
  const side = appState.contextSide || 'left';
  const menu = document.getElementById('folderContextMenu');
  if (menu) menu.style.display = 'none';

  if (!item) return;

  switch (action) {
    case 'close_folder':
      setFolderOpenState(item.relativePath, false);
      break;
    case 'open_folder':
      setFolderOpenState(item.relativePath, true);
      break;
    case 'toggle_folder':
      toggleFolder(item.relativePath);
      break;
    case 'open_subfolders':
      openSubfolders(item.relativePath);
      break;
    case 'close_subfolders':
      closeSubfolders(item.relativePath);
      break;
    case 'set_base_folders':
    case 'open_in_new_view':
      setAsBaseFolders(item);
      break;
    case 'open':
      handleRowDoubleClick(item);
      break;
    case 'open_with_finder': {
      const target = (side === 'left' && item.left) ? item.left.fullPath :
                     (side === 'right' && item.right) ? item.right.fullPath :
                     (item.left ? item.left.fullPath : (item.right ? item.right.fullPath : null));
      if (target) window.api.revealInFinder(target);
      break;
    }
    case 'open_with_terminal': {
      const target = (side === 'left' && item.left) ? item.left.fullPath :
                     (side === 'right' && item.right) ? item.right.fullPath :
                     (item.left ? item.left.fullPath : (item.right ? item.right.fullPath : null));
      if (target) window.api.openTerminal(target);
      break;
    }
    case 'open_with_default': {
      const target = (side === 'left' && item.left) ? item.left.fullPath :
                     (side === 'right' && item.right) ? item.right.fullPath :
                     (item.left ? item.left.fullPath : (item.right ? item.right.fullPath : null));
      if (target) window.api.openDefaultApp(target);
      break;
    }
    case 'open_with_hex': {
      const leftPath = item.left ? item.left.fullPath : '';
      const rightPath = item.right ? item.right.fullPath : '';
      openHexCompareView(leftPath, rightPath, item.name);
      break;
    }
    case 'open_with_text': {
      const leftPath = item.left ? item.left.fullPath : '';
      const rightPath = item.right ? item.right.fullPath : '';
      openTextCompare(leftPath, rightPath, item.name, true);
      break;
    }
    case 'quick_compare':
      performQuickCompare(item);
      break;
    case 'compare_to': {
      const currentPath = (side === 'left' && item.left) ? item.left.fullPath :
                          (side === 'right' && item.right) ? item.right.fullPath :
                          (item.left ? item.left.fullPath : (item.right ? item.right.fullPath : ''));
      const chosen = await window.api.selectFile(currentPath);
      if (chosen) {
        openTextCompare(currentPath, chosen, item.name);
      }
      break;
    }
    case 'align_with':
      showToast(`Aligned with "${item.name}"`, 'info');
      break;
    case 'compare_contents':
      openDeepCompareModal();
      break;
    case 'copy_to_side':
      copyItemToSide(item, side);
      break;
    case 'move_to_side':
      moveItemToSide(item, side);
      break;
    case 'copy_to_folder':
      copyItemToFolder(item, side);
      break;
    case 'move_to_folder':
      moveItemToFolder(item, side);
      break;
    case 'delete':
      deleteContextItem(item, side);
      break;
    case 'rename':
      renameContextItem(item, side);
      break;
    case 'attributes':
      openAttributesModal(item, side);
      break;
    case 'touch':
      touchContextItem(item);
      break;
    case 'exclude':
      excludeContextItem(item);
      break;
    case 'new_folder':
      createNewFolderInContext(item, side);
      break;
    case 'copy_filename':
      copyItemFilename(item);
      break;
    case 'ignored':
      item.isIgnored = !item.isIgnored;
      applyFilterAndRender();
      showToast(item.isIgnored ? `Ignored "${item.name}"` : `Unignored "${item.name}"`, 'info');
      break;
    case 'refresh_selection':
      runFolderComparison();
      break;
    case 'file_compare_report':
      openFileCompareReport(item);
      break;
    case 'sync_update_right':
    case 'sync_update_left':
    case 'sync_mirror_right':
    case 'sync_mirror_left':
      executeSync(action, item);
      break;
  }
}

function setFolderOpenState(relPath, isOpen) {
  if (!relPath || !appState.treeNodeMap) return;
  const node = appState.treeNodeMap.get(relPath);
  appState.folderOpenState.set(relPath, isOpen);
  if (node) {
    node.isOpen = isOpen;
  }
  applyFilterAndRender();
  showToast(`${isOpen ? 'Opened' : 'Closed'} folder "${node ? node.name : relPath}"`, 'info');
}

function openSubfolders(relPath) {
  if (!relPath || !appState.treeNodeMap) return;
  const targetNode = appState.treeNodeMap.get(relPath);
  if (!targetNode) return;

  function recurseOpen(node) {
    if (node.isDirectory) {
      node.isOpen = true;
      appState.folderOpenState.set(node.relativePath, true);
    }
    if (node.children) {
      for (let i = 0; i < node.children.length; i++) {
        recurseOpen(node.children[i]);
      }
    }
  }

  recurseOpen(targetNode);
  applyFilterAndRender();
  showToast(`Opened all subfolders in "${targetNode.name}"`, 'info');
}

function closeSubfolders(relPath) {
  if (!relPath || !appState.treeNodeMap) return;
  const targetNode = appState.treeNodeMap.get(relPath);
  if (!targetNode) return;

  function recurseClose(node) {
    if (node.children) {
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        if (child.isDirectory) {
          child.isOpen = false;
          appState.folderOpenState.set(child.relativePath, false);
          recurseClose(child);
        }
      }
    }
  }

  recurseClose(targetNode);
  applyFilterAndRender();
  showToast(`Closed all subfolders in "${targetNode.name}"`, 'info');
}

function setAsBaseFolders(item) {
  if (!item) return;
  let updated = false;
  if (item.left && appState.leftPath) {
    appState.leftPath = item.left.fullPath;
    const el = document.getElementById('leftPathInput');
    if (el) el.value = appState.leftPath;
    updated = true;
  }
  if (item.right && appState.rightPath) {
    appState.rightPath = item.right.fullPath;
    const el = document.getElementById('rightPathInput');
    if (el) el.value = appState.rightPath;
    updated = true;
  }
  if (updated) {
    appendLog(`Base folders changed to: ${item.relativePath}`);
    showToast(`Base folders set to: ${item.name}`, 'success');
    runFolderComparison();
  }
}

async function performQuickCompare(item) {
  if (!item) return;
  if (!item.left && !item.right) return;
  if (!item.left) {
    showToast(`Quick Compare: File exists ONLY on Right side (${formatTreeSize(item.right.size)})`, 'info');
    return;
  }
  if (!item.right) {
    showToast(`Quick Compare: File exists ONLY on Left side (${formatTreeSize(item.left.size)})`, 'info');
    return;
  }

  if (item.status === 'same') {
    showToast(`Quick Compare: Binary identical (${formatTreeSize(item.left.size)})`, 'success');
    return;
  }

  if (item.left.size !== item.right.size) {
    showToast(`Quick Compare: Files are different (Sizes differ: Left ${formatTreeSize(item.left.size)} vs Right ${formatTreeSize(item.right.size)})`, 'warning');
    return;
  }

  try {
    const res = await window.api.compareSelectionDeep(
      appState.leftPath,
      appState.rightPath,
      [item.relativePath],
      'crc'
    );
    if (res && res.updatedItems && res.updatedItems[0]) {
      const updated = res.updatedItems[0];
      if (updated.status === 'same') {
        showToast(`Quick Compare: Binary identical CRC (${formatTreeSize(item.left.size)})`, 'success');
      } else {
        showToast(`Quick Compare: CRC Mismatch - Files are different`, 'warning');
      }
      runFolderComparison();
    } else {
      showToast(`Quick Compare: Content differs`, 'warning');
    }
  } catch (err) {
    showToast(`Quick Compare: ${err.message}`, 'error');
  }
}

async function copyItemToSide(item, clickedSide) {
  if (!item) return;
  let srcPath = '';
  let destPath = '';
  let sideName = '';

  if (clickedSide === 'left') {
    if (!item.left || !appState.rightPath) return;
    srcPath = item.left.fullPath;
    destPath = `${appState.rightPath}/${item.relativePath}`;
    sideName = 'Right';
  } else {
    if (!item.right || !appState.leftPath) return;
    srcPath = item.right.fullPath;
    destPath = `${appState.leftPath}/${item.relativePath}`;
    sideName = 'Left';
  }

  appendLog(`Copying to ${sideName}: ${item.relativePath}`);
  const res = await window.api.copyItem(srcPath, destPath);
  if (res.success) {
    showToast(`Copied "${item.name}" to ${sideName}`, 'success');
    runFolderComparison();
  } else {
    showToast(`Copy failed: ${res.error}`, 'error');
  }
}

async function moveItemToSide(item, clickedSide) {
  if (!item) return;
  let srcPath = '';
  let destPath = '';
  let sideName = '';

  if (clickedSide === 'left') {
    if (!item.left || !appState.rightPath) return;
    srcPath = item.left.fullPath;
    destPath = `${appState.rightPath}/${item.relativePath}`;
    sideName = 'Right';
  } else {
    if (!item.right || !appState.leftPath) return;
    srcPath = item.right.fullPath;
    destPath = `${appState.leftPath}/${item.relativePath}`;
    sideName = 'Left';
  }

  if (confirm(`Move "${item.name}" to ${sideName}?`)) {
    appendLog(`Moving to ${sideName}: ${item.relativePath}`);
    const res = await window.api.moveItem(srcPath, destPath);
    if (res.success) {
      showToast(`Moved "${item.name}" to ${sideName}`, 'success');
      runFolderComparison();
    } else {
      showToast(`Move failed: ${res.error}`, 'error');
    }
  }
}

async function copyItemToFolder(item, clickedSide) {
  if (!item) return;
  const srcPath = clickedSide === 'left' ? (item.left && item.left.fullPath) : ((item.right && item.right.fullPath) || (item.left && item.left.fullPath));
  if (!srcPath) return;
  const targetDir = await window.api.selectFolder(srcPath);
  if (targetDir) {
    const destPath = `${targetDir}/${item.name}`;
    const res = await window.api.copyItem(srcPath, destPath);
    if (res.success) {
      showToast(`Copied to ${targetDir}`, 'success');
    } else {
      showToast(`Copy failed: ${res.error}`, 'error');
    }
  }
}

async function moveItemToFolder(item, clickedSide) {
  if (!item) return;
  const srcPath = clickedSide === 'left' ? (item.left && item.left.fullPath) : ((item.right && item.right.fullPath) || (item.left && item.left.fullPath));
  if (!srcPath) return;
  const targetDir = await window.api.selectFolder(srcPath);
  if (targetDir) {
    const destPath = `${targetDir}/${item.name}`;
    const res = await window.api.moveItem(srcPath, destPath);
    if (res.success) {
      showToast(`Moved to ${targetDir}`, 'success');
      runFolderComparison();
    } else {
      showToast(`Move failed: ${res.error}`, 'error');
    }
  }
}

async function deleteContextItem(item, clickedSide) {
  if (!item) return;
  const sideLabel = clickedSide === 'left' ? 'Left side' : (clickedSide === 'right' ? 'Right side' : 'both sides');
  if (confirm(`Delete "${item.name}" from ${sideLabel}?`)) {
    if (clickedSide === 'left' && item.left) {
      await window.api.deleteItem(item.left.fullPath);
    } else if (clickedSide === 'right' && item.right) {
      await window.api.deleteItem(item.right.fullPath);
    } else {
      if (item.left) await window.api.deleteItem(item.left.fullPath);
      if (item.right) await window.api.deleteItem(item.right.fullPath);
    }
    showToast(`Deleted "${item.name}"`, 'info');
    runFolderComparison();
  }
}

async function renameContextItem(item, clickedSide) {
  if (!item) return;
  const newName = prompt(`Rename "${item.name}" to:`, item.name);
  if (!newName || newName === item.name) return;

  let renamedAny = false;
  if (item.left) {
    const parent = item.left.fullPath.substring(0, item.left.fullPath.lastIndexOf('/'));
    const newPath = `${parent}/${newName}`;
    const res = await window.api.renameItem(item.left.fullPath, newPath);
    if (res.success) renamedAny = true;
  }
  if (item.right) {
    const parent = item.right.fullPath.substring(0, item.right.fullPath.lastIndexOf('/'));
    const newPath = `${parent}/${newName}`;
    const res = await window.api.renameItem(item.right.fullPath, newPath);
    if (res.success) renamedAny = true;
  }

  if (renamedAny) {
    showToast(`Renamed to "${newName}"`, 'success');
    runFolderComparison();
  } else {
    showToast(`Rename failed`, 'error');
  }
}

async function openAttributesModal(item, side) {
  if (!item) return;
  const target = (side === 'left' && item.left) ? item.left.fullPath :
                 (side === 'right' && item.right) ? item.right.fullPath :
                 (item.left ? item.left.fullPath : (item.right ? item.right.fullPath : null));
  if (!target) return;

  try {
    const attr = await window.api.getAttributes(target);
    if (!attr.success) {
      showToast(`Attributes error: ${attr.error}`, 'error');
      return;
    }

    document.getElementById('attrModalTitle').textContent = `Attributes - ${item.name}`;
    document.getElementById('attrName').textContent = item.name;
    document.getElementById('attrType').textContent = attr.isDirectory ? 'Folder' : 'File';
    document.getElementById('attrPath').textContent = attr.fullPath;
    document.getElementById('attrSize').textContent = attr.isDirectory ? '-' : `${formatTreeSize(attr.size)} (${attr.size.toLocaleString()} bytes)`;
    document.getElementById('attrModified').textContent = new Date(attr.mtime).toLocaleString();
    document.getElementById('attrCreated').textContent = new Date(attr.birthtime).toLocaleString();
    document.getElementById('attrPermissions').textContent = `0${attr.mode}`;

    const modal = document.getElementById('attributesModal');
    if (modal) modal.style.display = 'flex';
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

function closeAttributesModal() {
  const modal = document.getElementById('attributesModal');
  if (modal) modal.style.display = 'none';
}

async function touchContextItem(item) {
  if (!item) return;
  let touched = false;
  if (item.left) {
    await window.api.touchItem(item.left.fullPath);
    touched = true;
  }
  if (item.right) {
    await window.api.touchItem(item.right.fullPath);
    touched = true;
  }
  if (touched) {
    showToast(`Touched: "${item.name}" (Timestamp updated)`, 'success');
    runFolderComparison();
  }
}

function excludeContextItem(item) {
  if (!item) return;
  const filterInput = document.getElementById('nameFilterInput');
  if (filterInput) {
    const currentVal = filterInput.value.trim();
    const pattern = `-${item.name}`;
    filterInput.value = currentVal ? `${currentVal}; ${pattern}` : pattern;
    onNameFilterChange();
    showToast(`Excluded "${item.name}"`, 'info');
  }
}

async function createNewFolderInContext(item, clickedSide) {
  if (!item) return;
  const folderName = prompt('Enter new folder name:');
  if (!folderName) return;

  const targetPath = (clickedSide === 'left' && item.left) ? item.left.fullPath : 
                     (clickedSide === 'right' && item.right) ? item.right.fullPath :
                     (item.left ? item.left.fullPath : item.right.fullPath);
  if (!targetPath) return;

  const parentDir = item.isDirectory ? targetPath : targetPath.substring(0, targetPath.lastIndexOf('/'));
  const newFolderPath = `${parentDir}/${folderName}`;
  const res = await window.api.createFolder(newFolderPath);
  if (res.success) {
    showToast(`Folder "${folderName}" created`, 'success');
    runFolderComparison();
  } else {
    showToast(`Failed: ${res.error}`, 'error');
  }
}

function copyItemFilename(item) {
  if (!item) return;
  navigator.clipboard.writeText(item.name);
  showToast(`Copied "${item.name}" to clipboard`, 'info');
}

async function openFileCompareReport(item) {
  if (!item) return;
  const fullLeft = item.left ? item.left.fullPath : '';
  const fullRight = item.right ? item.right.fullPath : '';

  let leftText = '';
  let rightText = '';
  if (fullLeft) {
    const resL = await window.api.readTextFile(fullLeft);
    if (resL.success) leftText = resL.content;
  }
  if (fullRight) {
    const resR = await window.api.readTextFile(fullRight);
    if (resR.success) rightText = resR.content;
  }

  const leftLines = leftText ? leftText.split(/\r\n|\r|\n/) : [];
  const rightLines = rightText ? rightText.split(/\r\n|\r|\n/) : [];

  let diffSummary = '';
  if (!fullLeft) diffSummary = `Right side orphan file (${rightLines.length} lines)`;
  else if (!fullRight) diffSummary = `Left side orphan file (${leftLines.length} lines)`;
  else if (item.status === 'same') diffSummary = `Files are identical (${leftLines.length} lines)`;
  else diffSummary = `Left: ${leftLines.length} lines | Right: ${rightLines.length} lines | Status: Different`;

  const headerHtml = `
    <div><strong>File:</strong> ${escapeHtml(item.name)}</div>
    <div><strong>Left:</strong> ${escapeHtml(fullLeft || '(None)')}</div>
    <div><strong>Right:</strong> ${escapeHtml(fullRight || '(None)')}</div>
    <div><strong>Summary:</strong> ${escapeHtml(diffSummary)}</div>
  `;
  document.getElementById('reportHeaderInfo').innerHTML = headerHtml;

  let reportText = `--- LEFT:  ${fullLeft || '/dev/null'}\n+++ RIGHT: ${fullRight || '/dev/null'}\n\n`;
  const maxL = Math.max(leftLines.length, rightLines.length);
  const limit = Math.min(maxL, 100);
  for (let i = 0; i < limit; i++) {
    const l = leftLines[i] !== undefined ? leftLines[i] : '';
    const r = rightLines[i] !== undefined ? rightLines[i] : '';
    if (l === r) {
      reportText += `  ${l}\n`;
    } else {
      if (leftLines[i] !== undefined) reportText += `- ${l}\n`;
      if (rightLines[i] !== undefined) reportText += `+ ${r}\n`;
    }
  }
  if (maxL > 100) {
    reportText += `\n... [Truncated ${maxL - 100} additional lines] ...\n`;
  }

  document.getElementById('reportContent').textContent = reportText;
  const modal = document.getElementById('reportModal');
  if (modal) modal.style.display = 'flex';
}

function closeReportModal() {
  const modal = document.getElementById('reportModal');
  if (modal) modal.style.display = 'none';
}

function copyReportToClipboard() {
  const text = document.getElementById('reportContent').textContent;
  navigator.clipboard.writeText(text);
  showToast('Report copied to clipboard', 'success');
}

async function openHexCompareView(leftPath, rightPath, filename) {
  const targetPath = leftPath || rightPath;
  if (!targetPath) return;
  
  const res = await window.api.readHexDump(targetPath, 0, 4096);
  if (!res.success) {
    showToast(`Hex Compare error: ${res.error}`, 'error');
    return;
  }

  let hexText = `--- HEX DUMP: ${filename} (Showing first 4 KB) ---\n\n`;
  res.rows.forEach(r => {
    hexText += `${r.offset}  ${r.hex}  |${r.ascii}|\n`;
  });

  document.getElementById('reportHeaderInfo').innerHTML = `
    <div><strong>Hex Compare:</strong> ${escapeHtml(filename)}</div>
    <div><strong>Path:</strong> ${escapeHtml(targetPath)}</div>
    <div><strong>Size:</strong> ${res.totalSize.toLocaleString()} bytes</div>
  `;
  document.getElementById('reportContent').textContent = hexText;
  const modal = document.getElementById('reportModal');
  if (modal) modal.style.display = 'flex';
}

// --- HEX COMPARE ENGINE (Beyond Compare 5 View) ---
let hexCompareState = {
  leftPath: '',
  rightPath: '',
  leftRows: [],
  rightRows: []
};

function openHexCompare(left = '', right = '', title = 'Hex Compare') {
  hexCompareState.leftPath = left || '';
  hexCompareState.rightPath = right || '';

  const inL = document.getElementById('hexLeftPathInput');
  const inR = document.getElementById('hexRightPathInput');
  if (inL) inL.value = left || '';
  if (inR) inR.value = right || '';

  const tabTitle = document.getElementById('currentHexTabTitle');
  if (tabTitle) {
    const clean = (title || 'Hex Compare').replace(/^New\s+/, '').replace(/\s*-\s*Hex Compare$/, '');
    tabTitle.textContent = clean || 'Hex Compare';
  }

  const tabHexBtn = document.getElementById('tabHexBtn');
  if (tabHexBtn) tabHexBtn.style.display = 'flex';

  switchView('hex');

  if (!left && !right) {
    renderEmptyHexCompare();
    setTimeout(() => { if (inL) inL.focus(); }, 50);
    return;
  }

  if (left && right) {
    window.api.recordAutoSavedSession({
      type: 'hex_compare',
      name: title !== 'Hex Compare' ? title : undefined,
      leftPath: left,
      rightPath: right
    }).then(() => reloadSessions()).catch(() => {});
  }

  if (left) loadHexFileForSide('left', left);
  if (right) loadHexFileForSide('right', right);
}

function renderEmptyHexCompare() {
  const cL = document.getElementById('hexLeftContent');
  const cR = document.getElementById('hexRightContent');
  if (cL) {
    cL.innerHTML = `
      <div class="text-empty-dropzone" onclick="browseHexFile('left')">
        <div class="dropzone-icon">🔢</div>
        <div>Drop left file here to view Hex, or click 📁▾ to browse</div>
      </div>
    `;
  }
  if (cR) {
    cR.innerHTML = `
      <div class="text-empty-dropzone" onclick="browseHexFile('right')">
        <div class="dropzone-icon">🔢</div>
        <div>Drop right file here to view Hex, or click 📁▾ to browse</div>
      </div>
    `;
  }
  const badge = document.getElementById('hexDiffBadge');
  if (badge) {
    badge.textContent = 'Drag files into panels or click 📁 to browse';
    badge.style.background = 'rgba(255, 255, 255, 0.08)';
    badge.style.color = '#aaa';
  }
}

async function loadHexFileForSide(side, filePath) {
  if (!filePath) return;
  const res = await window.api.readHexDump(filePath, 0, 8192);
  if (!res.success) {
    showToast(`Hex read error: ${res.error}`, 'error');
    return;
  }

  if (side === 'left') {
    hexCompareState.leftPath = filePath;
    hexCompareState.leftRows = res.rows || [];
    const inL = document.getElementById('hexLeftPathInput');
    if (inL) inL.value = filePath;
    const metaL = document.getElementById('hexLeftMeta');
    if (metaL) metaL.textContent = `${formatBytes(res.totalSize || 0)} | Binary ▾`;
  } else {
    hexCompareState.rightPath = filePath;
    hexCompareState.rightRows = res.rows || [];
    const inR = document.getElementById('hexRightPathInput');
    if (inR) inR.value = filePath;
    const metaR = document.getElementById('hexRightMeta');
    if (metaR) metaR.textContent = `${formatBytes(res.totalSize || 0)} | Binary ▾`;
  }

  renderHexDumpRows(side, res.rows || []);
  updateHexDiffBadge();
}

function renderHexDumpRows(side, rows) {
  const container = document.getElementById(side === 'left' ? 'hexLeftContent' : 'hexRightContent');
  if (!container) return;

  let html = '';
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    html += `<div class="hex-row"><span class="hex-offset">${escapeHtml(r.offset)}</span> <span class="hex-bytes">${escapeHtml(r.hex)}</span> <span class="hex-ascii">${escapeHtml(r.ascii)}</span></div>`;
  }
  container.innerHTML = html;
}

function updateHexDiffBadge() {
  const badge = document.getElementById('hexDiffBadge');
  if (!badge) return;
  if (hexCompareState.leftPath && hexCompareState.rightPath) {
    const rowsL = hexCompareState.leftRows;
    const rowsR = hexCompareState.rightRows;
    let diffs = 0;
    const maxLen = Math.max(rowsL.length, rowsR.length);
    for (let i = 0; i < maxLen; i++) {
      if (!rowsL[i] || !rowsR[i] || rowsL[i].hex !== rowsR[i].hex) diffs++;
    }
    badge.textContent = diffs === 0 ? 'Files are identical (Hex Match)' : `${diffs} differences in sample`;
    badge.style.background = diffs === 0 ? 'rgba(74, 222, 128, 0.15)' : 'rgba(239, 68, 68, 0.15)';
    badge.style.color = diffs === 0 ? '#4ade80' : '#f87171';
  } else if (hexCompareState.leftPath || hexCompareState.rightPath) {
    badge.textContent = 'One file loaded — Select other file to compare';
    badge.style.background = 'rgba(56, 139, 253, 0.15)';
    badge.style.color = '#388bfd';
  }
}

async function browseHexFile(side) {
  const current = side === 'left' ? hexCompareState.leftPath : hexCompareState.rightPath;
  const selected = await window.api.selectFile(current || '');
  if (!selected) return;
  await loadHexFileForSide(side, selected);
}

function handleHexPathKeydown(event, side) {
  if (event.key === 'Enter') handleHexPathBlur(side);
}

function handleHexPathBlur(side) {
  const input = document.getElementById(side === 'left' ? 'hexLeftPathInput' : 'hexRightPathInput');
  if (input && input.value.trim()) {
    loadHexFileForSide(side, input.value.trim());
  }
}

function swapHexSides() {
  const temp = hexCompareState.leftPath;
  hexCompareState.leftPath = hexCompareState.rightPath;
  hexCompareState.rightPath = temp;
  openHexCompare(hexCompareState.leftPath, hexCompareState.rightPath);
}

function reloadHexCompare() {
  if (hexCompareState.leftPath) loadHexFileForSide('left', hexCompareState.leftPath);
  if (hexCompareState.rightPath) loadHexFileForSide('right', hexCompareState.rightPath);
}

function closeHexTab(event) {
  if (event) event.stopPropagation();
  const b = document.getElementById('tabHexBtn');
  if (b) b.style.display = 'none';
  switchToRemainingTabOrHome();
}

// --- THEME SWITCHER (Beyond Compare 5 Dark / Light Mode) ---
function initTheme() {
  const savedTheme = localStorage.getItem('diffcore_theme') || 'dark';
  applyTheme(savedTheme);
}

function applyTheme(theme) {
  const icon = document.getElementById('themeToggleIcon');
  const label = document.getElementById('themeToggleLabel');
  if (theme === 'light') {
    document.body.classList.add('theme-light');
    if (icon) icon.textContent = '🌙';
    if (label) label.textContent = 'Dark Mode';
  } else {
    document.body.classList.remove('theme-light');
    if (icon) icon.textContent = '☀️';
    if (label) label.textContent = 'Light Mode';
  }
  localStorage.setItem('diffcore_theme', theme);
}

function toggleTheme() {
  const isLight = document.body.classList.contains('theme-light');
  applyTheme(isLight ? 'dark' : 'light');
  showToast(isLight ? 'Switched to Dark Mode' : 'Switched to Light Mode', 'info');
}

// --- TEXT COMPARE WORD WRAP & OVER-UNDER LAYOUT (Beyond Compare 5) ---
function toggleTextWordWrap() {
  const left = document.getElementById('textLeftScroll');
  const right = document.getElementById('textRightScroll');
  const isWrapped = left ? left.classList.contains('word-wrap-enabled') : false;
  if (left) left.classList.toggle('word-wrap-enabled', !isWrapped);
  if (right) right.classList.toggle('word-wrap-enabled', !isWrapped);
  const btn = document.getElementById('btnTextWordWrap');
  if (btn) btn.classList.toggle('active', !isWrapped);
  syncHorizontalScrollWidths();
  showToast(isWrapped ? 'Word wrap disabled' : 'Word wrap enabled', 'info');
}

function toggleTextLayout() {
  const panes = document.querySelector('.text-compare-panes');
  if (!panes) return;
  const isOverUnder = panes.classList.contains('over-under-layout');
  panes.classList.toggle('over-under-layout', !isOverUnder);
  const btn = document.getElementById('btnTextLayout');
  if (btn) btn.classList.toggle('active', !isOverUnder);
  syncHorizontalScrollWidths();
  showToast(isOverUnder ? 'Layout: Side-by-Side' : 'Layout: Over-Under', 'info');
}

async function openTextCompareReport() {
  const file = appState.currentTextFile;
  const leftName = file.leftFullPath ? file.leftFullPath : 'Left File';
  const rightName = file.rightFullPath ? file.rightFullPath : 'Right File';

  const modal = document.getElementById('reportModal');
  const header = document.getElementById('reportHeaderInfo');
  const content = document.getElementById('reportContent');

  if (header) {
    header.innerHTML = `
      <div><strong>Left:</strong> ${escapeHtml(leftName)}</div>
      <div><strong>Right:</strong> ${escapeHtml(rightName)}</div>
      <div><strong>Generated:</strong> ${new Date().toLocaleString()}</div>
    `;
  }

  if (content) {
    const lines = [];
    lines.push(`DIFFCORE FILE COMPARE REPORT (BEYOND COMPARE 5 EDITION)`);
    lines.push(`=======================================================`);
    lines.push(`Left File:  ${leftName}`);
    lines.push(`Right File: ${rightName}`);
    lines.push(`Timestamp:  ${new Date().toISOString()}`);
    lines.push(`-------------------------------------------------------\n`);

    const maxLines = Math.max(file.leftLines ? file.leftLines.length : 0, file.rightLines ? file.rightLines.length : 0);
    for (let i = 0; i < maxLines; i++) {
      const l = (file.leftLines && i < file.leftLines.length) ? file.leftLines[i] : '';
      const r = (file.rightLines && i < file.rightLines.length) ? file.rightLines[i] : '';
      if (l === r) {
        lines.push(`  ${String(i + 1).padStart(5, ' ')}: ${l}`);
      } else {
        lines.push(`- ${String(i + 1).padStart(5, ' ')}: ${l}`);
        lines.push(`+ ${String(i + 1).padStart(5, ' ')}: ${r}`);
      }
    }
    content.textContent = lines.join('\n');
  }

  if (modal) modal.style.display = 'flex';
}

// --- PICTURE COMPARE ENGINE (Beyond Compare 5) ---
let picCompareState = {
  leftPath: '',
  rightPath: ''
};

let picTransformState = {
  mode: 'side', // 'side', 'blend', 'split', 'diff'
  blendOpacity: 0.5,
  zoom: 1.0,
  rotation: 0,
  flipH: false
};

function openPictureCompare(left = '', right = '', title = 'Picture Compare') {
  picCompareState.leftPath = left || '';
  picCompareState.rightPath = right || '';

  const inL = document.getElementById('picLeftPathInput');
  const inR = document.getElementById('picRightPathInput');
  if (inL) inL.value = left || '';
  if (inR) inR.value = right || '';

  const tabTitle = document.getElementById('currentPictureTabTitle');
  if (tabTitle) {
    const clean = (title || 'Picture Compare').replace(/^New\s+/, '').replace(/\s*-\s*Picture Compare$/, '');
    tabTitle.textContent = clean || 'Picture Compare';
  }

  const tabPicBtn = document.getElementById('tabPictureBtn');
  if (tabPicBtn) tabPicBtn.style.display = 'flex';

  switchView('picture');

  if (!left && !right) {
    renderEmptyPictureCompare();
    setTimeout(() => { if (inL) inL.focus(); }, 50);
    return;
  }

  if (left && right) {
    window.api.recordAutoSavedSession({
      type: 'picture_compare',
      name: title !== 'Picture Compare' ? title : undefined,
      leftPath: left,
      rightPath: right
    }).then(() => reloadSessions()).catch(() => {});
  }

  if (left) loadPicFileForSide('left', left);
  if (right) loadPicFileForSide('right', right);
}

function renderEmptyPictureCompare() {
  const cL = document.getElementById('picLeftContent');
  const cR = document.getElementById('picRightContent');
  if (cL) {
    cL.innerHTML = `
      <div class="text-empty-dropzone" onclick="browsePicFile('left')">
        <div class="dropzone-icon">🖼️</div>
        <div>Drop left image here, or click 📁▾ to browse</div>
      </div>
    `;
  }
  if (cR) {
    cR.innerHTML = `
      <div class="text-empty-dropzone" onclick="browsePicFile('right')">
        <div class="dropzone-icon">🖼️</div>
        <div>Drop right image here, or click 📁▾ to browse</div>
      </div>
    `;
  }
  const badge = document.getElementById('pictureDiffBadge');
  if (badge) {
    badge.textContent = 'Drag images into panels or click 📁 to browse';
    badge.style.background = 'rgba(255, 255, 255, 0.08)';
    badge.style.color = '#aaa';
  }
}

async function loadPicFileForSide(side, filePath) {
  if (!filePath) return;
  const container = document.getElementById(side === 'left' ? 'picLeftContent' : 'picRightContent');
  const input = document.getElementById(side === 'left' ? 'picLeftPathInput' : 'picRightPathInput');

  if (side === 'left') picCompareState.leftPath = filePath;
  else picCompareState.rightPath = filePath;

  if (input) input.value = filePath;

  if (container) {
    const fileUrl = filePath.startsWith('file://') ? filePath : `file://${encodeURI(filePath)}`;
    container.innerHTML = `<img src="${fileUrl}" class="picture-preview-img" alt="${escapeHtml(filePath)}" onload="updatePicMeta('${side}', this)">`;
  }
  updatePictureDiffBadge();
  if (picTransformState.mode !== 'side') {
    renderPictureModeView();
  }
}

function updatePicMeta(side, img) {
  const meta = document.getElementById(side === 'left' ? 'picLeftMeta' : 'picRightMeta');
  if (meta && img) {
    meta.textContent = `${img.naturalWidth} x ${img.naturalHeight} px`;
  }
}

function updatePictureDiffBadge() {
  const badge = document.getElementById('pictureDiffBadge');
  if (!badge) return;
  if (picCompareState.leftPath && picCompareState.rightPath) {
    badge.textContent = 'Comparing images';
    badge.style.background = 'rgba(74, 222, 128, 0.15)';
    badge.style.color = '#4ade80';
  } else if (picCompareState.leftPath || picCompareState.rightPath) {
    badge.textContent = 'One image loaded — Select other image to compare';
    badge.style.background = 'rgba(56, 139, 253, 0.15)';
    badge.style.color = '#388bfd';
  }
}

function setPictureMode(mode) {
  picTransformState.mode = mode;
  ['btnPicModeSide', 'btnPicModeBlend', 'btnPicModeSplit', 'btnPicModeDiff'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  const idMap = { 'side': 'btnPicModeSide', 'blend': 'btnPicModeBlend', 'split': 'btnPicModeSplit', 'diff': 'btnPicModeDiff' };
  const cur = document.getElementById(idMap[mode]);
  if (cur) cur.classList.add('active');

  const blendControls = document.getElementById('picBlendControls');
  if (blendControls) blendControls.style.display = (mode === 'blend' || mode === 'split') ? 'flex' : 'none';

  renderPictureModeView();
}

function handlePicBlendSlide(val) {
  picTransformState.blendOpacity = val / 100;
  const label = document.getElementById('picBlendVal');
  if (label) label.textContent = `${val}%`;

  const overlay = document.getElementById('picBlendOverlayImg');
  if (overlay) {
    if (picTransformState.mode === 'split') {
      overlay.style.clipPath = `polygon(0 0, ${val}% 0, ${val}% 100%, 0 100%)`;
    } else {
      overlay.style.opacity = picTransformState.blendOpacity;
    }
  }
}

function zoomPicture(factor) {
  picTransformState.zoom = Math.max(0.2, Math.min(5.0, picTransformState.zoom * factor));
  applyPictureTransforms();
}

function resetPictureZoom() {
  picTransformState.zoom = 1.0;
  applyPictureTransforms();
}

function rotatePicture(deg) {
  picTransformState.rotation = (picTransformState.rotation + deg) % 360;
  applyPictureTransforms();
}

function flipPicture(axis) {
  if (axis === 'h') picTransformState.flipH = !picTransformState.flipH;
  applyPictureTransforms();
}

function applyPictureTransforms() {
  const transform = `scale(${picTransformState.zoom}) rotate(${picTransformState.rotation}deg) scaleX(${picTransformState.flipH ? -1 : 1})`;
  document.querySelectorAll('.picture-preview-img, .pic-blend-img-base, .pic-blend-img-overlay').forEach(img => {
    img.style.transform = transform;
  });
}

function renderPictureModeView() {
  const panes = document.getElementById('pictureContainerPanes');
  if (!panes) return;

  const left = picCompareState.leftPath;
  const right = picCompareState.rightPath;
  const urlL = left ? (left.startsWith('file://') ? left : `file://${encodeURI(left)}`) : '';
  const urlR = right ? (right.startsWith('file://') ? right : `file://${encodeURI(right)}`) : '';

  if (picTransformState.mode === 'side') {
    panes.style.display = 'flex';
    document.getElementById('picLeftPaneWrapper').style.display = 'flex';
    document.getElementById('picRightPaneWrapper').style.display = 'flex';
    document.getElementById('picCenterGutter').style.display = 'flex';
    const singleContainer = document.getElementById('picSingleModeContainer');
    if (singleContainer) singleContainer.remove();
  } else {
    document.getElementById('picLeftPaneWrapper').style.display = 'none';
    document.getElementById('picRightPaneWrapper').style.display = 'none';
    document.getElementById('picCenterGutter').style.display = 'none';

    let singleContainer = document.getElementById('picSingleModeContainer');
    if (!singleContainer) {
      singleContainer = document.createElement('div');
      singleContainer.id = 'picSingleModeContainer';
      singleContainer.className = 'pic-blend-container';
      panes.appendChild(singleContainer);
    }

    if (picTransformState.mode === 'blend') {
      singleContainer.innerHTML = `
        <img src="${urlL}" class="pic-blend-img-base" alt="Left">
        <img src="${urlR}" id="picBlendOverlayImg" class="pic-blend-img-overlay" style="opacity: ${picTransformState.blendOpacity};" alt="Right">
      `;
    } else if (picTransformState.mode === 'split') {
      singleContainer.innerHTML = `
        <img src="${urlR}" class="pic-blend-img-base" alt="Right">
        <img src="${urlL}" id="picBlendOverlayImg" class="pic-blend-img-overlay" style="clip-path: polygon(0 0, ${picTransformState.blendOpacity * 100}% 0, ${picTransformState.blendOpacity * 100}% 100%, 0 100%);" alt="Left">
      `;
    } else if (picTransformState.mode === 'diff') {
      singleContainer.innerHTML = `
        <div style="text-align: center;">
          <canvas id="picDiffCanvas" style="max-width: 90%; max-height: 80vh; border: 1px solid #444; box-shadow: 0 4px 12px rgba(0,0,0,0.5);"></canvas>
          <div style="font-size: 11px; color: #ff5555; margin-top: 6px;">Differing pixels highlighted in magenta</div>
        </div>
      `;
      renderPictureDiffCanvas(urlL, urlR);
    }
    applyPictureTransforms();
  }
}

function renderPictureDiffCanvas(urlL, urlR) {
  if (!urlL || !urlR) return;
  const canvas = document.getElementById('picDiffCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const imgL = new Image();
  const imgR = new Image();
  imgL.src = urlL;
  imgR.src = urlR;

  let loaded = 0;
  const onLoaded = () => {
    loaded++;
    if (loaded === 2) {
      const w = Math.min(imgL.naturalWidth, imgR.naturalWidth, 1600);
      const h = Math.min(imgL.naturalHeight, imgR.naturalHeight, 1200);
      canvas.width = w;
      canvas.height = h;

      const c1 = document.createElement('canvas');
      c1.width = w; c1.height = h;
      const ctx1 = c1.getContext('2d');
      ctx1.drawImage(imgL, 0, 0, w, h);
      const d1 = ctx1.getImageData(0, 0, w, h).data;

      const c2 = document.createElement('canvas');
      c2.width = w; c2.height = h;
      const ctx2 = c2.getContext('2d');
      ctx2.drawImage(imgR, 0, 0, w, h);
      const d2 = ctx2.getImageData(0, 0, w, h).data;

      const outData = ctx.createImageData(w, h);
      const dOut = outData.data;

      for (let i = 0; i < d1.length; i += 4) {
        const diffR = Math.abs(d1[i] - d2[i]);
        const diffG = Math.abs(d1[i+1] - d2[i+1]);
        const diffB = Math.abs(d1[i+2] - d2[i+2]);
        const totalDiff = diffR + diffG + diffB;

        if (totalDiff > 15) {
          dOut[i] = 255;
          dOut[i+1] = 0;
          dOut[i+2] = 200;
          dOut[i+3] = 255;
        } else {
          const gray = (d1[i] + d1[i+1] + d1[i+2]) / 6;
          dOut[i] = gray;
          dOut[i+1] = gray;
          dOut[i+2] = gray;
          dOut[i+3] = 255;
        }
      }
      ctx.putImageData(outData, 0, 0);
    }
  };

  imgL.onload = onLoaded;
  imgR.onload = onLoaded;
}

async function browsePicFile(side) {
  const current = side === 'left' ? picCompareState.leftPath : picCompareState.rightPath;
  const selected = await window.api.selectFile(current || '');
  if (!selected) return;
  await loadPicFileForSide(side, selected);
}

function handlePicPathKeydown(event, side) {
  if (event.key === 'Enter') handlePicPathBlur(side);
}

function handlePicPathBlur(side) {
  const input = document.getElementById(side === 'left' ? 'picLeftPathInput' : 'picRightPathInput');
  if (input && input.value.trim()) {
    loadPicFileForSide(side, input.value.trim());
  }
}

function swapPicSides() {
  const temp = picCompareState.leftPath;
  picCompareState.leftPath = picCompareState.rightPath;
  picCompareState.rightPath = temp;
  openPictureCompare(picCompareState.leftPath, picCompareState.rightPath);
}

function reloadPictureCompare() {
  if (picCompareState.leftPath) loadPicFileForSide('left', picCompareState.leftPath);
  if (picCompareState.rightPath) loadPicFileForSide('right', picCompareState.rightPath);
}

function closePictureTab(event) {
  if (event) event.stopPropagation();
  const b = document.getElementById('tabPictureBtn');
  if (b) b.style.display = 'none';
  switchToRemainingTabOrHome();
}

// --- MEDIA COMPARE ENGINE (Beyond Compare 5) ---
let mediaCompareState = {
  leftPath: '',
  rightPath: '',
  leftMetadata: null,
  rightMetadata: null
};

async function openMediaCompare(left = '', right = '', title = 'Media Compare') {
  mediaCompareState.leftPath = left || '';
  mediaCompareState.rightPath = right || '';

  const inL = document.getElementById('mediaLeftPathInput');
  const inR = document.getElementById('mediaRightPathInput');
  if (inL) inL.value = left || '';
  if (inR) inR.value = right || '';

  const tabTitle = document.getElementById('currentMediaTabTitle');
  if (tabTitle) {
    const clean = (title || 'Media Compare').replace(/^New\s+/, '').replace(/\s*-\s*Media Compare$/, '');
    tabTitle.textContent = clean || 'Media Compare';
  }

  const tabBtn = document.getElementById('tabMediaBtn');
  if (tabBtn) tabBtn.style.display = 'flex';

  switchView('media');

  if (left || right) {
    if (left && right) {
      window.api.recordAutoSavedSession({
        type: 'media_compare',
        name: title !== 'Media Compare' ? title : undefined,
        leftPath: left,
        rightPath: right
      }).then(() => reloadSessions()).catch(() => {});
    }
    loadMediaCompare(left, right);
  } else {
    renderEmptyMediaCompare();
  }
}

function renderEmptyMediaCompare() {
  const tbody = document.getElementById('mediaTagsTableBody');
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: #888; padding: 40px;">Select Left and Right audio/video files to compare tags</td></tr>`;
  }
}

async function loadMediaCompare(leftPath, rightPath) {
  mediaCompareState.leftPath = leftPath;
  mediaCompareState.rightPath = rightPath;

  let leftTags = null, rightTags = null;
  if (leftPath) {
    const res = await window.api.readMediaMetadata(leftPath);
    if (res.success) leftTags = res.tags;
    const playerL = document.getElementById('mediaPlayerLeft');
    if (playerL) playerL.src = `file://${encodeURI(leftPath)}`;
  } else {
    const playerL = document.getElementById('mediaPlayerLeft');
    if (playerL) playerL.removeAttribute('src');
  }
  if (rightPath) {
    const res = await window.api.readMediaMetadata(rightPath);
    if (res.success) rightTags = res.tags;
    const playerR = document.getElementById('mediaPlayerRight');
    if (playerR) playerR.src = `file://${encodeURI(rightPath)}`;
  } else {
    const playerR = document.getElementById('mediaPlayerRight');
    if (playerR) playerR.removeAttribute('src');
  }

  mediaCompareState.leftMetadata = leftTags;
  mediaCompareState.rightMetadata = rightTags;
  renderMediaTagsComparison();
}

function renderMediaTagsComparison() {
  const tbody = document.getElementById('mediaTagsTableBody');
  if (!tbody) return;

  const tL = mediaCompareState.leftMetadata || {};
  const tR = mediaCompareState.rightMetadata || {};

  const allKeys = [
    'File Name', 'File Size', 'File Format', 'Modified Date', 'Duration',
    'Title', 'Artist', 'Album', 'Track #', 'Year', 'Genre',
    'Bitrate', 'Sample Rate', 'Channels'
  ];

  let diffCount = 0;
  let html = '';

  const bothMediaLoaded = !!(mediaCompareState.leftPath && mediaCompareState.rightPath);

  for (const k of allKeys) {
    const vL = tL[k] || '-';
    const vR = tR[k] || '-';
    const isDiff = bothMediaLoaded && (vL !== vR && (tL[k] || tR[k]));
    if (isDiff) diffCount++;

    html += `
      <tr class="media-tags-row ${isDiff ? 'diff' : ''}">
        <td style="font-weight: 600; color: #aaa;">${escapeHtml(k)}</td>
        <td>${escapeHtml(vL)}</td>
        <td>${escapeHtml(vR)}</td>
      </tr>
    `;
  }

  tbody.innerHTML = html;

  const badge = document.getElementById('mediaDiffBadge');
  if (badge) {
    badge.textContent = `${diffCount} Tag Difference(s)`;
    badge.style.background = diffCount > 0 ? 'rgba(248, 81, 73, 0.2)' : 'rgba(74, 222, 128, 0.2)';
    badge.style.color = diffCount > 0 ? '#ff7b72' : '#4ade80';
  }
}

async function browseMediaFile(side) {
  const selected = await window.api.selectFile('');
  if (selected) {
    const input = document.getElementById(side === 'left' ? 'mediaLeftPathInput' : 'mediaRightPathInput');
    if (input) input.value = selected;
    if (side === 'left') mediaCompareState.leftPath = selected;
    else mediaCompareState.rightPath = selected;
    loadMediaCompare(mediaCompareState.leftPath, mediaCompareState.rightPath);
  }
}

function handleMediaPathKeydown(event, side) {
  if (event.key === 'Enter') handleMediaPathBlur(side);
}
function handleMediaPathBlur(side) {
  const inEl = document.getElementById(side === 'left' ? 'mediaLeftPathInput' : 'mediaRightPathInput');
  if (inEl && inEl.value.trim()) {
    if (side === 'left') mediaCompareState.leftPath = inEl.value.trim();
    else mediaCompareState.rightPath = inEl.value.trim();
    loadMediaCompare(mediaCompareState.leftPath, mediaCompareState.rightPath);
  }
}
function swapMediaSides() {
  const temp = mediaCompareState.leftPath;
  mediaCompareState.leftPath = mediaCompareState.rightPath;
  mediaCompareState.rightPath = temp;
  openMediaCompare(mediaCompareState.leftPath, mediaCompareState.rightPath);
}
function reloadMediaCompare() {
  loadMediaCompare(mediaCompareState.leftPath, mediaCompareState.rightPath);
}
function closeMediaTab(event) {
  if (event) event.stopPropagation();
  const b = document.getElementById('tabMediaBtn');
  if (b) b.style.display = 'none';
  switchToRemainingTabOrHome();
}

// --- TABLE COMPARE MULTI-SHEET ENGINE (Beyond Compare 5) ---
let tableCompareState = {
  leftPath: '',
  rightPath: '',
  leftData: null,
  rightData: null,
  activeSheet: '',
  delimiter: 'auto',
  diffRows: [],
  currentDiffIdx: -1
};

async function openTableCompare(left = '', right = '', title = 'Table Compare') {
  tableCompareState.leftPath = left || '';
  tableCompareState.rightPath = right || '';

  const inL = document.getElementById('tblLeftPathInput');
  const inR = document.getElementById('tblRightPathInput');
  if (inL) inL.value = left || '';
  if (inR) inR.value = right || '';

  const tabTitle = document.getElementById('currentTableTabTitle');
  if (tabTitle) {
    const clean = (title || 'Table Compare').replace(/^New\s+/, '').replace(/\s*-\s*Table Compare$/, '');
    tabTitle.textContent = clean || 'Table Compare';
  }

  const tabBtn = document.getElementById('tabTableBtn');
  if (tabBtn) tabBtn.style.display = 'flex';

  switchView('table');

  if (left || right) {
    if (left && right) {
      window.api.recordAutoSavedSession({
        type: 'table_compare',
        name: title !== 'Table Compare' ? title : undefined,
        leftPath: left,
        rightPath: right
      }).then(() => reloadSessions()).catch(() => {});
    }
    loadTableCompare(left, right);
  } else {
    renderEmptyTableCompare();
  }
}

function renderEmptyTableCompare() {
  const cL = document.getElementById('tblLeftContent');
  const cR = document.getElementById('tblRightContent');
  if (cL) cL.innerHTML = `<div class="text-empty-dropzone" onclick="browseTableFile('left')"><div class="dropzone-icon">📊</div><div>Drop Excel or CSV/TSV table here, or click 📁▾</div></div>`;
  if (cR) cR.innerHTML = `<div class="text-empty-dropzone" onclick="browseTableFile('right')"><div class="dropzone-icon">📊</div><div>Drop Excel or CSV/TSV table here, or click 📁▾</div></div>`;
  const bar = document.getElementById('tableSheetsList');
  if (bar) bar.innerHTML = `<button class="table-sheet-tab active">Sheet 1</button>`;
}

async function loadTableCompare(leftPath, rightPath) {
  tableCompareState.leftPath = leftPath;
  tableCompareState.rightPath = rightPath;

  let leftRes = null, rightRes = null;
  if (leftPath) leftRes = await window.api.readTableFile(leftPath);
  if (rightPath) rightRes = await window.api.readTableFile(rightPath);

  tableCompareState.leftData = leftRes && leftRes.success ? leftRes : null;
  tableCompareState.rightData = rightRes && rightRes.success ? rightRes : null;

  const allSheets = new Set([
    ...(leftRes?.sheetNames || []),
    ...(rightRes?.sheetNames || [])
  ]);
  const sheetList = Array.from(allSheets);
  if (sheetList.length === 0) sheetList.push('Sheet 1');

  tableCompareState.activeSheet = sheetList[0];
  renderTableSheetTabs(sheetList);
  renderActiveTableSheet();
}

async function loadTableFileForSide(side, filePath) {
  if (!filePath) return;
  if (side === 'left') {
    tableCompareState.leftPath = filePath;
    const inp = document.getElementById('tblLeftPathInput');
    if (inp) inp.value = filePath;
  } else {
    tableCompareState.rightPath = filePath;
    const inp = document.getElementById('tblRightPathInput');
    if (inp) inp.value = filePath;
  }
  await loadTableCompare(tableCompareState.leftPath, tableCompareState.rightPath);
}

function renderTableSheetTabs(sheetNames) {
  const listEl = document.getElementById('tableSheetsList');
  if (!listEl) return;
  listEl.innerHTML = sheetNames.map((name) => `
    <button class="table-sheet-tab ${name === tableCompareState.activeSheet ? 'active' : ''}" onclick="switchTableSheet('${escapeHtml(name)}')">
      <span>${escapeHtml(name)}</span>
    </button>
  `).join('');
}

function switchTableSheet(name) {
  tableCompareState.activeSheet = name;
  document.querySelectorAll('.table-sheet-tab').forEach(el => {
    el.classList.toggle('active', el.textContent.trim() === name);
  });
  renderActiveTableSheet();
}

function renderActiveTableSheet() {
  const sName = tableCompareState.activeSheet;
  const leftRows = (tableCompareState.leftData?.sheets && tableCompareState.leftData.sheets[sName]) || [];
  const rightRows = (tableCompareState.rightData?.sheets && tableCompareState.rightData.sheets[sName]) || [];

  const maxRows = Math.max(leftRows.length, rightRows.length);
  const diffRowIndices = [];

  let htmlL = '<table class="table-grid">', htmlR = '<table class="table-grid">';

  for (let r = 0; r < maxRows; r++) {
    const rowL = leftRows[r] || [];
    const rowR = rightRows[r] || [];
    const maxCols = Math.max(rowL.length, rowR.length);
    let rowHasDiff = false;

    let cellsL = '', cellsR = '';
    for (let c = 0; c < maxCols; c++) {
      const valL = rowL[c] !== undefined ? String(rowL[c]) : '';
      const valR = rowR[c] !== undefined ? String(rowR[c]) : '';
      const isDiff = !!(tableCompareState.leftPath && tableCompareState.rightPath) && (valL !== valR);
      if (isDiff) rowHasDiff = true;

      const tag = r === 0 ? 'th' : 'td';
      cellsL += `<${tag} class="${isDiff ? 'table-cell-diff' : ''}">${escapeHtml(valL)}</${tag}>`;
      cellsR += `<${tag} class="${isDiff ? 'table-cell-diff' : ''}">${escapeHtml(valR)}</${tag}>`;
    }

    if (rowHasDiff && r > 0) diffRowIndices.push(r);

    htmlL += `<tr class="${rowHasDiff ? 'diff-row' : ''}">${cellsL}</tr>`;
    htmlR += `<tr class="${rowHasDiff ? 'diff-row' : ''}">${cellsR}</tr>`;
  }

  htmlL += '</table>';
  htmlR += '</table>';

  const cL = document.getElementById('tblLeftContent');
  const cR = document.getElementById('tblRightContent');
  if (cL) {
    if (tableCompareState.leftPath) {
      cL.innerHTML = htmlL;
    } else {
      cL.innerHTML = `<div class="text-empty-dropzone" onclick="browseTableFile('left')"><div class="dropzone-icon">📊</div><div>Drop Excel or CSV/TSV table here, or click 📁▾</div></div>`;
    }
  }
  if (cR) {
    if (tableCompareState.rightPath) {
      cR.innerHTML = htmlR;
    } else {
      cR.innerHTML = `<div class="text-empty-dropzone" onclick="browseTableFile('right')"><div class="dropzone-icon">📊</div><div>Drop Excel or CSV/TSV table here, or click 📁▾</div></div>`;
    }
  }

  tableCompareState.diffRows = diffRowIndices;
  const badge = document.getElementById('tableDiffBadge');
  if (badge) {
    badge.textContent = `${diffRowIndices.length} row difference(s) in "${sName}"`;
    badge.style.background = diffRowIndices.length > 0 ? 'rgba(248, 81, 73, 0.2)' : 'rgba(74, 222, 128, 0.2)';
    badge.style.color = diffRowIndices.length > 0 ? '#ff7b72' : '#4ade80';
  }
}

let isSyncingTable = false;
function syncTableScroll(side) {
  if (isSyncingTable) return;
  isSyncingTable = true;
  const sL = document.getElementById('tblLeftScroll');
  const sR = document.getElementById('tblRightScroll');
  const src = side === 'left' ? sL : sR;
  const target = side === 'left' ? sR : sL;
  if (src && target) {
    target.scrollTop = src.scrollTop;
    target.scrollLeft = src.scrollLeft;
  }
  setTimeout(() => { isSyncingTable = false; }, 20);
}

function navTableDiff(dir) {
  const diffs = tableCompareState.diffRows;
  if (!diffs || diffs.length === 0) {
    showToast('No differences found in this sheet', 'info');
    return;
  }
  tableCompareState.currentDiffIdx = (tableCompareState.currentDiffIdx + dir + diffs.length) % diffs.length;
  const targetRow = diffs[tableCompareState.currentDiffIdx];
  const sL = document.getElementById('tblLeftScroll');
  if (sL) sL.scrollTop = (targetRow - 1) * 26;
  showToast(`Row difference ${tableCompareState.currentDiffIdx + 1} of ${diffs.length}`, 'info');
}

function handleTableDelimiterChange(val) {
  tableCompareState.delimiter = val;
  if (tableCompareState.leftPath || tableCompareState.rightPath) {
    loadTableCompare(tableCompareState.leftPath, tableCompareState.rightPath);
  }
}

async function browseTableFile(side) {
  const selected = await window.api.selectFile('');
  if (selected) {
    const input = document.getElementById(side === 'left' ? 'tblLeftPathInput' : 'tblRightPathInput');
    if (input) input.value = selected;
    if (side === 'left') tableCompareState.leftPath = selected;
    else tableCompareState.rightPath = selected;
    loadTableCompare(tableCompareState.leftPath, tableCompareState.rightPath);
  }
}

function handleTablePathKeydown(event, side) {
  if (event.key === 'Enter') handleTablePathBlur(side);
}
function handleTablePathBlur(side) {
  const inEl = document.getElementById(side === 'left' ? 'tblLeftPathInput' : 'tblRightPathInput');
  if (inEl && inEl.value.trim()) {
    if (side === 'left') tableCompareState.leftPath = inEl.value.trim();
    else tableCompareState.rightPath = inEl.value.trim();
    loadTableCompare(tableCompareState.leftPath, tableCompareState.rightPath);
  }
}
function swapTableSides() {
  const temp = tableCompareState.leftPath;
  tableCompareState.leftPath = tableCompareState.rightPath;
  tableCompareState.rightPath = temp;
  openTableCompare(tableCompareState.leftPath, tableCompareState.rightPath);
}
function reloadTableCompare() {
  loadTableCompare(tableCompareState.leftPath, tableCompareState.rightPath);
}
function closeTableTab(event) {
  if (event) event.stopPropagation();
  const b = document.getElementById('tabTableBtn');
  if (b) b.style.display = 'none';
  switchToRemainingTabOrHome();
}

// --- FOLDER SYNC ENGINE (Beyond Compare 5) ---
let folderSyncState = {
  leftPath: '',
  rightPath: '',
  preset: 'update_lr',
  plan: []
};

function openFolderSync(left = '', right = '', title = 'Folder Sync') {
  folderSyncState.leftPath = left || '';
  folderSyncState.rightPath = right || '';

  const inL = document.getElementById('syncLeftPathInput');
  const inR = document.getElementById('syncRightPathInput');
  if (inL) inL.value = left || '';
  if (inR) inR.value = right || '';

  const tabTitle = document.getElementById('currentFolderSyncTabTitle');
  if (tabTitle) {
    const clean = (title || 'Folder Sync').replace(/^New\s+/, '').replace(/\s*-\s*Folder Sync$/, '');
    tabTitle.textContent = clean || 'Folder Sync';
  }

  const tabBtn = document.getElementById('tabFolderSyncBtn');
  if (tabBtn) tabBtn.style.display = 'flex';

  switchView('foldersync');

  if (left && right) {
    window.api.recordAutoSavedSession({
      type: 'folder_sync',
      name: title !== 'Folder Sync' ? title : undefined,
      leftPath: left,
      rightPath: right
    }).then(() => reloadSessions()).catch(() => {});
    computeFolderSyncPlan();
  } else {
    renderEmptyFolderSync();
  }
}

function closeFolderSyncTab(event) {
  if (event) event.stopPropagation();
  const b = document.getElementById('tabFolderSyncBtn');
  if (b) b.style.display = 'none';
  switchToRemainingTabOrHome();
}

function setSyncPreset(preset) {
  folderSyncState.preset = preset;
  const ids = {
    'update_lr': 'btnSyncUpdateLR',
    'update_rl': 'btnSyncUpdateRL',
    'update_both': 'btnSyncUpdateBoth',
    'mirror_r': 'btnSyncMirrorR',
    'mirror_l': 'btnSyncMirrorL'
  };
  Object.values(ids).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  const cur = document.getElementById(ids[preset]);
  if (cur) cur.classList.add('active');
  computeFolderSyncPlan();
}

async function computeFolderSyncPlan() {
  const left = (document.getElementById('syncLeftPathInput')?.value || folderSyncState.leftPath || '').trim();
  const right = (document.getElementById('syncRightPathInput')?.value || folderSyncState.rightPath || '').trim();
  folderSyncState.leftPath = left;
  folderSyncState.rightPath = right;

  if (!left || !right) {
    renderEmptyFolderSync();
    return;
  }

  const res = await window.api.compareFolders(left, right);
  if (!res.success) {
    showToast(`Error comparing folders: ${res.error}`, 'error');
    return;
  }

  const items = res.items || [];
  const plan = [];
  const preset = folderSyncState.preset;

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.isDirectory) continue;

    let action = 'leave';
    const leftTime = it.left && it.left.modified ? new Date(it.left.modified).getTime() : 0;
    const rightTime = it.right && it.right.modified ? new Date(it.right.modified).getTime() : 0;
    const isLeftNewer = leftTime > rightTime + 2000;
    const isRightNewer = rightTime > leftTime + 2000;

    if (preset === 'update_lr') {
      if (it.status === 'orphan_left' || (it.status === 'different' && isLeftNewer)) {
        action = 'copy_to_right';
      }
    } else if (preset === 'update_rl') {
      if (it.status === 'orphan_right' || (it.status === 'different' && isRightNewer)) {
        action = 'copy_to_left';
      }
    } else if (preset === 'update_both') {
      if (it.status === 'orphan_left' || (it.status === 'different' && isLeftNewer)) {
        action = 'copy_to_right';
      } else if (it.status === 'orphan_right' || (it.status === 'different' && isRightNewer)) {
        action = 'copy_to_left';
      }
    } else if (preset === 'mirror_r') {
      if (it.status === 'orphan_left' || it.status === 'different') {
        action = 'copy_to_right';
      } else if (it.status === 'orphan_right') {
        action = 'delete_right';
      }
    } else if (preset === 'mirror_l') {
      if (it.status === 'orphan_right' || it.status === 'different') {
        action = 'copy_to_left';
      } else if (it.status === 'orphan_left') {
        action = 'delete_left';
      }
    }

    plan.push({
      item: it,
      action: action,
      srcPath: (action === 'copy_to_right') ? (it.left?.fullPath) : (action === 'copy_to_left' ? it.right?.fullPath : ''),
      destPath: (action === 'copy_to_right') ? (right + '/' + it.relativePath) : (action === 'copy_to_left' ? left + '/' + it.relativePath : ''),
      targetPath: (action === 'delete_right') ? (it.right?.fullPath) : (action === 'delete_left' ? it.left?.fullPath : '')
    });
  }

  folderSyncState.plan = plan;
  renderFolderSyncPlan();
}

function renderEmptyFolderSync() {
  const tbody = document.getElementById('folderSyncTableBody');
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #888; padding: 40px;">Select Left (Source) and Right (Target) folders to preview sync actions</td></tr>`;
  }
  const summary = document.getElementById('syncStatusSummary');
  if (summary) summary.textContent = '0 actions planned';
}

function renderFolderSyncPlan() {
  const tbody = document.getElementById('folderSyncTableBody');
  if (!tbody) return;

  const plan = folderSyncState.plan;
  let copyR = 0, copyL = 0, delR = 0, delL = 0, same = 0;

  let html = '';
  for (let i = 0; i < plan.length; i++) {
    const p = plan[i];
    const it = p.item;

    let badgeClass = 'sync-action-leave';
    let badgeText = '═ Leave Alone';

    if (p.action === 'copy_to_right') {
      badgeClass = 'sync-action-copy-right';
      badgeText = '➡️ Copy to Right';
      copyR++;
    } else if (p.action === 'copy_to_left') {
      badgeClass = 'sync-action-copy-left';
      badgeText = '⬅️ Copy to Left';
      copyL++;
    } else if (p.action === 'delete_right') {
      badgeClass = 'sync-action-delete';
      badgeText = '🗑️ Delete Right';
      delR++;
    } else if (p.action === 'delete_left') {
      badgeClass = 'sync-action-delete';
      badgeText = '🗑️ Delete Left';
      delL++;
    } else {
      same++;
    }

    const rowClass = i % 2 === 0 ? 'even' : 'odd';
    html += `
      <tr class="diff-row ${rowClass}">
        <td>${it.left ? escapeHtml(it.left.name) : '<span style="color:#666;">(none)</span>'}</td>
        <td style="text-align:right;">${it.left ? formatBytes(it.left.size) : ''}</td>
        <td class="sync-action-cell" onclick="cycleSyncAction(${i})">
          <span class="sync-action-badge ${badgeClass}">${badgeText}</span>
        </td>
        <td style="text-align:right;">${it.right ? formatBytes(it.right.size) : ''}</td>
        <td>${it.right ? escapeHtml(it.right.name) : '<span style="color:#666;">(none)</span>'}</td>
      </tr>
    `;
  }

  tbody.innerHTML = html || `<tr><td colspan="5" style="text-align:center; padding: 20px; color: #888;">No files found</td></tr>`;

  const totalActions = copyR + copyL + delR + delL;
  const summary = document.getElementById('syncStatusSummary');
  if (summary) {
    summary.textContent = `${totalActions} action(s) planned (${copyR} to right, ${copyL} to left, ${delR + delL} delete, ${same} unchanged)`;
  }
}

function cycleSyncAction(index) {
  const p = folderSyncState.plan[index];
  if (!p) return;
  const cycle = ['copy_to_right', 'copy_to_left', 'delete_right', 'delete_left', 'leave'];
  const curIdx = cycle.indexOf(p.action);
  p.action = cycle[(curIdx + 1) % cycle.length];
  renderFolderSyncPlan();
}

async function executeSyncPlan() {
  const plan = folderSyncState.plan.filter(p => p.action !== 'leave');
  if (plan.length === 0) {
    showToast('No actions to synchronize', 'info');
    return;
  }

  if (!confirm(`Are you sure you want to execute ${plan.length} synchronization action(s)?`)) return;

  showToast(`Running sync: ${plan.length} item(s)...`, 'info');
  const tasks = plan.map(p => ({
    action: p.action,
    relPath: p.item.relativePath,
    srcPath: p.srcPath,
    destPath: p.destPath,
    targetPath: p.targetPath
  }));

  const res = await window.api.executeFolderSync(tasks);
  if (res.success) {
    showToast(`Sync complete! Copied: ${res.copied}, Deleted: ${res.deleted}`, 'success');
  } else {
    showToast(`Sync finished with errors: ${res.errors.join(', ')}`, 'error');
  }

  computeFolderSyncPlan();
}

async function browseSyncFolder(side) {
  const cur = side === 'left' ? folderSyncState.leftPath : folderSyncState.rightPath;
  const selected = await window.api.selectFolder(cur || '');
  if (selected) {
    if (side === 'left') folderSyncState.leftPath = selected;
    else folderSyncState.rightPath = selected;
    const input = document.getElementById(side === 'left' ? 'syncLeftPathInput' : 'syncRightPathInput');
    if (input) input.value = selected;
    computeFolderSyncPlan();
  }
}

function handleSyncPathKeydown(event, side) {
  if (event.key === 'Enter') handleSyncPathBlur(side);
}
function handleSyncPathBlur(side) {
  const inEl = document.getElementById(side === 'left' ? 'syncLeftPathInput' : 'syncRightPathInput');
  if (inEl && inEl.value.trim()) {
    if (side === 'left') folderSyncState.leftPath = inEl.value.trim();
    else folderSyncState.rightPath = inEl.value.trim();
    computeFolderSyncPlan();
  }
}
function swapSyncSides() {
  const temp = folderSyncState.leftPath;
  folderSyncState.leftPath = folderSyncState.rightPath;
  folderSyncState.rightPath = temp;
  openFolderSync(folderSyncState.leftPath, folderSyncState.rightPath);
}

// --- 3-WAY FOLDER MERGE ENGINE (Beyond Compare 5) ---
let folderMergeState = {
  leftPath: '',
  basePath: '',
  rightPath: '',
  filter: 'all',
  items: []
};

function openFolderMerge(left = '', base = '', right = '', title = 'Folder Merge') {
  folderMergeState.leftPath = left || '';
  folderMergeState.basePath = base || '';
  folderMergeState.rightPath = right || '';

  const inL = document.getElementById('fMergeLeftPathInput');
  const inB = document.getElementById('fMergeBasePathInput');
  const inR = document.getElementById('fMergeRightPathInput');
  if (inL) inL.value = left || '';
  if (inB) inB.value = base || '';
  if (inR) inR.value = right || '';

  const tabTitle = document.getElementById('currentFolderMergeTabTitle');
  if (tabTitle) {
    const clean = (title || 'Folder Merge').replace(/^New\s+/, '').replace(/\s*-\s*Folder Merge$/, '');
    tabTitle.textContent = clean || 'Folder Merge';
  }

  const tabBtn = document.getElementById('tabFolderMergeBtn');
  if (tabBtn) tabBtn.style.display = 'flex';

  switchView('foldermerge');

  if (left && right) {
    window.api.recordAutoSavedSession({
      type: 'folder_merge',
      name: title !== 'Folder Merge' ? title : undefined,
      leftPath: left,
      rightPath: right
    }).then(() => reloadSessions()).catch(() => {});
    runFolderMergeComparison();
  } else {
    renderEmptyFolderMerge();
  }
}

function closeFolderMergeTab(event) {
  if (event) event.stopPropagation();
  const b = document.getElementById('tabFolderMergeBtn');
  if (b) b.style.display = 'none';
  switchToRemainingTabOrHome();
}

async function runFolderMergeComparison() {
  const left = (document.getElementById('fMergeLeftPathInput')?.value || folderMergeState.leftPath || '').trim();
  const base = (document.getElementById('fMergeBasePathInput')?.value || folderMergeState.basePath || '').trim();
  const right = (document.getElementById('fMergeRightPathInput')?.value || folderMergeState.rightPath || '').trim();

  folderMergeState.leftPath = left;
  folderMergeState.basePath = base;
  folderMergeState.rightPath = right;

  if (!left || !right) {
    renderEmptyFolderMerge();
    return;
  }

  const items = await window.api.compareFolderMergeTrees(left, base, right);
  folderMergeState.items = items || [];
  renderFolderMergeItems();
}

async function loadFolderMergeForSide(pos, folderPath) {
  if (!folderPath) return;
  if (pos === 'left') {
    folderMergeState.leftPath = folderPath;
    const inp = document.getElementById('fMergeLeftPathInput');
    if (inp) inp.value = folderPath;
  } else if (pos === 'base' || pos === 'center') {
    folderMergeState.basePath = folderPath;
    const inp = document.getElementById('fMergeBasePathInput');
    if (inp) inp.value = folderPath;
  } else if (pos === 'right') {
    folderMergeState.rightPath = folderPath;
    const inp = document.getElementById('fMergeRightPathInput');
    if (inp) inp.value = folderPath;
  }
  await runFolderMergeComparison();
}

function renderEmptyFolderMerge() {
  const tbody = document.getElementById('folderMergeTableBody');
  if (!tbody) return;

  const left = (document.getElementById('fMergeLeftPathInput')?.value || folderMergeState.leftPath || '').trim();
  const base = (document.getElementById('fMergeBasePathInput')?.value || folderMergeState.basePath || '').trim();
  const right = (document.getElementById('fMergeRightPathInput')?.value || folderMergeState.rightPath || '').trim();

  if (left || base || right) {
    const parts = [];
    if (left) parts.push(`<div style="display:inline-block; margin: 3px 8px;"><span style="color:#58a6ff; font-weight:600;">Left (Theirs):</span> <code style="background:rgba(255,255,255,0.08); padding:2px 8px; border-radius:4px;">${escapeHtml(left)}</code></div>`);
    if (base) parts.push(`<div style="display:inline-block; margin: 3px 8px;"><span style="color:#d29922; font-weight:600;">Center (Base):</span> <code style="background:rgba(255,255,255,0.08); padding:2px 8px; border-radius:4px;">${escapeHtml(base)}</code></div>`);
    if (right) parts.push(`<div style="display:inline-block; margin: 3px 8px;"><span style="color:#56d364; font-weight:600;">Right (Mine):</span> <code style="background:rgba(255,255,255,0.08); padding:2px 8px; border-radius:4px;">${escapeHtml(right)}</code></div>`);

    let hint = '';
    if (!left) hint += '<div style="color:#aaa; font-size:12px; margin-top:8px;">Drop or select the <b>Left folder (Theirs)</b> to complete 3-way merge</div>';
    if (!right) hint += '<div style="color:#aaa; font-size:12px; margin-top:8px;">Drop or select the <b>Right folder (Mine)</b> to complete 3-way merge</div>';

    tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #ccc; padding: 40px; line-height: 1.6;">${parts.join('')}${hint}</td></tr>`;
  } else {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #888; padding: 40px;">Select or drop Left (Theirs), Center (Base Ancestor), and Right (Mine) folders to compare</td></tr>`;
  }
}

function setFolderMergeFilter(f) {
  folderMergeState.filter = f;
  ['fMergeFilterAll', 'fMergeFilterConflicts', 'fMergeFilterChanges'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  const cur = document.getElementById(f === 'conflicts' ? 'fMergeFilterConflicts' : (f === 'changes' ? 'fMergeFilterChanges' : 'fMergeFilterAll'));
  if (cur) cur.classList.add('active');
  renderFolderMergeItems();
}

function renderFolderMergeItems() {
  const tbody = document.getElementById('folderMergeTableBody');
  if (!tbody) return;

  const f = folderMergeState.filter;
  const filtered = (folderMergeState.items || []).filter(it => {
    if (f === 'conflicts') return it.status === 'conflict';
    if (f === 'changes') return it.status === 'left_change' || it.status === 'right_change' || it.status === 'conflict';
    return true;
  });

  let html = '';
  for (let i = 0; i < filtered.length; i++) {
    const it = filtered[i];
    let statusBadge = '<span style="color:#888;">Same</span>';
    if (it.status === 'conflict') statusBadge = '<span style="color:#ff5555;font-weight:700;">⚠️ Conflict</span>';
    else if (it.status === 'left_change') statusBadge = '<span style="color:#4daafc;">Left Change</span>';
    else if (it.status === 'right_change') statusBadge = '<span style="color:#56d364;">Right Change</span>';
    else if (it.status === 'orphan_left') statusBadge = '<span style="color:#4daafc;">Left Orphan</span>';
    else if (it.status === 'orphan_right') statusBadge = '<span style="color:#56d364;">Right Orphan</span>';

    const rowClass = i % 2 === 0 ? 'even' : 'odd';
    html += `
      <tr class="diff-row ${rowClass}">
        <td>${it.left ? escapeHtml(it.left.name) : '<span style="color:#666;">-</span>'}</td>
        <td>${it.base ? escapeHtml(it.base.name) : '<span style="color:#666;">-</span>'}</td>
        <td>${it.right ? escapeHtml(it.right.name) : '<span style="color:#666;">-</span>'}</td>
        <td style="text-align:center;">${statusBadge}</td>
      </tr>
    `;
  }

  tbody.innerHTML = html || `<tr><td colspan="4" style="text-align:center; padding: 20px; color: #888;">No items match filter</td></tr>`;
}

async function browseFMergeFolder(side) {
  const selected = await window.api.selectFolder('');
  if (selected) {
    if (side === 'left') folderMergeState.leftPath = selected;
    else if (side === 'base') folderMergeState.basePath = selected;
    else folderMergeState.rightPath = selected;

    const inEl = document.getElementById(side === 'left' ? 'fMergeLeftPathInput' : (side === 'base' ? 'fMergeBasePathInput' : 'fMergeRightPathInput'));
    if (inEl) inEl.value = selected;
    runFolderMergeComparison();
  }
}
function handleFMergePathKeydown(event, side) {
  if (event.key === 'Enter') runFolderMergeComparison();
}

// --- 3-WAY TEXT MERGE ENGINE (Beyond Compare 5) ---
let textMergeState = {
  leftPath: '',
  basePath: '',
  rightPath: '',
  outputPath: '',
  mergeData: null,
  currentConflictIdx: 0
};

function openTextMerge(left = '', base = '', right = '', title = 'Text Merge') {
  textMergeState.leftPath = left || '';
  textMergeState.basePath = base || '';
  textMergeState.rightPath = right || '';

  const inL = document.getElementById('tMergeLeftPathInput');
  const inB = document.getElementById('tMergeBasePathInput');
  const inR = document.getElementById('tMergeRightPathInput');
  if (inL) inL.value = left || '';
  if (inB) inB.value = base || '';
  if (inR) inR.value = right || '';

  const tabTitle = document.getElementById('currentTextMergeTabTitle');
  if (tabTitle) {
    const clean = (title || 'Text Merge').replace(/^New\s+/, '').replace(/\s*-\s*Text Merge$/, '');
    tabTitle.textContent = clean || 'Text Merge';
  }

  const tabBtn = document.getElementById('tabTextMergeBtn');
  if (tabBtn) tabBtn.style.display = 'flex';

  switchView('textmerge');

  if (left && right) {
    window.api.recordAutoSavedSession({
      type: 'text_merge',
      name: title !== 'Text Merge' ? title : undefined,
      leftPath: left,
      rightPath: right
    }).then(() => reloadSessions()).catch(() => {});
    runThreeWayTextMerge();
  } else {
    renderEmptyTextMerge();
  }
}

async function loadTMergeFileForSide(pos, filePath) {
  if (!filePath) return;
  if (pos === 'left') {
    textMergeState.leftPath = filePath;
    const inp = document.getElementById('tMergeLeftPathInput');
    if (inp) inp.value = filePath;
  } else if (pos === 'base' || pos === 'center') {
    textMergeState.basePath = filePath;
    const inp = document.getElementById('tMergeBasePathInput');
    if (inp) inp.value = filePath;
  } else if (pos === 'right') {
    textMergeState.rightPath = filePath;
    const inp = document.getElementById('tMergeRightPathInput');
    if (inp) inp.value = filePath;
  }
  await runThreeWayTextMerge();
}

function closeTextMergeTab(event) {
  if (event) event.stopPropagation();
  const b = document.getElementById('tabTextMergeBtn');
  if (b) b.style.display = 'none';
  switchToRemainingTabOrHome();
}

function renderEmptyTextMerge() {
  ['tMergeLeftLines', 'tMergeBaseLines', 'tMergeRightLines'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `<div class="text-empty-dropzone"><div class="dropzone-icon">📑</div><div>Select file or drop here</div></div>`;
  });
  const out = document.getElementById('tMergeOutputEditor');
  if (out) out.value = '';
}

function renderPartialThreeWayTextMerge(left, tL, base, tB, right, tR) {
  const renderLines = (text) => {
    const lines = (text || '').split(/\r\n|\r|\n/);
    let html = '';
    for (let i = 0; i < lines.length; i++) {
      html += `<div class="text-line-row"><span class="text-line-num">${i + 1}</span><span class="text-line-content">${escapeHtml(lines[i])}</span></div>`;
    }
    return html;
  };

  const dL = document.getElementById('tMergeLeftLines');
  const dB = document.getElementById('tMergeBaseLines');
  const dR = document.getElementById('tMergeRightLines');

  if (dL) dL.innerHTML = left ? renderLines(tL) : `<div class="text-empty-dropzone"><div class="dropzone-icon">📑</div><div>Select file or drop here</div></div>`;
  if (dB) dB.innerHTML = base ? renderLines(tB) : `<div class="text-empty-dropzone"><div class="dropzone-icon">📑</div><div>Select file or drop here</div></div>`;
  if (dR) dR.innerHTML = right ? renderLines(tR) : `<div class="text-empty-dropzone"><div class="dropzone-icon">📑</div><div>Select file or drop here</div></div>`;

  const out = document.getElementById('tMergeOutputEditor');
  if (out) out.value = '';
  const badge = document.getElementById('mergeConflictBadge');
  if (badge) badge.style.display = 'none';
}

async function runThreeWayTextMerge() {
  const left = (document.getElementById('tMergeLeftPathInput')?.value || textMergeState.leftPath || '').trim();
  const base = (document.getElementById('tMergeBasePathInput')?.value || textMergeState.basePath || '').trim();
  const right = (document.getElementById('tMergeRightPathInput')?.value || textMergeState.rightPath || '').trim();

  let tL = '', tB = '', tR = '';
  if (left) {
    const r = await window.api.readTextFile(left);
    if (r.success) tL = r.content;
  }
  if (base) {
    const r = await window.api.readTextFile(base);
    if (r.success) tB = r.content;
  }
  if (right) {
    const r = await window.api.readTextFile(right);
    if (r.success) tR = r.content;
  }

  if (!left || !right) {
    renderPartialThreeWayTextMerge(left, tL, base, tB, right, tR);
    return;
  }

  const res = await window.api.computeThreeWayTextMerge(tL, tB, tR);
  textMergeState.mergeData = res;

  renderThreeWayPanes(res.rows);

  const outEditor = document.getElementById('tMergeOutputEditor');
  if (outEditor) outEditor.value = res.initialOutputText;

  const badge = document.getElementById('mergeConflictBadge');
  if (badge) {
    badge.textContent = `${res.conflictCount} Conflict(s)`;
    badge.style.display = res.conflictCount > 0 ? 'inline-block' : 'none';
  }
}

function renderThreeWayPanes(rows) {
  let leftHtml = '', baseHtml = '', rightHtml = '';
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const isConflict = r.status === 'conflict';
    const rowClass = isConflict ? 'text-line-row conflict-block' : 'text-line-row';

    leftHtml += `<div class="${rowClass}"><span class="text-line-num">${r.leftNum || ''}</span><span class="text-line-content">${escapeHtml(r.leftText || '')}</span></div>`;
    baseHtml += `<div class="${rowClass}"><span class="text-line-num">${r.baseNum || ''}</span><span class="text-line-content">${escapeHtml(r.baseText || '')}</span></div>`;
    rightHtml += `<div class="${rowClass}"><span class="text-line-num">${r.rightNum || ''}</span><span class="text-line-content">${escapeHtml(r.rightText || '')}</span></div>`;
  }

  const dL = document.getElementById('tMergeLeftLines');
  const dB = document.getElementById('tMergeBaseLines');
  const dR = document.getElementById('tMergeRightLines');
  if (dL) dL.innerHTML = leftHtml;
  if (dB) dB.innerHTML = baseHtml;
  if (dR) dR.innerHTML = rightHtml;
}

let isSyncingThreeWay = false;
function syncThreeWayScroll(source) {
  if (isSyncingThreeWay) return;
  isSyncingThreeWay = true;
  const sL = document.getElementById('tMergeLeftScroll');
  const sB = document.getElementById('tMergeCenterScroll');
  const sR = document.getElementById('tMergeRightScroll');

  const src = source === 'left' ? sL : (source === 'base' ? sB : sR);
  if (src) {
    if (sL && sL !== src) sL.scrollTop = src.scrollTop;
    if (sB && sB !== src) sB.scrollTop = src.scrollTop;
    if (sR && sR !== src) sR.scrollTop = src.scrollTop;
  }
  setTimeout(() => { isSyncingThreeWay = false; }, 20);
}

function navMergeConflict(direction) {
  const data = textMergeState.mergeData;
  if (!data || !data.conflicts || data.conflicts.length === 0) {
    showToast('No conflicts found', 'info');
    return;
  }
  textMergeState.currentConflictIdx = (textMergeState.currentConflictIdx + direction + data.conflicts.length) % data.conflicts.length;
  const c = data.conflicts[textMergeState.currentConflictIdx];
  showToast(`Jumped to Conflict ${textMergeState.currentConflictIdx + 1} of ${data.conflicts.length}`, 'info');

  const sL = document.getElementById('tMergeLeftScroll');
  if (sL) sL.scrollTop = c.rowIndex * 20;
}

function takeMergeSelection(choice) {
  const data = textMergeState.mergeData;
  if (!data || !data.conflicts || data.conflicts.length === 0) return;
  const c = data.conflicts[textMergeState.currentConflictIdx];
  const outEditor = document.getElementById('tMergeOutputEditor');
  if (!outEditor) return;

  let chosenText = c.leftText;
  if (choice === 'base') chosenText = c.baseText;
  else if (choice === 'right') chosenText = c.rightText;
  else if (choice === 'both') chosenText = `${c.leftText}\n${c.rightText}`;

  const targetPattern = `<<<<<<< Left (Theirs)\n${c.leftText}\n=======\n${c.rightText}\n>>>>>>> Right (Mine)`;
  if (outEditor.value.includes(targetPattern)) {
    outEditor.value = outEditor.value.replace(targetPattern, chosenText);
    showToast(`Conflict resolved using: ${choice.toUpperCase()}`, 'success');
  }
}

async function saveMergedOutputFile() {
  const outPath = document.getElementById('tMergeOutputPathInput')?.value.trim();
  if (!outPath) {
    const selected = await window.api.selectFile('');
    if (selected) {
      document.getElementById('tMergeOutputPathInput').value = selected;
      saveMergedOutputFile();
    }
    return;
  }
  const content = document.getElementById('tMergeOutputEditor')?.value || '';
  const res = await window.api.writeTextFile(outPath, content);
  if (res.success) {
    showToast(`Saved merged output: ${outPath}`, 'success');
  } else {
    showToast(`Failed to save: ${res.error}`, 'error');
  }
}

async function browseTMergeFile(side) {
  const selected = await window.api.selectFile('');
  if (selected) {
    const inEl = document.getElementById(side === 'left' ? 'tMergeLeftPathInput' : (side === 'base' ? 'tMergeBasePathInput' : 'tMergeRightPathInput'));
    if (inEl) inEl.value = selected;
    runThreeWayTextMerge();
  }
}
function handleTMergePathKeydown(event, side) {
  if (event.key === 'Enter') runThreeWayTextMerge();
}
async function browseTMergeOutputFile() {
  const selected = await window.api.selectFile('');
  if (selected) {
    const inEl = document.getElementById('tMergeOutputPathInput');
    if (inEl) inEl.value = selected;
  }
}
function toggleMergeCenterPane() {
  const pane = document.getElementById('tMergeCenterPane');
  if (!pane) return;
  const isHidden = pane.style.display === 'none';
  pane.style.display = isHidden ? 'flex' : 'none';
  const btn = document.getElementById('btnToggleMergeCenter');
  if (btn) btn.classList.toggle('active', isHidden);
}
function toggleMergeWordWrap() {
  ['tMergeLeftScroll', 'tMergeCenterScroll', 'tMergeRightScroll'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('word-wrap-enabled');
  });
}

// --- TEXT EDIT ENGINE (Beyond Compare 5) ---
let textEditState = {
  filePath: '',
  isDirty: false
};

async function openTextEdit(filePath = '', title = 'Text Edit') {
  textEditState.filePath = filePath || '';
  const tabTitle = document.getElementById('currentTextEditTabTitle');
  if (tabTitle) {
    const basename = filePath ? filePath.split(/[\\/]/).pop() : (title || 'Text Edit');
    tabTitle.textContent = (basename || 'Text Edit').replace(/^New Document\s*-\s*/, '').replace(/\s*-\s*Text Edit$/, '');
  }
  const tabBtn = document.getElementById('tabTextEditBtn');
  if (tabBtn) tabBtn.style.display = 'flex';

  switchView('textedit');

  const inPath = document.getElementById('textEditPathInput');
  if (inPath) inPath.value = filePath || '';

  const textarea = document.getElementById('textEditMainTextarea');
  if (!filePath) {
    if (textarea) textarea.value = '';
    updateTextEditStats();
    return;
  }

  const res = await window.api.readTextFile(filePath);
  if (res.success) {
    if (textarea) textarea.value = res.content;
    textEditState.isDirty = false;
  } else {
    showToast(`Error reading file: ${res.error}`, 'error');
  }
  updateTextEditStats();
}

function closeTextEditTab(event) {
  if (event) event.stopPropagation();
  const b = document.getElementById('tabTextEditBtn');
  if (b) b.style.display = 'none';
  switchToRemainingTabOrHome();
}

function handleTextEditChange() {
  textEditState.isDirty = true;
  updateTextEditStats();
}

function updateTextEditStats() {
  const textarea = document.getElementById('textEditMainTextarea');
  if (!textarea) return;
  const lines = textarea.value.split('\n').length;
  const chars = textarea.value.length;
  const lEl = document.getElementById('textEditLineCount');
  const cEl = document.getElementById('textEditCharCount');
  if (lEl) lEl.textContent = `${lines} lines`;
  if (cEl) cEl.textContent = `${chars} characters`;
}

async function saveTextEditContent() {
  let path = (document.getElementById('textEditPathInput')?.value || textEditState.filePath || '').trim();
  if (!path) {
    const selected = await window.api.selectFile('');
    if (!selected) return;
    path = selected;
    document.getElementById('textEditPathInput').value = path;
  }
  const content = document.getElementById('textEditMainTextarea')?.value || '';
  const res = await window.api.writeTextFile(path, content);
  if (res.success) {
    textEditState.isDirty = false;
    showToast(`File saved: ${path}`, 'success');
  } else {
    showToast(`Save error: ${res.error}`, 'error');
  }
}

async function openTextEditFile() {
  const selected = await window.api.selectFile('');
  if (selected) {
    openTextEdit(selected, selected);
  }
}

function reloadTextEditFile() {
  if (textEditState.filePath) openTextEdit(textEditState.filePath);
}

function toggleTextEditWrap() {
  const textarea = document.getElementById('textEditMainTextarea');
  if (textarea) textarea.classList.toggle('wrap-enabled');
  const btn = document.getElementById('btnTextEditWrap');
  if (btn) btn.classList.toggle('active');
}

function handleTextEditSearchKeydown(event) {
  if (event.key === 'Enter') navTextEditFind(1);
}

function navTextEditFind(dir) {
  const q = document.getElementById('textEditSearchInput')?.value;
  const textarea = document.getElementById('textEditMainTextarea');
  if (!q || !textarea) return;

  const text = textarea.value;
  const start = textarea.selectionEnd || 0;
  let idx = text.indexOf(q, start);
  if (idx === -1) idx = text.indexOf(q, 0);

  if (idx !== -1) {
    textarea.focus();
    textarea.setSelectionRange(idx, idx + q.length);
  } else {
    showToast(`"${q}" not found`, 'info');
  }
}
function handleTextEditPathKeydown(event) {
  if (event.key === 'Enter') handleTextEditPathBlur();
}
function handleTextEditPathBlur() {
  const inEl = document.getElementById('textEditPathInput');
  if (inEl && inEl.value.trim()) {
    openTextEdit(inEl.value.trim(), inEl.value.trim());
  }
}


async function executeSync(mode, item) {
  if (!appState.leftPath || !appState.rightPath) {
    showToast('Cannot sync: left or right path missing', 'error');
    return;
  }

  const modeLabels = {
    'sync_update_right': 'Update Right',
    'sync_update_left': 'Update Left',
    'sync_mirror_right': 'Mirror Right',
    'sync_mirror_left': 'Mirror Left'
  };

  const label = modeLabels[mode] || mode;
  if (!confirm(`Are you sure you want to execute "${label}"?`)) return;

  showToast(`Running synchronization: ${label}...`, 'info');
  appendLog(`Starting Sync: ${label}`);

  const targetItems = item 
    ? appState.comparisonItems.filter(it => it.relativePath === item.relativePath || it.relativePath.startsWith(item.relativePath + '/'))
    : appState.comparisonItems;

  let opCount = 0;
  for (const it of targetItems) {
    if (mode === 'sync_update_right') {
      if (it.left && (!it.right || it.status === 'different')) {
        const dest = `${appState.rightPath}/${it.relativePath}`;
        await window.api.copyItem(it.left.fullPath, dest);
        opCount++;
      }
    } else if (mode === 'sync_update_left') {
      if (it.right && (!it.left || it.status === 'different')) {
        const dest = `${appState.leftPath}/${it.relativePath}`;
        await window.api.copyItem(it.right.fullPath, dest);
        opCount++;
      }
    } else if (mode === 'sync_mirror_right') {
      if (it.left) {
        if (!it.right || it.status === 'different') {
          const dest = `${appState.rightPath}/${it.relativePath}`;
          await window.api.copyItem(it.left.fullPath, dest);
          opCount++;
        }
      } else if (it.right && !it.left) {
        await window.api.deleteItem(it.right.fullPath);
        opCount++;
      }
    } else if (mode === 'sync_mirror_left') {
      if (it.right) {
        if (!it.left || it.status === 'different') {
          const dest = `${appState.leftPath}/${it.relativePath}`;
          await window.api.copyItem(it.right.fullPath, dest);
          opCount++;
        }
      } else if (it.left && !it.right) {
        await window.api.deleteItem(it.left.fullPath);
        opCount++;
      }
    }
  }

  showToast(`Sync complete: ${opCount} files updated`, 'success');
  appendLog(`Sync finished: ${opCount} operations.`);
  runFolderComparison();
}

// --- SYNCHRONIZED CUSTOM VERTICAL SCROLLBAR SYSTEM (ZERO-LAG DUAL-PANE DRAG) ---
function createSyncVScrollbar(options) {
  const {
    leftScroll,
    rightScroll,
    extraScrolls = [],
    leftTrack,
    leftThumb,
    rightTrack,
    rightThumb,
    setDriver,
    onScroll
  } = options;

  let isDragging = false;
  let dragStartY = 0;
  let startScrollTop = 0;
  let maxScrollAtDragStart = 1;
  let maxThumbTopAtDragStart = 1;

  function update() {
    if (!leftScroll || !rightScroll) return;
    const scrollH = Math.max(leftScroll.scrollHeight, rightScroll.scrollHeight);
    const clientH = leftScroll.clientHeight;
    const currentScrollTop = leftScroll.scrollTop;

    const pairs = [
      { track: leftTrack, thumb: leftThumb },
      { track: rightTrack, thumb: rightThumb }
    ];

    pairs.forEach(({ track, thumb }) => {
      if (!track || !thumb) return;
      const trackH = track.clientHeight;
      if (scrollH <= clientH || trackH <= 0) {
        thumb.style.display = 'none';
        return;
      }
      thumb.style.display = 'block';

      const thumbH = Math.max(22, Math.round((clientH / scrollH) * trackH));
      const maxThumbTop = Math.max(0, trackH - thumbH);
      const maxScroll = Math.max(1, scrollH - clientH);
      const ratio = Math.max(0, Math.min(1, currentScrollTop / maxScroll));
      const thumbTop = Math.round(ratio * maxThumbTop);

      thumb.style.height = `${thumbH}px`;
      thumb.style.top = `${thumbTop}px`;
    });
  }

  function setScrollTop(newTop, skipOnScroll = false) {
    if (!leftScroll || !rightScroll) return;
    const maxScroll = Math.max(
      0,
      Math.max(leftScroll.scrollHeight, rightScroll.scrollHeight) - leftScroll.clientHeight
    );
    const clampedTop = Math.max(0, Math.min(maxScroll, Math.round(newTop)));

    // Simultaneous synchronized scroll assignment
    leftScroll.scrollTop = clampedTop;
    rightScroll.scrollTop = clampedTop;
    extraScrolls.forEach(el => {
      if (el) el.scrollTop = clampedTop;
    });

    update();
    if (!skipOnScroll && typeof onScroll === 'function') {
      onScroll();
    }
  }

  function initTrackEvents(track, thumb) {
    if (!track || !thumb) return;

    track.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const scrollH = Math.max(leftScroll.scrollHeight, rightScroll.scrollHeight);
      const clientH = leftScroll.clientHeight;
      if (scrollH <= clientH) return;

      const trackRect = track.getBoundingClientRect();
      const trackH = track.clientHeight;
      const thumbH = thumb.offsetHeight || 22;
      const maxThumbTop = Math.max(1, trackH - thumbH);
      const maxScroll = Math.max(1, scrollH - clientH);

      const isThumb = (e.target === thumb);

      if (!isThumb) {
        // Direct jump when clicking track
        const clickY = e.clientY - trackRect.top;
        const targetThumbTop = clickY - (thumbH / 2);
        const ratio = Math.max(0, Math.min(1, targetThumbTop / maxThumbTop));
        const targetTop = ratio * maxScroll;
        setScrollTop(targetTop);
      }

      isDragging = true;
      dragStartY = e.clientY;
      startScrollTop = leftScroll.scrollTop;
      maxScrollAtDragStart = Math.max(1, Math.max(leftScroll.scrollHeight, rightScroll.scrollHeight) - clientH);
      maxThumbTopAtDragStart = Math.max(1, track.clientHeight - (thumb.offsetHeight || 22));

      if (typeof setDriver === 'function') setDriver('custom_vscroll');
      if (leftThumb) leftThumb.classList.add('active');
      if (rightThumb) rightThumb.classList.add('active');

      try {
        track.setPointerCapture(e.pointerId);
      } catch (_) {}

      const onPointerMove = (ev) => {
        if (!isDragging) return;
        ev.preventDefault();
        const deltaY = ev.clientY - dragStartY;
        const scrollDelta = (deltaY / maxThumbTopAtDragStart) * maxScrollAtDragStart;
        setScrollTop(startScrollTop + scrollDelta);
      };

      const onPointerUp = (ev) => {
        if (!isDragging) return;
        isDragging = false;
        if (typeof setDriver === 'function') setDriver(null);
        if (leftThumb) leftThumb.classList.remove('active');
        if (rightThumb) rightThumb.classList.remove('active');
        try {
          track.releasePointerCapture(ev.pointerId);
        } catch (_) {}
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    });
  }

  initTrackEvents(leftTrack, leftThumb);
  initTrackEvents(rightTrack, rightThumb);

  return {
    update,
    setScrollTop,
    isDragging: () => isDragging
  };
}

// --- SYNCHRONIZED VIRTUAL SCROLL & EVENT DELEGATION ---
let folderScrollDriver = null;
let folderScrollTimer = null;
let isSyncingFolder = false;
let activeFolderScrollSource = null;
let folderSyncScrollbar = null;

function setupSyncScroll() {
  const leftPane = document.getElementById('leftPaneScroll');
  const rightPane = document.getElementById('rightPaneScroll');
  const diffPanes = document.getElementById('folderDualContainer') || document.querySelector('.folder-dual-container');
  if (!leftPane || !rightPane) return;

  folderSyncScrollbar = createSyncVScrollbar({
    leftScroll: leftPane,
    rightScroll: rightPane,
    leftTrack: document.getElementById('folderLeftVScroll'),
    leftThumb: document.getElementById('folderLeftVThumb'),
    rightTrack: document.getElementById('folderRightVScroll'),
    rightThumb: document.getElementById('folderRightVThumb'),
    setDriver: (driver) => { folderScrollDriver = driver; },
    onScroll: () => {
      renderVisibleWindow();
    }
  });

  // Zero-lag simultaneous wheel scrolling across the entire dual container
  if (diffPanes) {
    diffPanes.addEventListener('wheel', (e) => {
      e.preventDefault();
      folderScrollDriver = 'wheel';
      clearTimeout(folderScrollTimer);
      folderScrollTimer = setTimeout(() => {
        folderScrollDriver = null;
      }, 80);

      const maxScroll = Math.max(
        0,
        Math.max(leftPane.scrollHeight, rightPane.scrollHeight) - leftPane.clientHeight
      );
      const newTop = Math.max(0, Math.min(maxScroll, leftPane.scrollTop + e.deltaY));
      const newLeft = Math.max(0, leftPane.scrollLeft + e.deltaX);

      leftPane.scrollTop = newTop;
      rightPane.scrollTop = newTop;
      leftPane.scrollLeft = newLeft;
      rightPane.scrollLeft = newLeft;

      renderVisibleWindow();
      if (folderSyncScrollbar) folderSyncScrollbar.update();
    }, { passive: false });
  }

  function syncScroll(source, target) {
    if (folderScrollDriver === 'wheel' || folderScrollDriver === 'custom_vscroll') return;
    if (Math.abs(target.scrollTop - source.scrollTop) <= 0.5 && Math.abs(target.scrollLeft - source.scrollLeft) <= 0.5) {
      return;
    }
    if (isSyncingFolder && activeFolderScrollSource !== source) return;

    isSyncingFolder = true;
    activeFolderScrollSource = source;
    target.scrollTop = source.scrollTop;
    target.scrollLeft = source.scrollLeft;

    renderVisibleWindow();
    if (folderSyncScrollbar) folderSyncScrollbar.update();

    requestAnimationFrame(() => {
      isSyncingFolder = false;
      activeFolderScrollSource = null;
    });
  }

  leftPane.addEventListener('scroll', () => syncScroll(leftPane, rightPane), { passive: true });
  rightPane.addEventListener('scroll', () => syncScroll(rightPane, leftPane), { passive: true });
}

function setupTableEventDelegation() {
  ['leftTableBody', 'rightTableBody'].forEach(tbodyId => {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;

    // Fast Delegated Click Handler
    tbody.addEventListener('click', (event) => {
      // 1. Toggle Arrow Click
      const toggleEl = event.target.closest('.tree-toggle');
      if (toggleEl) {
        event.stopPropagation();
        const relPath = toggleEl.dataset.relpath;
        if (relPath) toggleFolder(relPath);
        return;
      }

      // 2. Red Diff Box Click (Jump directly & select row)
      const diffBox = event.target.closest('.red-diff-box, .diff-marker-cell');
      if (diffBox) {
        const row = event.target.closest('tr.diff-row');
        if (row && row.dataset.index) {
          event.stopPropagation();
          const index = parseInt(row.dataset.index, 10);
          if (!isNaN(index)) {
            selectTableRow(index, event);
            scrollToRow(index);
            return;
          }
        }
      }

      // 3. Row Selection Click
      const row = event.target.closest('tr.diff-row');
      if (!row || !row.dataset.index) return;
      const index = parseInt(row.dataset.index, 10);
      if (!isNaN(index)) selectTableRow(index, event);
    });

    // Fast Delegated Double Click Handler
    tbody.addEventListener('dblclick', (event) => {
      const row = event.target.closest('tr.diff-row');
      if (!row || !row.dataset.index) return;
      const index = parseInt(row.dataset.index, 10);
      if (isNaN(index)) return;

      const item = appState.filteredItems[index];
      if (!item) return;

      if (item.isDirectory) {
        toggleFolder(item.relativePath);
      } else {
        handleRowDoubleClick(item);
      }
    });

    // Delegated Context Menu Handler
    tbody.addEventListener('contextmenu', (event) => {
      handleTableContextMenu(event);
    });
  });
}

// --- BEYOND COMPARE 5 TEXT COMPARE ENGINE & SYNTAX HIGHLIGHTER ---
// --- BEYOND COMPARE 5 TEXT COMPARE ENGINE & VS CODE SYNTAX HIGHLIGHTER ---
const VSCODE_CTRL_KW = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'default',
  'return', 'try', 'catch', 'finally', 'throw', 'throws', 'yield', 'await', 'async',
  'match', 'select', 'elif', 'except', 'raise', 'loop', 'where', 'having', 'on', 'when',
  'then', 'end', 'with', 'goto'
]);

const VSCODE_STD_KW = new Set([
  'function', 'class', 'const', 'let', 'var', 'import', 'export', 'from', 'as', 'default',
  'new', 'this', 'super', 'extends', 'implements', 'interface', 'type', 'enum', 'public',
  'private', 'protected', 'static', 'readonly', 'abstract', 'typeof', 'instanceof', 'void',
  'delete', 'in', 'of', 'debugger', 'package', 'namespace', 'def', 'lambda', 'pass', 'assert',
  'del', 'is', 'not', 'and', 'or', 'global', 'nonlocal', 'self', 'cls', 'struct', 'union',
  'template', 'typename', 'virtual', 'friend', 'explicit', 'mutable', 'constexpr', 'using',
  'auto', 'extern', 'register', 'volatile', 'inline', 'internal', 'record', 'sealed',
  'override', 'base', 'lock', 'event', 'delegate', 'partial', 'get', 'set', 'init', 'fn',
  'mut', 'pub', 'mod', 'use', 'trait', 'impl', 'ref', 'move', 'crate', 'func', 'go',
  'defer', 'chan', 'range', 'fallthrough', 'echo', 'clone', 'join', 'left', 'right',
  'inner', 'outer', 'cross', 'full', 'group', 'by', 'order', 'limit', 'offset', 'insert',
  'into', 'values', 'update', 'between', 'like', 'exists', 'union', 'all', 'distinct',
  'partition', 'over'
]);

const VSCODE_LITERALS = new Set([
  'true', 'false', 'null', 'undefined', 'nil', 'None', 'True', 'False', 'nullptr', 'NaN', 'Infinity'
]);

const VSCODE_TYPES = new Set([
  'int', 'long', 'short', 'byte', 'float', 'double', 'boolean', 'char', 'void', 'string',
  'number', 'any', 'unknown', 'never', 'symbol', 'bigint', 'object', 'bool', 'str', 'list',
  'dict', 'set', 'tuple', 'bytes', 'bytearray', 'i8', 'i16', 'i32', 'i64', 'i128', 'isize',
  'u8', 'u16', 'u32', 'u64', 'u128', 'usize', 'f32', 'f64', 'rune', 'error', 'uint',
  'String', 'Integer', 'Boolean', 'Long', 'Double', 'Float', 'Byte', 'Short', 'Character',
  'Object', 'Class', 'List', 'Map', 'Set', 'ArrayList', 'HashMap', 'HashSet', 'Array',
  'Promise', 'Date', 'RegExp', 'Error', 'Math', 'JSON', 'Console', 'System', 'Exception',
  'Thread', 'Vec', 'Option', 'Result', 'Some', 'Box', 'Ok', 'Err', 'Task', 'Action', 'Func',
  'Dictionary', 'HashSet', 'IEnumerable', 'DateTime', 'StringBuilder', 'Logger', 'Connection',
  'PreparedStatement', 'ResultSet', 'VARCHAR', 'INTEGER', 'BIGINT', 'TIMESTAMP', 'DECIMAL',
  'FLOAT', 'TEXT', 'DATE', 'DATETIME', 'BOOLEAN'
]);

function detectLanguage(filePath) {
  if (!filePath) return 'generic';
  const ext = filePath.split('.').pop().toLowerCase();
  switch (ext) {
    case 'java': return 'java';
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs': return 'javascript';
    case 'ts':
    case 'tsx': return 'typescript';
    case 'py':
    case 'pyw': return 'python';
    case 'sql': return 'sql';
    case 'xml':
    case 'svg':
    case 'jsp':
    case 'sqlx': return 'xml';
    case 'html':
    case 'htm':
    case 'vue': return 'html';
    case 'json': return 'json';
    case 'css':
    case 'scss':
    case 'less': return 'css';
    case 'c':
    case 'h': return 'c';
    case 'cpp':
    case 'hpp':
    case 'cc':
    case 'cxx': return 'cpp';
    case 'cs': return 'csharp';
    case 'php': return 'php';
    case 'go': return 'go';
    case 'rs': return 'rust';
    case 'sh':
    case 'bash':
    case 'zsh': return 'bash';
    case 'yaml':
    case 'yml': return 'yaml';
    case 'md':
    case 'markdown': return 'markdown';
    default: return 'generic';
  }
}

function getLanguageDisplayName(lang) {
  switch (lang) {
    case 'java': return 'Java ▾';
    case 'javascript': return 'JavaScript ▾';
    case 'typescript': return 'TypeScript ▾';
    case 'python': return 'Python ▾';
    case 'sql': return 'SQL ▾';
    case 'html': return 'HTML ▾';
    case 'xml': return 'XML ▾';
    case 'json': return 'JSON ▾';
    case 'css': return 'CSS ▾';
    case 'c': return 'C ▾';
    case 'cpp': return 'C++ ▾';
    case 'csharp': return 'C# ▾';
    case 'php': return 'PHP ▾';
    case 'go': return 'Go ▾';
    case 'rust': return 'Rust ▾';
    case 'bash': return 'Shell Script ▾';
    case 'yaml': return 'YAML ▾';
    case 'markdown': return 'Markdown ▾';
    default: return 'Source Code ▾';
  }
}

function updateTextFormatBadges() {
  const badgeL = document.getElementById('textLeftFormatBadge');
  const badgeR = document.getElementById('textRightFormatBadge');
  const pathL = appState.currentTextFile ? appState.currentTextFile.leftFullPath : '';
  const pathR = appState.currentTextFile ? appState.currentTextFile.rightFullPath : '';
  const langL = detectLanguage(pathL || pathR || appState.currentTextFile?.relativePath);
  const langR = detectLanguage(pathR || pathL || appState.currentTextFile?.relativePath);
  if (badgeL) badgeL.textContent = getLanguageDisplayName(langL);
  if (badgeR) badgeR.textContent = getLanguageDisplayName(langR);
}

function highlightSyntax(line, lang = 'generic', isDiff = false, isComment = false) {
  if (!line && line !== '') return '';
  const trimmed = line.trim();
  if (isComment) return `<span class="token-comment">${escapeHtml(line)}</span>`;

  // Full-line comment checks (Javadoc / block / single-line)
  if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.endsWith('*/')) {
    return `<span class="token-comment">${escapeHtml(line)}</span>`;
  }
  if ((lang === 'python' || lang === 'bash' || lang === 'yaml') && trimmed.startsWith('#')) {
    return `<span class="token-comment">${escapeHtml(line)}</span>`;
  }
  if (lang === 'sql' && trimmed.startsWith('--')) {
    return `<span class="token-comment">${escapeHtml(line)}</span>`;
  }

  // C / C++ Preprocessor Directives
  if ((lang === 'c' || lang === 'cpp') && trimmed.startsWith('#')) {
    return `<span class="token-directive">${escapeHtml(line)}</span>`;
  }

  // HTML / XML Syntax
  if (lang === 'html' || lang === 'xml') {
    return line.replace(/(<!--[\s\S]*?-->)|(<\/?[a-zA-Z0-9_\-:]+)|(\s+[a-zA-Z0-9_\-:]+)(?=\s*=)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\/?>)/g, (m, comm, tag, attr, str, bracket) => {
      if (comm) return `<span class="token-comment">${escapeHtml(comm)}</span>`;
      if (tag) return `<span class="token-tag">${escapeHtml(tag)}</span>`;
      if (attr) return `<span class="token-attribute">${escapeHtml(attr)}</span>`;
      if (str) return `<span class="token-string">${escapeHtml(str)}</span>`;
      if (bracket) return `<span class="token-tag">${escapeHtml(bracket)}</span>`;
      return escapeHtml(m);
    });
  }

  // JSON Syntax
  if (lang === 'json') {
    return line.replace(/("(?:\\.|[^"\\])*")(\s*:)?|(\btrue\b|\bfalse\b|\bnull\b)|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(\/\/.*|\/\*.*?\*\/)/g, (m, str, colon, lit, num, comm) => {
      if (comm) return `<span class="token-comment">${escapeHtml(comm)}</span>`;
      if (colon) return `<span class="token-property">${escapeHtml(str)}</span>${colon}`;
      if (str) return `<span class="token-string">${escapeHtml(str)}</span>`;
      if (lit) return `<span class="token-keyword">${escapeHtml(lit)}</span>`;
      if (num) return `<span class="token-number">${escapeHtml(num)}</span>`;
      return escapeHtml(m);
    });
  }

  // CSS Syntax
  if (lang === 'css') {
    return line.replace(/(\/\*.*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|([a-zA-Z\-]+)(?=\s*:)|(#[0-9a-fA-F]{3,8}\b|-?\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg)?\b)|(!important\b)/g, (m, comm, str, prop, num, imp) => {
      if (comm) return `<span class="token-comment">${escapeHtml(comm)}</span>`;
      if (str) return `<span class="token-string">${escapeHtml(str)}</span>`;
      if (prop) return `<span class="token-property">${escapeHtml(prop)}</span>`;
      if (num) return `<span class="token-number">${escapeHtml(num)}</span>`;
      if (imp) return `<span class="token-keyword">${escapeHtml(imp)}</span>`;
      return escapeHtml(m);
    });
  }

  // Universal High-Fidelity VS Code Lexer
  const tokenRegex = /(?<comment>\/\/.*|\/\*.*?\*\/|#.*|--.*)|(?<string>"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(?<annotation>@[a-zA-Z_$][a-zA-Z0-9_$]*)|(?<number>\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|0x[0-9a-fA-F]+\b)|(?<word>\$?[a-zA-Z_$][a-zA-Z0-9_$]*)|(?<other>[^\s\w])/g;

  let result = '';
  let lastIdx = 0;
  let match;

  while ((match = tokenRegex.exec(line)) !== null) {
    if (match.index > lastIdx) {
      result += escapeHtml(line.slice(lastIdx, match.index));
    }
    lastIdx = tokenRegex.lastIndex;

    const g = match.groups;
    if (g.comment) {
      result += `<span class="token-comment">${escapeHtml(g.comment)}</span>`;
    } else if (g.string) {
      result += `<span class="token-string">${escapeHtml(g.string)}</span>`;
    } else if (g.annotation) {
      result += `<span class="token-annotation">${escapeHtml(g.annotation)}</span>`;
    } else if (g.number) {
      result += `<span class="token-number">${escapeHtml(g.number)}</span>`;
    } else if (g.word) {
      const w = g.word;
      const lower = w.toLowerCase();
      const rest = line.slice(tokenRegex.lastIndex);
      const isCall = /^\s*\(/.test(rest);

      if (VSCODE_CTRL_KW.has(w) || (lang === 'sql' && VSCODE_CTRL_KW.has(lower))) {
        result += `<span class="token-control">${escapeHtml(w)}</span>`;
      } else if (VSCODE_STD_KW.has(w) || (lang === 'sql' && VSCODE_STD_KW.has(lower))) {
        result += `<span class="token-keyword">${escapeHtml(w)}</span>`;
      } else if (VSCODE_LITERALS.has(w) || (lang === 'sql' && VSCODE_LITERALS.has(lower))) {
        result += `<span class="token-keyword">${escapeHtml(w)}</span>`;
      } else if (VSCODE_TYPES.has(w) || (lang === 'sql' && VSCODE_TYPES.has(lower))) {
        result += `<span class="token-type">${escapeHtml(w)}</span>`;
      } else if (isCall) {
        result += `<span class="token-function">${escapeHtml(w)}</span>`;
      } else if (/^[A-Z][a-zA-Z0-9_$]*$/.test(w) && w.length > 1) {
        result += `<span class="token-type">${escapeHtml(w)}</span>`;
      } else if (/^[A-Z0-9_]{2,}$/.test(w)) {
        result += `<span class="token-constant">${escapeHtml(w)}</span>`;
      } else {
        result += `<span class="token-variable">${escapeHtml(w)}</span>`;
      }
    } else if (g.other) {
      result += escapeHtml(g.other);
    }
  }

  if (lastIdx < line.length) {
    result += escapeHtml(line.slice(lastIdx));
  }

  return result;
}

async function openTextCompare(leftFullPath = '', rightFullPath = '', label = 'Text Compare', isChildCompare = false) {
  appState.currentTextFile = {
    relativePath: label,
    leftFullPath: leftFullPath || '',
    rightFullPath: rightFullPath || '',
    leftContent: '',
    rightContent: '',
    diffResult: null,
    currentSectionIndex: -1
  };

  updateTextTabTitle();

  const tabTextBtn = document.getElementById('tabTextBtn');
  if (tabTextBtn) tabTextBtn.style.display = 'flex';

  const inputL = document.getElementById('textLeftPathInput');
  if (inputL) inputL.value = leftFullPath || '';

  const inputR = document.getElementById('textRightPathInput');
  if (inputR) inputR.value = rightFullPath || '';

  // Only register as the top active session card if this is a direct/standalone comparison
  // (not a child inspection from within an ongoing Folder Compare session)
  if (!isChildCompare && (leftFullPath || rightFullPath)) {
    appState.selectedSession = {
      id: 'active-text',
      name: label || 'Text Compare',
      type: 'text_compare',
      leftPath: leftFullPath,
      rightPath: rightFullPath,
      source: 'Active'
    };
    appState.activeFolderSession = null;
  }

  switchView('text');

  // Case 1: Both files empty -> display authentic Beyond Compare 5 empty canvas
  if (!leftFullPath && !rightFullPath) {
    renderEmptyTextCompare();
    return;
  }

  // Case 2: Only left file specified
  if (leftFullPath && !rightFullPath) {
    await loadTextFileForSide('left', leftFullPath);
    return;
  }

  // Case 3: Only right file specified
  if (!leftFullPath && rightFullPath) {
    await loadTextFileForSide('right', rightFullPath);
    return;
  }

  // Case 4: Both files specified -> read and compare
  const resLeft = await window.api.readTextFile(leftFullPath);
  const resRight = await window.api.readTextFile(rightFullPath);

  const contentLeft = resLeft.success ? (resLeft.content || '') : '';
  const contentRight = resRight.success ? (resRight.content || '') : '';

  appState.currentTextFile.leftContent = contentLeft;
  appState.currentTextFile.rightContent = contentRight;
  appState.currentTextFile.originalLeftContent = contentLeft;
  appState.currentTextFile.originalRightContent = contentRight;

  const leftMetaEl = document.getElementById('textLeftMeta');
  if (leftMetaEl) leftMetaEl.textContent = `${formatBytes(contentLeft.length)} | ${(resLeft.lineCount || 0).toLocaleString()} lines | UTF-8 ▾`;

  const rightMetaEl = document.getElementById('textRightMeta');
  if (rightMetaEl) rightMetaEl.textContent = `${formatBytes(contentRight.length)} | ${(resRight.lineCount || 0).toLocaleString()} lines | UTF-8 ▾`;

  // Compute Myers Aligned Diff
  const diffResult = await window.api.computeAlignedDiff(contentLeft, contentRight);
  appState.currentTextFile.diffResult = diffResult;

  // Render side-by-side aligned diff
  renderTextDiff(diffResult);

  // Auto-save session ONLY if this is a direct standalone text comparison
  // (Do not save child file comparisons triggered from within a Folder Compare session)
  if (!isChildCompare && leftFullPath && rightFullPath) {
    const sessName = (label && label !== 'Text Compare') ? label : undefined;
    window.api.recordAutoSavedSession({
      type: 'text_compare',
      name: sessName,
      leftPath: leftFullPath,
      rightPath: rightFullPath
    }).then(() => reloadSessions()).catch(err => console.warn('AutoSave text error:', err));
  }
}

function updateTextTabTitle() {
  const left = appState.currentTextFile.leftFullPath;
  const right = appState.currentTextFile.rightFullPath;
  const titleEl = document.getElementById('currentTextTabTitle');
  if (!titleEl) return;
  if (!left && !right) {
    titleEl.textContent = 'Text Compare';
  } else if (left && right) {
    const nameL = left.split(/[\/\\]/).pop();
    const nameR = right.split(/[\/\\]/).pop();
    titleEl.textContent = nameL === nameR ? nameL : `${nameL} ↔ ${nameR}`;
  } else {
    const single = (left || right).split(/[\/\\]/).pop();
    titleEl.textContent = single || 'Text Compare';
  }
  if (appState.activeView === 'text') {
    updateAppHeader();
  }
}

function renderEmptyTextCompare() {
  const containerL = document.getElementById('textLeftLines');
  const containerR = document.getElementById('textRightLines');
  const gutter = document.getElementById('textCenterGutter');
  const badge = document.getElementById('textDiffBadge');
  const metaL = document.getElementById('textLeftMeta');
  const metaR = document.getElementById('textRightMeta');

  if (gutter) gutter.innerHTML = '';
  if (containerL) {
    containerL.innerHTML = `<div class="text-empty-dropzone" onclick="browseTextFile('left')"><div class="dropzone-icon">📄</div><div>Drop left file here, or click 📁 to browse</div></div>`;
    containerL.style.height = '100%';
  }
  if (containerR) {
    containerR.innerHTML = `<div class="text-empty-dropzone" onclick="browseTextFile('right')"><div class="dropzone-icon">📄</div><div>Drop right file here, or click 📁 to browse</div></div>`;
    containerR.style.height = '100%';
  }
  if (badge) {
    badge.textContent = 'Drag files into panels or click 📁 to browse';
    badge.style.background = 'rgba(255, 255, 255, 0.08)';
    badge.style.color = '#aaa';
  }
  if (metaL) metaL.textContent = 'Unicode (UTF-8) ▾';
  if (metaR) metaR.textContent = 'Unicode (UTF-8) ▾';
}

function renderSingleSideText(loadedSide) {
  const containerL = document.getElementById('textLeftLines');
  const containerR = document.getElementById('textRightLines');
  const gutter = document.getElementById('textCenterGutter');
  const badge = document.getElementById('textDiffBadge');
  if (gutter) gutter.innerHTML = '';

  const path = loadedSide === 'left' ? appState.currentTextFile.leftFullPath : appState.currentTextFile.rightFullPath;
  const lang = detectLanguage(path);
  updateTextFormatBadges();

  const content = loadedSide === 'left' ? appState.currentTextFile.leftContent : appState.currentTextFile.rightContent;
  const rawLines = (content || '').split(/\r\n|\r|\n/);
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') rawLines.pop();

  const rows = [];
  for (let i = 0; i < rawLines.length; i++) {
    rows.push({
      type: 'same',
      leftNum: loadedSide === 'left' ? i + 1 : null,
      leftText: loadedSide === 'left' ? rawLines[i] : '',
      rightNum: loadedSide === 'right' ? i + 1 : null,
      rightText: loadedSide === 'right' ? rawLines[i] : '',
      isGhostL: loadedSide !== 'left',
      isGhostR: loadedSide !== 'right'
    });
  }

  const singleDiff = {
    rows,
    sections: [],
    totalRows: rows.length,
    sectionCount: 0,
    isSingleSide: loadedSide
  };

  appState.currentTextFile.diffResult = singleDiff;

  if (badge) {
    badge.textContent = loadedSide === 'left' ? 'Left file loaded — Select right file to compare' : 'Right file loaded — Select left file to compare';
    badge.style.background = 'rgba(74, 222, 128, 0.15)';
    badge.style.color = '#4ade80';
  }

  renderTextDiff(singleDiff);
}

async function browseTextFile(side) {
  const currentPath = side === 'left' ? appState.currentTextFile.leftFullPath : appState.currentTextFile.rightFullPath;
  const selected = await window.api.selectFile(currentPath || appState.leftPath);
  if (!selected) return;
  await loadTextFileForSide(side, selected);
}

async function loadTextFileForSide(side, filePath) {
  if (!filePath) return;
  const res = await window.api.readTextFile(filePath);
  if (!res.success) {
    showToast(`Error opening file: ${res.error}`, 'error');
    return;
  }

  const content = res.content || '';
  if (side === 'left') {
    appState.currentTextFile.leftFullPath = filePath;
    appState.currentTextFile.leftContent = content;
    appState.currentTextFile.originalLeftContent = content;
    const inputL = document.getElementById('textLeftPathInput');
    if (inputL) inputL.value = filePath;
    const metaL = document.getElementById('textLeftMeta');
    if (metaL) metaL.textContent = `${formatBytes(content.length)} | ${(res.lineCount || 0).toLocaleString()} lines | UTF-8 ▾`;
  } else {
    appState.currentTextFile.rightFullPath = filePath;
    appState.currentTextFile.rightContent = content;
    appState.currentTextFile.originalRightContent = content;
    const inputR = document.getElementById('textRightPathInput');
    if (inputR) inputR.value = filePath;
    const metaR = document.getElementById('textRightMeta');
    if (metaR) metaR.textContent = `${formatBytes(content.length)} | ${(res.lineCount || 0).toLocaleString()} lines | UTF-8 ▾`;
  }

  updateTextTabTitle();

  if (appState.currentTextFile.leftFullPath && appState.currentTextFile.rightFullPath) {
    const diff = await window.api.computeAlignedDiff(
      appState.currentTextFile.leftContent,
      appState.currentTextFile.rightContent
    );
    appState.currentTextFile.diffResult = diff;
    renderTextDiff(diff);
  } else {
    renderSingleSideText(side);
  }
}

function handlePathInputKeydown(event, side) {
  if (event.key === 'Enter') {
    const path = event.target.value.trim();
    if (path) {
      loadTextFileForSide(side, path);
    }
  }
}

function handlePathInputBlur(side) {
  const input = document.getElementById(side === 'left' ? 'textLeftPathInput' : 'textRightPathInput');
  if (!input) return;
  const path = input.value.trim();
  const current = side === 'left' ? appState.currentTextFile.leftFullPath : appState.currentTextFile.rightFullPath;
  if (path && path !== current) {
    loadTextFileForSide(side, path);
  }
}

async function swapSidesText() {
  const tempPath = appState.currentTextFile.leftFullPath;
  const tempContent = appState.currentTextFile.leftContent;
  const tempOrig = appState.currentTextFile.originalLeftContent;

  appState.currentTextFile.leftFullPath = appState.currentTextFile.rightFullPath;
  appState.currentTextFile.leftContent = appState.currentTextFile.rightContent;
  appState.currentTextFile.originalLeftContent = appState.currentTextFile.originalRightContent;

  appState.currentTextFile.rightFullPath = tempPath;
  appState.currentTextFile.rightContent = tempContent;
  appState.currentTextFile.originalRightContent = tempOrig;

  const inputL = document.getElementById('textLeftPathInput');
  const inputR = document.getElementById('textRightPathInput');
  if (inputL) inputL.value = appState.currentTextFile.leftFullPath || '';
  if (inputR) inputR.value = appState.currentTextFile.rightFullPath || '';

  updateTextTabTitle();

  if (appState.currentTextFile.leftFullPath && appState.currentTextFile.rightFullPath) {
    const diff = await window.api.computeAlignedDiff(
      appState.currentTextFile.leftContent,
      appState.currentTextFile.rightContent
    );
    appState.currentTextFile.diffResult = diff;
    renderTextDiff(diff);
  } else if (appState.currentTextFile.leftFullPath) {
    renderSingleSideText('left');
  } else if (appState.currentTextFile.rightFullPath) {
    renderSingleSideText('right');
  } else {
    renderEmptyTextCompare();
  }
}

async function reloadTextCompare() {
  const left = appState.currentTextFile.leftFullPath;
  const right = appState.currentTextFile.rightFullPath;
  if (!left && !right) return;
  if (left) await loadTextFileForSide('left', left);
  if (right) await loadTextFileForSide('right', right);
}

function setTextFilter(filter) {
  ['textFilterAllBtn', 'textFilterDiffsBtn', 'textFilterSameBtn'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.classList.remove('active');
  });
  if (filter === 'all') {
    const b = document.getElementById('textFilterAllBtn');
    if (b) b.classList.add('active');
  } else if (filter === 'diffs') {
    const b = document.getElementById('textFilterDiffsBtn');
    if (b) b.classList.add('active');
  } else if (filter === 'same') {
    const b = document.getElementById('textFilterSameBtn');
    if (b) b.classList.add('active');
  }

  const rowsL = document.querySelectorAll('#textLeftLines .text-line-row');
  const rowsR = document.querySelectorAll('#textRightLines .text-line-row');

  for (let i = 0; i < rowsL.length; i++) {
    const rowL = rowsL[i];
    const rowR = rowsR[i];
    const isDiff = rowL.classList.contains('diff-code') || rowL.classList.contains('diff-comment') || rowL.classList.contains('ghost-hatched') ||
                   (rowR && (rowR.classList.contains('diff-code') || rowR.classList.contains('diff-comment') || rowR.classList.contains('ghost-hatched')));

    let show = true;
    if (filter === 'diffs') {
      show = isDiff;
    } else if (filter === 'same') {
      show = !isDiff;
    }

    rowL.style.display = show ? 'flex' : 'none';
    if (rowR) rowR.style.display = show ? 'flex' : 'none';
  }
}

// Cross-Platform Drag and Drop Resolver (Electron 40+ webUtils + URI fallback)
function extractPathsFromDataTransfer(dt) {
  if (!dt) return [];
  const paths = [];

  // 1. Electron 32+ webUtils API on File objects
  if (dt.files && dt.files.length > 0) {
    for (let i = 0; i < dt.files.length; i++) {
      const file = dt.files[i];
      let resolved = '';
      if (window.api && typeof window.api.getPathForFile === 'function') {
        try {
          resolved = window.api.getPathForFile(file);
        } catch (e) {
          console.warn('getPathForFile error:', e);
        }
      }
      if (!resolved && file.path) {
        resolved = file.path;
      }
      if (resolved && !paths.includes(resolved)) {
        paths.push(resolved);
      }
    }
  }

  // 2. DataTransfer items fallback
  if (paths.length === 0 && dt.items && dt.items.length > 0) {
    for (let i = 0; i < dt.items.length; i++) {
      const item = dt.items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          let resolved = '';
          if (window.api && typeof window.api.getPathForFile === 'function') {
            try {
              resolved = window.api.getPathForFile(file);
            } catch (e) {}
          }
          if (!resolved && file.path) resolved = file.path;
          if (resolved && !paths.includes(resolved)) {
            paths.push(resolved);
          }
        }
      }
    }
  }

  // 3. Fallback for text/uri-list and text/plain (Finder, Nautilus, etc.)
  if (paths.length === 0) {
    try {
      const uriList = dt.getData('text/uri-list') || dt.getData('text/plain') || '';
      if (uriList) {
        const lines = uriList.split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && trimmed.startsWith('file://')) {
            try {
              let p = decodeURIComponent(new URL(trimmed).pathname);
              if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1);
              if (p && !paths.includes(p)) paths.push(p);
            } catch {}
          } else if (trimmed && (trimmed.startsWith('/') || /^[a-zA-Z]:\\/.test(trimmed))) {
            if (!paths.includes(trimmed)) paths.push(trimmed);
          }
        }
      }
    } catch {}
  }

  return paths;
}

function getDroppedFilePath(file) {
  if (!file) return '';
  if (window.api && typeof window.api.getPathForFile === 'function') {
    try {
      const resolved = window.api.getPathForFile(file);
      if (resolved) return resolved;
    } catch (err) {
      console.warn('window.api.getPathForFile error:', err);
    }
  }
  return file.path || '';
}

async function isDirectoryPath(p) {
  if (!p) return false;
  try {
    const res = await window.api.getAttributes(p);
    return !!(res && res.success && res.isDirectory);
  } catch {
    return false;
  }
}

function setupTextDragAndDrop() {
  setupAllDragAndDrop();
}

function setupAllDragAndDrop() {
  // Prevent browser default navigation on drag/drop across entire window
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }, false);

  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }, false);

  window.addEventListener('drop', (e) => {
    e.preventDefault();
  }, false);

  // 1. Text Compare Panes (Left & Right)
  const textPanes = [
    { wrapperId: 'textLeftPaneWrapper', scrollId: 'textLeftScroll', side: 'left' },
    { wrapperId: 'textRightPaneWrapper', scrollId: 'textRightScroll', side: 'right' }
  ];

  textPanes.forEach(({ wrapperId, scrollId, side }) => {
    const wrapper = document.getElementById(wrapperId);
    const scrollEl = document.getElementById(scrollId);
    if (!wrapper) return;

    let dragCount = 0;
    wrapper.addEventListener('dragenter', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCount++;
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      if (scrollEl) scrollEl.classList.add('drag-over');
      wrapper.classList.add('drag-over-pane');
    });

    wrapper.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });

    wrapper.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCount--;
      if (dragCount <= 0) {
        dragCount = 0;
        if (scrollEl) scrollEl.classList.remove('drag-over');
        wrapper.classList.remove('drag-over-pane');
      }
    });

    wrapper.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCount = 0;
      if (scrollEl) scrollEl.classList.remove('drag-over');
      wrapper.classList.remove('drag-over-pane');

      const paths = extractPathsFromDataTransfer(e.dataTransfer);
      if (paths.length === 0) return;

      if (paths.length >= 2) {
        const isDir1 = await isDirectoryPath(paths[0]);
        const isDir2 = await isDirectoryPath(paths[1]);
        if (isDir1 && isDir2) {
          showToast('Folders dropped — Opening Folder Compare', 'info');
          openFolderCompare(paths[0], paths[1], 'Folder Compare');
          return;
        }
        await openTextCompare(paths[0], paths[1], paths[0]);
        return;
      }

      const p = paths[0];
      const isDir = await isDirectoryPath(p);
      if (isDir) {
        showToast('Folder dropped — Opening Folder Compare', 'info');
        openFolderCompare(side === 'left' ? p : '', side === 'right' ? p : '', 'Folder Compare');
        return;
      }

      await loadTextFileForSide(side, p);
    });
  });

  // 2. Folder Compare Panes (Left & Right)
  const folderPanes = [
    { containerId: 'leftPaneScroll', inputId: 'leftPathInput', side: 'left' },
    { containerId: 'rightPaneScroll', inputId: 'rightPathInput', side: 'right' }
  ];

  folderPanes.forEach(({ containerId, inputId, side }) => {
    const pane = document.getElementById(containerId);
    const input = document.getElementById(inputId);
    const targets = [pane, input].filter(Boolean);

    targets.forEach(target => {
      let dragCount = 0;
      target.addEventListener('dragenter', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCount++;
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        if (pane) pane.classList.add('drag-over-pane');
      });

      target.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      });

      target.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCount--;
        if (dragCount <= 0) {
          dragCount = 0;
          if (pane) pane.classList.remove('drag-over-pane');
        }
      });

      target.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCount = 0;
        if (pane) pane.classList.remove('drag-over-pane');

        const paths = extractPathsFromDataTransfer(e.dataTransfer);
        if (paths.length === 0) return;

        if (paths.length >= 2) {
          const isDir1 = await isDirectoryPath(paths[0]);
          const isDir2 = await isDirectoryPath(paths[1]);
          if (!isDir1 && !isDir2) {
            showToast('Files dropped — Opening Text Compare', 'info');
            await openTextCompare(paths[0], paths[1], paths[0]);
            return;
          }
          appState.leftPath = paths[0];
          appState.rightPath = paths[1];
          const inL = document.getElementById('leftPathInput');
          const inR = document.getElementById('rightPathInput');
          if (inL) inL.value = paths[0];
          if (inR) inR.value = paths[1];
          switchView('folder');
          runFolderComparison();
          return;
        }

        const p = paths[0];
        const isDir = await isDirectoryPath(p);
        if (!isDir) {
          showToast('File dropped — Opening Text Compare', 'info');
          await openTextCompare(side === 'left' ? p : '', side === 'right' ? p : '', p);
          return;
        }

        if (side === 'left') {
          appState.leftPath = p;
          const inL = document.getElementById('leftPathInput');
          if (inL) inL.value = p;
        } else {
          appState.rightPath = p;
          const inR = document.getElementById('rightPathInput');
          if (inR) inR.value = p;
        }

        if (appState.leftPath && appState.rightPath) {
          runFolderComparison();
        } else {
          runSingleSideFolder(side);
        }
      });
    });
  });

  // 3. Home Screen (Sessions View) Drag and Drop
  const homeMain = document.querySelector('.home-main');
  if (homeMain) {
    let homeDragCount = 0;
    homeMain.addEventListener('dragenter', (e) => {
      e.preventDefault();
      homeDragCount++;
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      homeMain.classList.add('drag-over-home');
    });

    homeMain.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });

    homeMain.addEventListener('dragleave', (e) => {
      e.preventDefault();
      homeDragCount--;
      if (homeDragCount <= 0) {
        homeDragCount = 0;
        homeMain.classList.remove('drag-over-home');
      }
    });

    homeMain.addEventListener('drop', async (e) => {
      e.preventDefault();
      homeDragCount = 0;
      homeMain.classList.remove('drag-over-home');

      const paths = extractPathsFromDataTransfer(e.dataTransfer);
      if (paths.length === 0) return;

      const isFirstDir = await isDirectoryPath(paths[0]);
      if (isFirstDir) {
        if (paths.length >= 2) {
          openFolderCompare(paths[0], paths[1], 'Folder Compare');
        } else {
          openFolderCompare(paths[0], '', 'Folder Compare');
        }
      } else {
        if (paths.length >= 2) {
          openTextCompare(paths[0], paths[1], paths[0]);
        } else {
          openTextCompare(paths[0], '', paths[0]);
        }
      }
    });
  }

  // 4. Tool Cards on Home Screen
  document.querySelectorAll('.tool-card').forEach(card => {
    card.addEventListener('dragenter', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      card.classList.add('drag-over-card');
    });

    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });

    card.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      card.classList.remove('drag-over-card');
    });

    card.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      card.classList.remove('drag-over-card');
      if (homeMain) homeMain.classList.remove('drag-over-home');

      const paths = extractPathsFromDataTransfer(e.dataTransfer);
      if (paths.length === 0) return;

      const onclickAttr = card.getAttribute('onclick') || '';
      if (onclickAttr.includes('folder_merge')) {
        openFolderMerge(paths[0] || '', paths[1] || '', paths[2] || '', 'Folder Merge');
      } else if (onclickAttr.includes('folder_sync')) {
        openFolderSync(paths[0] || '', paths[1] || '', 'Folder Sync');
      } else if (onclickAttr.includes('folder_compare') || onclickAttr.includes('folder_')) {
        openFolderCompare(paths[0] || '', paths[1] || '', 'Folder Compare');
      } else if (onclickAttr.includes('text_merge')) {
        openTextMerge(paths[0] || '', paths[1] || '', paths[2] || '', 'Text Merge');
      } else if (onclickAttr.includes('text_edit')) {
        openTextEdit(paths[0] || '', 'Text Edit');
      } else if (onclickAttr.includes('text_compare') || onclickAttr.includes('text_')) {
        openTextCompare(paths[0] || '', paths[1] || '', paths[0] || 'Text Compare');
      } else if (onclickAttr.includes('hex_')) {
        openHexCompare(paths[0] || '', paths[1] || '', paths[0] || 'Hex Compare');
      } else if (onclickAttr.includes('picture_')) {
        openPictureCompare(paths[0] || '', paths[1] || '', paths[0] || 'Picture Compare');
      } else if (onclickAttr.includes('media_')) {
        openMediaCompare(paths[0] || '', paths[1] || '', paths[0] || 'Media Compare');
      } else if (onclickAttr.includes('table_')) {
        openTableCompare(paths[0] || '', paths[1] || '', paths[0] || 'Table Compare');
      } else {
        const isDir = await isDirectoryPath(paths[0]);
        if (isDir) {
          openFolderCompare(paths[0] || '', paths[1] || '', 'Folder Compare');
        } else {
          openTextCompare(paths[0] || '', paths[1] || '', paths[0] || 'Text Compare');
        }
      }
    });
  });

  // 5. Hex Compare Panes (Left & Right)
  const hexPanes = [
    { wrapperId: 'hexLeftPaneWrapper', side: 'left' },
    { wrapperId: 'hexRightPaneWrapper', side: 'right' }
  ];
  hexPanes.forEach(({ wrapperId, side }) => {
    const wrapper = document.getElementById(wrapperId);
    if (!wrapper) return;
    let dragCount = 0;
    wrapper.addEventListener('dragenter', (e) => {
      e.preventDefault(); e.stopPropagation(); dragCount++;
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      wrapper.classList.add('drag-over-pane');
    });
    wrapper.addEventListener('dragover', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    wrapper.addEventListener('dragleave', (e) => {
      e.preventDefault(); e.stopPropagation(); dragCount--;
      if (dragCount <= 0) { dragCount = 0; wrapper.classList.remove('drag-over-pane'); }
    });
    wrapper.addEventListener('drop', async (e) => {
      e.preventDefault(); e.stopPropagation(); dragCount = 0;
      wrapper.classList.remove('drag-over-pane');
      const paths = extractPathsFromDataTransfer(e.dataTransfer);
      if (paths.length === 0) return;
      if (paths.length >= 2) {
        openHexCompare(paths[0], paths[1]);
        return;
      }
      await loadHexFileForSide(side, paths[0]);
    });
  });

  // 6. Picture Compare Panes (Left & Right)
  const picPanes = [
    { wrapperId: 'picLeftPaneWrapper', side: 'left' },
    { wrapperId: 'picRightPaneWrapper', side: 'right' }
  ];
  picPanes.forEach(({ wrapperId, side }) => {
    const wrapper = document.getElementById(wrapperId);
    if (!wrapper) return;
    let dragCount = 0;
    wrapper.addEventListener('dragenter', (e) => {
      e.preventDefault(); e.stopPropagation(); dragCount++;
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      wrapper.classList.add('drag-over-pane');
    });
    wrapper.addEventListener('dragover', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    wrapper.addEventListener('dragleave', (e) => {
      e.preventDefault(); e.stopPropagation(); dragCount--;
      if (dragCount <= 0) { dragCount = 0; wrapper.classList.remove('drag-over-pane'); }
    });
    wrapper.addEventListener('drop', async (e) => {
      e.preventDefault(); e.stopPropagation(); dragCount = 0;
      wrapper.classList.remove('drag-over-pane');
      const paths = extractPathsFromDataTransfer(e.dataTransfer);
      if (paths.length === 0) return;
      if (paths.length >= 2) {
        openPictureCompare(paths[0], paths[1]);
        return;
      }
      await loadPicFileForSide(side, paths[0]);
    });
  });

  // 7. Table Compare Panes (Left & Right) & View
  const tblPanes = [
    { wrapperId: 'tblLeftPaneWrapper', inputId: 'tblLeftPathInput', side: 'left' },
    { wrapperId: 'tblRightPaneWrapper', inputId: 'tblRightPathInput', side: 'right' }
  ];
  tblPanes.forEach(({ wrapperId, inputId, side }) => {
    const wrapper = document.getElementById(wrapperId);
    const input = document.getElementById(inputId);
    const handleDrop = async (e) => {
      e.preventDefault(); e.stopPropagation();
      if (wrapper) wrapper.classList.remove('drag-over-pane');
      const paths = extractPathsFromDataTransfer(e.dataTransfer);
      if (paths.length === 0) return;
      if (paths.length >= 2) {
        openTableCompare(paths[0], paths[1]);
        return;
      }
      await loadTableFileForSide(side, paths[0]);
    };

    [wrapper, input].filter(Boolean).forEach(el => {
      let dragCount = 0;
      el.addEventListener('dragenter', (e) => {
        e.preventDefault(); e.stopPropagation(); dragCount++;
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        if (wrapper) wrapper.classList.add('drag-over-pane');
      });
      el.addEventListener('dragover', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      });
      el.addEventListener('dragleave', (e) => {
        e.preventDefault(); e.stopPropagation(); dragCount--;
        if (dragCount <= 0) { dragCount = 0; if (wrapper) wrapper.classList.remove('drag-over-pane'); }
      });
      el.addEventListener('drop', (e) => { dragCount = 0; handleDrop(e); });
    });
  });

  const tblView = document.getElementById('tableCompareView');
  if (tblView) {
    tblView.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    tblView.addEventListener('drop', async (e) => {
      e.preventDefault();
      const paths = extractPathsFromDataTransfer(e.dataTransfer);
      if (paths.length === 0) return;
      if (paths.length >= 2) {
        openTableCompare(paths[0], paths[1]);
      } else if (paths.length === 1) {
        if (!tableCompareState.leftPath) {
          await loadTableFileForSide('left', paths[0]);
        } else if (!tableCompareState.rightPath) {
          await loadTableFileForSide('right', paths[0]);
        } else {
          await loadTableFileForSide('left', paths[0]);
        }
      }
    });
  }

  // 8. Media Compare (Inputs & Table Body)
  const mediaTargets = [
    { id: 'mediaLeftPathInput', side: 'left' },
    { id: 'mediaRightPathInput', side: 'right' },
    { id: 'mediaTagsTable', side: 'both' }
  ];
  mediaTargets.forEach(({ id, side }) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('dragover', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    el.addEventListener('drop', async (e) => {
      e.preventDefault(); e.stopPropagation();
      const paths = extractPathsFromDataTransfer(e.dataTransfer);
      if (paths.length === 0) return;
      if (paths.length >= 2 || side === 'both') {
        openMediaCompare(paths[0] || '', paths[1] || '', paths[0] || 'Media Compare');
      } else {
        await loadMediaFileForSide(side, paths[0]);
      }
    });
  });

  // 9. Folder Sync (Left & Right path boxes & table)
  const syncTargets = [
    { id: 'syncLeftPathBox', side: 'left' },
    { id: 'syncRightPathBox', side: 'right' },
    { id: 'folderSyncTableBody', side: 'both' }
  ];
  syncTargets.forEach(({ id, side }) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('dragover', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    el.addEventListener('drop', async (e) => {
      e.preventDefault(); e.stopPropagation();
      const paths = extractPathsFromDataTransfer(e.dataTransfer);
      if (paths.length === 0) return;
      if (paths.length >= 2 || side === 'both') {
        openFolderSync(paths[0] || '', paths[1] || '', 'Folder Sync');
      } else if (side === 'left') {
        appState.syncLeftPath = paths[0];
        const inL = document.getElementById('syncLeftPathInput');
        if (inL) inL.value = paths[0];
        computeFolderSyncPlan();
      } else if (side === 'right') {
        appState.syncRightPath = paths[0];
        const inR = document.getElementById('syncRightPathInput');
        if (inR) inR.value = paths[0];
        computeFolderSyncPlan();
      }
    });
  });

  // 10. Folder Merge (3-Way: Left, Base, Right path boxes, inputs, table & view)
  const fMergePanes = [
    { boxId: 'fMergeLeftBox', inputId: 'fMergeLeftPathInput', pos: 'left' },
    { boxId: 'fMergeBaseBox', inputId: 'fMergeBasePathInput', pos: 'base' },
    { boxId: 'fMergeRightBox', inputId: 'fMergeRightPathInput', pos: 'right' }
  ];

  fMergePanes.forEach(({ boxId, inputId, pos }) => {
    const box = document.getElementById(boxId);
    const input = document.getElementById(inputId);
    const handleDrop = async (e) => {
      e.preventDefault(); e.stopPropagation();
      if (box) box.classList.remove('drag-over-pane');
      const paths = extractPathsFromDataTransfer(e.dataTransfer);
      if (paths.length === 0) return;
      if (paths.length >= 3) {
        openFolderMerge(paths[0], paths[1], paths[2], 'Folder Merge');
        return;
      }
      if (paths.length === 2) {
        await loadFolderMergeForSide('left', paths[0]);
        await loadFolderMergeForSide('right', paths[1]);
        return;
      }
      await loadFolderMergeForSide(pos, paths[0]);
    };

    [box, input].filter(Boolean).forEach(el => {
      let dragCount = 0;
      el.addEventListener('dragenter', (e) => {
        e.preventDefault(); e.stopPropagation(); dragCount++;
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        if (box) box.classList.add('drag-over-pane');
      });
      el.addEventListener('dragover', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      });
      el.addEventListener('dragleave', (e) => {
        e.preventDefault(); e.stopPropagation(); dragCount--;
        if (dragCount <= 0) { dragCount = 0; if (box) box.classList.remove('drag-over-pane'); }
      });
      el.addEventListener('drop', (e) => { dragCount = 0; handleDrop(e); });
    });
  });

  const fMergeTableContainer = document.getElementById('fMergeTableContainer');
  const fMergeTableBody = document.getElementById('folderMergeTableBody');
  const handleFMergeTableDrop = async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (fMergeTableContainer) fMergeTableContainer.classList.remove('drag-over-pane');
    const paths = extractPathsFromDataTransfer(e.dataTransfer);
    if (paths.length === 0) return;
    if (paths.length >= 3) {
      openFolderMerge(paths[0], paths[1], paths[2], 'Folder Merge');
    } else if (paths.length === 2) {
      await loadFolderMergeForSide('left', paths[0]);
      await loadFolderMergeForSide('right', paths[1]);
    } else if (paths.length === 1) {
      if (!folderMergeState.leftPath) {
        await loadFolderMergeForSide('left', paths[0]);
      } else if (!folderMergeState.basePath) {
        await loadFolderMergeForSide('base', paths[0]);
      } else if (!folderMergeState.rightPath) {
        await loadFolderMergeForSide('right', paths[0]);
      } else {
        await loadFolderMergeForSide('left', paths[0]);
      }
    }
  };

  [fMergeTableContainer, fMergeTableBody].filter(Boolean).forEach(el => {
    let dragCount = 0;
    el.addEventListener('dragenter', (e) => {
      e.preventDefault(); e.stopPropagation(); dragCount++;
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      if (fMergeTableContainer) fMergeTableContainer.classList.add('drag-over-pane');
    });
    el.addEventListener('dragover', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    el.addEventListener('dragleave', (e) => {
      e.preventDefault(); e.stopPropagation(); dragCount--;
      if (dragCount <= 0) { dragCount = 0; if (fMergeTableContainer) fMergeTableContainer.classList.remove('drag-over-pane'); }
    });
    el.addEventListener('drop', (e) => { dragCount = 0; handleFMergeTableDrop(e); });
  });

  const fMergeView = document.getElementById('folderMergeView');
  if (fMergeView) {
    fMergeView.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    fMergeView.addEventListener('drop', (e) => handleFMergeTableDrop(e));
  }

  // 11. Text Merge (3-Way: Left, Base, Right Panes, inputs, upper container & view)
  const tMergePanes = [
    { paneId: 'tMergeLeftPane', inputId: 'tMergeLeftPathInput', pos: 'left' },
    { paneId: 'tMergeCenterPane', inputId: 'tMergeBasePathInput', pos: 'base' },
    { paneId: 'tMergeRightPane', inputId: 'tMergeRightPathInput', pos: 'right' }
  ];

  tMergePanes.forEach(({ paneId, inputId, pos }) => {
    const pane = document.getElementById(paneId);
    const input = document.getElementById(inputId);
    const handleDrop = async (e) => {
      e.preventDefault(); e.stopPropagation();
      if (pane) pane.classList.remove('drag-over-pane');
      const paths = extractPathsFromDataTransfer(e.dataTransfer);
      if (paths.length === 0) return;
      if (paths.length >= 3) {
        openTextMerge(paths[0], paths[1], paths[2], 'Text Merge');
        return;
      }
      if (paths.length === 2) {
        await loadTMergeFileForSide('left', paths[0]);
        await loadTMergeFileForSide('right', paths[1]);
        return;
      }
      await loadTMergeFileForSide(pos, paths[0]);
    };

    [pane, input].filter(Boolean).forEach(el => {
      let dragCount = 0;
      el.addEventListener('dragenter', (e) => {
        e.preventDefault(); e.stopPropagation(); dragCount++;
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        if (pane) pane.classList.add('drag-over-pane');
      });
      el.addEventListener('dragover', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      });
      el.addEventListener('dragleave', (e) => {
        e.preventDefault(); e.stopPropagation(); dragCount--;
        if (dragCount <= 0) { dragCount = 0; if (pane) pane.classList.remove('drag-over-pane'); }
      });
      el.addEventListener('drop', (e) => { dragCount = 0; handleDrop(e); });
    });
  });

  const tMergeUpper = document.getElementById('textMergeUpperPanes');
  const tMergeView = document.getElementById('textMergeView');
  const handleTMergeGeneralDrop = async (e) => {
    e.preventDefault(); e.stopPropagation();
    const paths = extractPathsFromDataTransfer(e.dataTransfer);
    if (paths.length === 0) return;
    if (paths.length >= 3) {
      openTextMerge(paths[0], paths[1], paths[2], 'Text Merge');
    } else if (paths.length === 2) {
      await loadTMergeFileForSide('left', paths[0]);
      await loadTMergeFileForSide('right', paths[1]);
    } else if (paths.length === 1) {
      if (!textMergeState.leftPath) {
        await loadTMergeFileForSide('left', paths[0]);
      } else if (!textMergeState.basePath) {
        await loadTMergeFileForSide('base', paths[0]);
      } else if (!textMergeState.rightPath) {
        await loadTMergeFileForSide('right', paths[0]);
      } else {
        await loadTMergeFileForSide('left', paths[0]);
      }
    }
  };

  [tMergeUpper, tMergeView].filter(Boolean).forEach(el => {
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    el.addEventListener('drop', (e) => handleTMergeGeneralDrop(e));
  });

  // 12. Text Edit (Editor & Input)
  const editTargets = ['textEditMainTextarea', 'textEditPathInput'];
  editTargets.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('dragover', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    el.addEventListener('drop', async (e) => {
      e.preventDefault(); e.stopPropagation();
      const paths = extractPathsFromDataTransfer(e.dataTransfer);
      if (paths.length > 0) {
        openTextEdit(paths[0], 'Text Edit');
      }
    });
  });
}

// --- HIGH-PERFORMANCE VIRTUAL SCROLLING ENGINE FOR TEXT COMPARE (Beyond Compare 5) ---
const TEXT_ROW_HEIGHT = 20;
let virtualTextState = {
  lastRenderedStart: -1,
  lastRenderedEnd: -1,
  currentDiffResult: null,
  maxLineWidthPx: 900,
  lang: 'generic',
  secStartMap: new Map(),
  cacheL: new Map(),
  cacheR: new Map()
};

function renderTextDiff(diffResult) {
  if (!diffResult) return;

  const containerL = document.getElementById('textLeftLines');
  const containerR = document.getElementById('textRightLines');
  const gutter = document.getElementById('textCenterGutter');
  const rail = document.getElementById('textOverviewRail');
  const markersContainer = document.getElementById('overviewMarkersContainer') || rail;
  const badge = document.getElementById('textDiffBadge');

  if (!containerL || !containerR) return;

  const totalRows = diffResult.totalRows || 0;
  const sections = diffResult.sections || [];
  const sectionCount = diffResult.sectionCount !== undefined ? diffResult.sectionCount : sections.length;
  const lang = detectLanguage(appState.currentTextFile.leftFullPath || appState.currentTextFile.rightFullPath || appState.currentTextFile.relativePath);
  updateTextFormatBadges();

  // Update Status Badge
  if (badge) {
    if (diffResult.isSingleSide) {
      badge.textContent = diffResult.isSingleSide === 'left'
        ? 'Left file loaded — Select right file to compare'
        : 'Right file loaded — Select left file to compare';
      badge.style.background = 'rgba(74, 222, 128, 0.15)';
      badge.style.color = '#4ade80';
    } else if (sectionCount === 0) {
      badge.textContent = '0 differences (Identical)';
      badge.style.background = 'rgba(74, 222, 128, 0.15)';
      badge.style.color = '#4ade80';
    } else {
      badge.textContent = `${sectionCount} difference section${sectionCount > 1 ? 's' : ''}`;
      badge.style.background = 'rgba(224, 82, 82, 0.2)';
      badge.style.color = '#ff8080';
    }
  }

  // Pre-calculate longest line for rock-solid horizontal width (zero layout reflow during scroll)
  const rows = diffResult.rows || [];
  let maxChars = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.leftText && r.leftText.length > maxChars) maxChars = r.leftText.length;
    if (r.rightText && r.rightText.length > maxChars) maxChars = r.rightText.length;
  }
  const maxLineWidthPx = Math.max(900, Math.ceil(maxChars * 8.6 + 100));

  // Initialize Virtual Scrolling State
  virtualTextState.currentDiffResult = diffResult;
  virtualTextState.lastRenderedStart = -1;
  virtualTextState.lastRenderedEnd = -1;
  virtualTextState.maxLineWidthPx = maxLineWidthPx;
  virtualTextState.lang = lang;
  virtualTextState.cacheL.clear();
  virtualTextState.cacheR.clear();
  virtualTextState.secStartMap.clear();

  for (let sIdx = 0; sIdx < sections.length; sIdx++) {
    virtualTextState.secStartMap.set(sections[sIdx].startRow, sections[sIdx]);
  }

  const totalHeight = totalRows * TEXT_ROW_HEIGHT;
  containerL.style.height = `${totalHeight}px`;
  containerR.style.height = `${totalHeight}px`;
  containerL.style.minWidth = `${maxLineWidthPx}px`;
  containerR.style.minWidth = `${maxLineWidthPx}px`;
  if (gutter) gutter.style.height = `${totalHeight}px`;

  // Render initial visible window instantly (< 5ms)
  renderVisibleTextWindow(true);

  // Render Overview Rail (Differences minimap strip beside line numbers)
  if (markersContainer) {
    markersContainer.innerHTML = '';
    if (totalRows > 0 && !diffResult.isSingleSide) {
      for (let sIdx = 0; sIdx < sections.length; sIdx++) {
        const sec = sections[sIdx];
        const topPct = (sec.startRow / totalRows) * 100;
        const rowSpan = Math.max(1, sec.endRow - sec.startRow + 1);
        const heightPct = Math.max(1.8, (rowSpan / totalRows) * 100);

        const marker = document.createElement('div');
        marker.className = 'overview-marker';
        marker.style.top = `${topPct}%`;
        marker.style.height = `${heightPct}%`;
        marker.title = `Difference section ${sec.index + 1} (${rowSpan} lines) - Click to jump directly`;
        marker.onclick = (e) => {
          e.stopPropagation();
          jumpToSection(sec.index);
        };
        markersContainer.appendChild(marker);
      }
    }
  }

  updateOverviewViewport();
  if (typeof textSyncScrollbar !== 'undefined' && textSyncScrollbar) textSyncScrollbar.update();

  // Auto-jump to first difference section if any
  if (sections.length > 0 && !diffResult.isSingleSide) {
    jumpToSection(0);
  }
}

function renderVisibleTextWindow(force = false) {
  const diffResult = virtualTextState.currentDiffResult;
  if (!diffResult || !diffResult.totalRows) return;

  const scrollL = document.getElementById('textLeftScroll');
  const scrollR = document.getElementById('textRightScroll');
  const containerL = document.getElementById('textLeftLines');
  const containerR = document.getElementById('textRightLines');
  const gutter = document.getElementById('textCenterGutter');
  if (!scrollL || !containerL || !containerR) return;

  const scrollTop = Math.round(scrollL ? scrollL.scrollTop : 0);
  const viewportHeight = scrollL.clientHeight || 600;
  const totalRows = diffResult.totalRows;

  const firstVis = Math.floor(scrollTop / TEXT_ROW_HEIGHT);
  const lastVis = Math.ceil((scrollTop + viewportHeight) / TEXT_ROW_HEIGHT);

  const atTop = virtualTextState.lastRenderedStart === 0 && firstVis <= 8;
  const atBottom = virtualTextState.lastRenderedEnd >= totalRows && lastVis >= totalRows - 8;

  // Safe buffer thresholding: skip DOM rebuild if visible rows are safely within rendered buffer
  if (!force &&
      virtualTextState.lastRenderedStart >= 0 &&
      (firstVis >= virtualTextState.lastRenderedStart + 8 || atTop) &&
      (lastVis <= virtualTextState.lastRenderedEnd - 8 || atBottom)) {
    return;
  }

  // Window calculation with 40 rows overscan (buffer above and below)
  const overscan = 40;
  const startIndex = Math.max(0, firstVis - overscan);
  const endIndex = Math.min(totalRows, lastVis + overscan);

  // Skip DOM rebuild if window didn't shift
  if (!force && startIndex === virtualTextState.lastRenderedStart && endIndex === virtualTextState.lastRenderedEnd) {
    return;
  }

  virtualTextState.lastRenderedStart = startIndex;
  virtualTextState.lastRenderedEnd = endIndex;

  const topHeight = startIndex * TEXT_ROW_HEIGHT;
  const bottomHeight = Math.max(0, (totalRows - endIndex) * TEXT_ROW_HEIGHT);

  const rows = diffResult.rows || [];
  const lang = virtualTextState.lang;
  const secStartMap = virtualTextState.secStartMap;
  const cacheL = virtualTextState.cacheL;
  const cacheR = virtualTextState.cacheR;

  let htmlL = topHeight > 0 ? `<div class="text-virtual-spacer" style="height:${topHeight}px; width:100%;"></div>` : '';
  let htmlR = topHeight > 0 ? `<div class="text-virtual-spacer" style="height:${topHeight}px; width:100%;"></div>` : '';

  for (let i = startIndex; i < endIndex; i++) {
    const row = rows[i];
    if (!row) continue;

    // Check cached HTML for left row
    let rowHtmlL = cacheL.get(i);
    if (!rowHtmlL) {
      let btnHtmlL = '';
      if (secStartMap.has(i)) {
        const sec = secStartMap.get(i);
        btnHtmlL = `<div class="line-gutter-action to-right" title="Copy section ${sec.index + 1} to Right (take Left version)" onclick="event.stopPropagation(); copyDiffSection(${sec.index}, 'to_right')">▶</div>`;
      }
      if (row.type === 'same') {
        rowHtmlL = `<div class="text-line-row" id="row-l-${i}"><div class="text-line-num">${row.leftNum || ''}</div><div class="text-line-content">${highlightSyntax(row.leftText, lang, false, false)}</div></div>`;
      } else if (row.isGhostL) {
        rowHtmlL = `<div class="text-line-row ghost-hatched" id="row-l-${i}"><div class="text-line-num">${btnHtmlL}</div><div class="text-line-content"></div></div>`;
      } else {
        const isCommL = row.isCommentL;
        const clsL = isCommL ? 'diff-comment' : 'diff-code';
        rowHtmlL = `<div class="text-line-row ${clsL}" id="row-l-${i}"><div class="text-line-num">${btnHtmlL}${row.leftNum || ''}</div><div class="text-line-content">${highlightSyntax(row.leftText, lang, true, isCommL)}</div></div>`;
      }
      cacheL.set(i, rowHtmlL);
    }
    htmlL += rowHtmlL;

    // Check cached HTML for right row
    let rowHtmlR = cacheR.get(i);
    if (!rowHtmlR) {
      if (row.type === 'same') {
        rowHtmlR = `<div class="text-line-row" id="row-r-${i}"><div class="text-line-num">${row.rightNum || ''}</div><div class="text-line-content">${highlightSyntax(row.rightText, lang, false, false)}</div></div>`;
      } else if (row.isGhostR) {
        rowHtmlR = `<div class="text-line-row ghost-hatched" id="row-r-${i}"><div class="text-line-num"></div><div class="text-line-content"></div></div>`;
      } else {
        const isCommR = row.isCommentR;
        const clsR = isCommR ? 'diff-comment' : 'diff-code';
        rowHtmlR = `<div class="text-line-row ${clsR}" id="row-r-${i}"><div class="text-line-num">${row.rightNum || ''}</div><div class="text-line-content">${highlightSyntax(row.rightText, lang, true, isCommR)}</div></div>`;
      }
      cacheR.set(i, rowHtmlR);
    }
    htmlR += rowHtmlR;
  }

  if (bottomHeight > 0) {
    htmlL += `<div class="text-virtual-spacer" style="height:${bottomHeight}px; width:100%;"></div>`;
    htmlR += `<div class="text-virtual-spacer" style="height:${bottomHeight}px; width:100%;"></div>`;
  }

  if (diffResult.isSingleSide === 'left') {
    containerL.innerHTML = htmlL;
    containerR.innerHTML = `<div class="text-empty-dropzone" onclick="browseTextFile('right')"><div class="dropzone-icon">📄</div><div>Drop right file here, or click 📁 to browse</div></div>`;
    containerR.style.height = '100%';
  } else if (diffResult.isSingleSide === 'right') {
    containerR.innerHTML = htmlR;
    containerL.innerHTML = `<div class="text-empty-dropzone" onclick="browseTextFile('left')"><div class="dropzone-icon">📄</div><div>Drop left file here, or click 📁 to browse</div></div>`;
    containerL.style.height = '100%';
  } else {
    containerL.innerHTML = htmlL;
    containerR.innerHTML = htmlR;
  }

  // Render ONLY visible center gutter action arrows
  if (gutter) {
    const sections = diffResult.sections || [];
    let gutterHtml = '';
    for (let sIdx = 0; sIdx < sections.length; sIdx++) {
      const sec = sections[sIdx];
      if (sec.startRow >= startIndex - 10 && sec.startRow <= endIndex + 10) {
        const topPx = sec.startRow * TEXT_ROW_HEIGHT;
        gutterHtml += `<div class="diff-arrow-btn" style="top:${topPx + 1}px;" title="Copy section ${sec.index + 1} to Left side (take right version)" onclick="event.stopPropagation(); copyDiffSection(${sec.index}, 'to_left')">◀</div>`;
      }
    }
    gutter.innerHTML = gutterHtml;
  }
}

function handleOverviewRailClick(event) {
  const rail = document.getElementById('textOverviewRail');
  if (!rail) return;
  const rect = rail.getBoundingClientRect();
  const clickY = event.clientY - rect.top;
  const pct = Math.max(0, Math.min(1, clickY / rect.height));
  const diffResult = appState.currentTextFile.diffResult;
  if (!diffResult || !diffResult.totalRows) return;

  const targetRow = Math.floor(pct * diffResult.totalRows);
  const scrollL = document.getElementById('textLeftScroll');
  const scrollR = document.getElementById('textRightScroll');
  const scrollG = document.getElementById('textGutterScroll');
  
  const halfView = (scrollL ? scrollL.clientHeight : 400) / 2;
  const targetTop = Math.max(0, targetRow * TEXT_ROW_HEIGHT - halfView + 10);

  textScrollDriver = 'programmatic';
  clearTimeout(textScrollTimer);
  textScrollTimer = setTimeout(() => {
    textScrollDriver = null;
  }, 150);

  if (scrollL) scrollL.scrollTop = targetTop;
  if (scrollR) scrollR.scrollTop = targetTop;
  if (scrollG) scrollG.scrollTop = targetTop;
  renderVisibleTextWindow(true);
  updateOverviewViewport();
  if (typeof textSyncScrollbar !== 'undefined' && textSyncScrollbar) textSyncScrollbar.update();
}

function setupOverviewRailDrag() {
  const rail = document.getElementById('textOverviewRail');
  if (!rail) return;

  let isDraggingRail = false;

  function scrollToPos(clientY) {
    const rect = rail.getBoundingClientRect();
    const clickY = clientY - rect.top;
    const pct = Math.max(0, Math.min(1, clickY / rect.height));
    const diffResult = appState.currentTextFile.diffResult;
    if (!diffResult || !diffResult.totalRows) return;

    const targetRow = Math.floor(pct * diffResult.totalRows);
    const scrollL = document.getElementById('textLeftScroll');
    const scrollR = document.getElementById('textRightScroll');
    const scrollG = document.getElementById('textGutterScroll');

    const halfView = (scrollL ? scrollL.clientHeight : 400) / 2;
    const targetTop = Math.max(0, targetRow * TEXT_ROW_HEIGHT - halfView + 10);

    textScrollDriver = 'custom_vscroll';

    if (scrollL) scrollL.scrollTop = targetTop;
    if (scrollR) scrollR.scrollTop = targetTop;
    if (scrollG) scrollG.scrollTop = targetTop;

    renderVisibleTextWindow();
    updateOverviewViewport();
    if (typeof textSyncScrollbar !== 'undefined' && textSyncScrollbar) textSyncScrollbar.update();
  }

  rail.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    isDraggingRail = true;
    try { rail.setPointerCapture(e.pointerId); } catch (_) {}
    scrollToPos(e.clientY);

    const onPointerMove = (ev) => {
      if (!isDraggingRail) return;
      ev.preventDefault();
      scrollToPos(ev.clientY);
    };

    const onPointerUp = (ev) => {
      if (!isDraggingRail) return;
      isDraggingRail = false;
      textScrollDriver = null;
      try { rail.releasePointerCapture(ev.pointerId); } catch (_) {}
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  });
}

function jumpToSection(sectionIndex) {
  const diffResult = appState.currentTextFile.diffResult;
  if (!diffResult || !diffResult.sections || !diffResult.sections[sectionIndex]) return;

  appState.currentTextFile.currentSectionIndex = sectionIndex;
  const sec = diffResult.sections[sectionIndex];
  
  const scrollL = document.getElementById('textLeftScroll');
  const scrollR = document.getElementById('textRightScroll');
  const scrollG = document.getElementById('textGutterScroll');

  const halfView = (scrollL ? scrollL.clientHeight : 400) / 2;
  const targetTop = Math.max(0, sec.startRow * TEXT_ROW_HEIGHT - halfView + 30);

  textScrollDriver = 'programmatic';
  clearTimeout(textScrollTimer);
  textScrollTimer = setTimeout(() => {
    textScrollDriver = null;
  }, 150);

  if (scrollL) scrollL.scrollTop = targetTop;
  if (scrollR) scrollR.scrollTop = targetTop;
  if (scrollG) scrollG.scrollTop = targetTop;
  renderVisibleTextWindow(true);
  updateOverviewViewport();
  if (typeof textSyncScrollbar !== 'undefined' && textSyncScrollbar) textSyncScrollbar.update();
}

function navDiff(direction) {
  const diffResult = appState.currentTextFile.diffResult;
  if (!diffResult || !diffResult.sections || diffResult.sections.length === 0) {
    showToast('No difference sections in this file', 'info');
    return;
  }

  let next = appState.currentTextFile.currentSectionIndex + direction;
  if (next < 0) next = diffResult.sections.length - 1;
  if (next >= diffResult.sections.length) next = 0;

  jumpToSection(next);
}

function updateOverviewViewport() {
  const scrollL = document.getElementById('textLeftScroll');
  const thumb = document.getElementById('overviewViewportThumb');
  const diffResult = appState.currentTextFile.diffResult;
  if (!scrollL || !thumb || !diffResult || !diffResult.totalRows) return;

  const totalHeight = diffResult.totalRows * TEXT_ROW_HEIGHT;
  if (totalHeight <= 0) return;

  const viewH = scrollL.clientHeight || 400;
  const scrollY = scrollL.scrollTop || 0;

  const topPct = (scrollY / totalHeight) * 100;
  const heightPct = Math.max(4, (viewH / totalHeight) * 100);

  thumb.style.top = `${topPct}%`;
  thumb.style.height = `${heightPct}%`;
}

// Beyond Compare 5 Rock-Solid Synchronized Text Scrolling Controller
let textScrollDriver = null;
let textScrollTimer = null;
let isSyncingText = false;
let activeTextScrollSource = null;
let textSyncScrollbar = null;

function setupTextSyncScroll() {
  const scrollL = document.getElementById('textLeftScroll');
  const scrollR = document.getElementById('textRightScroll');
  const scrollG = document.getElementById('textGutterScroll');
  const panes = document.querySelector('#textView .text-compare-panes') || document.querySelector('.text-compare-panes');
  if (!scrollL || !scrollR) return;

  textSyncScrollbar = createSyncVScrollbar({
    leftScroll: scrollL,
    rightScroll: scrollR,
    extraScrolls: scrollG ? [scrollG] : [],
    leftTrack: document.getElementById('textLeftVScroll'),
    leftThumb: document.getElementById('textLeftVThumb'),
    rightTrack: document.getElementById('textRightVScroll'),
    rightThumb: document.getElementById('textRightVThumb'),
    setDriver: (driver) => { textScrollDriver = driver; },
    onScroll: () => {
      renderVisibleTextWindow();
      updateOverviewViewport();
    }
  });

  // Zero-lag simultaneous wheel/trackpad scrolling across text compare panes
  if (panes) {
    panes.addEventListener('wheel', (e) => {
      e.preventDefault();
      textScrollDriver = 'wheel';
      clearTimeout(textScrollTimer);
      textScrollTimer = setTimeout(() => {
        textScrollDriver = null;
        activeTextScrollSource = null;
      }, 80);

      const maxScrollY = Math.max(
        0,
        Math.max(scrollL.scrollHeight, scrollR.scrollHeight) - scrollL.clientHeight
      );
      const deltaY = e.shiftKey ? 0 : e.deltaY;
      const newTop = Math.max(0, Math.min(maxScrollY, scrollL.scrollTop + deltaY));

      const maxScrollX = Math.max(
        0,
        Math.max(scrollL.scrollWidth, scrollR.scrollWidth) - scrollL.clientWidth
      );
      const deltaX = Math.abs(e.deltaX) > 0 ? e.deltaX : (e.shiftKey ? e.deltaY : 0);
      const newLeft = Math.max(0, Math.min(maxScrollX, scrollL.scrollLeft + deltaX));

      scrollL.scrollTop = newTop;
      scrollR.scrollTop = newTop;
      if (scrollG) scrollG.scrollTop = newTop;

      scrollL.scrollLeft = newLeft;
      scrollR.scrollLeft = newLeft;

      renderVisibleTextWindow();
      updateOverviewViewport();
      if (textSyncScrollbar) textSyncScrollbar.update();
    }, { passive: false });
  }

  window.addEventListener('resize', () => {
    syncHorizontalScrollWidths();
    renderVisibleTextWindow(true);
    if (textSyncScrollbar) textSyncScrollbar.update();
  });

  setupOverviewRailDrag();
}

function syncTextScroll(source) {
  if (textScrollDriver === 'wheel' || textScrollDriver === 'programmatic' || textScrollDriver === 'custom_vscroll') return;
  if (isSyncingText && activeTextScrollSource !== source) return;

  const scrollL = document.getElementById('textLeftScroll');
  const scrollR = document.getElementById('textRightScroll');
  const scrollG = document.getElementById('textGutterScroll');
  if (!scrollL || !scrollR) return;

  const src = (source === 'left') ? scrollL : scrollR;
  const target = (source === 'left') ? scrollR : scrollL;

  if (Math.abs(target.scrollTop - src.scrollTop) <= 0.5 && Math.abs(target.scrollLeft - src.scrollLeft) <= 0.5) {
    return;
  }

  isSyncingText = true;
  activeTextScrollSource = source;

  target.scrollTop = src.scrollTop;
  target.scrollLeft = src.scrollLeft;
  if (scrollG) {
    scrollG.scrollTop = src.scrollTop;
  }

  renderVisibleTextWindow();
  updateOverviewViewport();
  if (textSyncScrollbar) textSyncScrollbar.update();

  requestAnimationFrame(() => {
    isSyncingText = false;
    activeTextScrollSource = null;
  });
}

function syncHorizontalScrollWidths() {
  const containerL = document.getElementById('textLeftLines');
  const containerR = document.getElementById('textRightLines');
  const scrollL = document.getElementById('textLeftScroll');
  if (!containerL || !containerR || !scrollL) return;

  if (scrollL.classList.contains('word-wrap-enabled')) {
    containerL.style.minWidth = '100%';
    containerR.style.minWidth = '100%';
    if (textSyncScrollbar) textSyncScrollbar.update();
    return;
  }

  const w = virtualTextState.maxLineWidthPx || 900;
  containerL.style.minWidth = `${w}px`;
  containerR.style.minWidth = `${w}px`;
  if (textSyncScrollbar) textSyncScrollbar.update();
}

async function copyDiffSection(sectionIndex, direction) {
  const diffResult = appState.currentTextFile.diffResult;
  if (!diffResult || !diffResult.sections || !diffResult.sections[sectionIndex]) return;

  const sec = diffResult.sections[sectionIndex];

  if (direction === 'to_left') {
    let leftLines = appState.currentTextFile.leftContent ? appState.currentTextFile.leftContent.split(/\r\n|\r|\n/) : [];
    if (leftLines.length > 0 && leftLines[leftLines.length - 1] === '' && appState.currentTextFile.leftContent.endsWith('\n')) {
      leftLines.pop();
    }
    leftLines.splice(sec.origStartLeft - 1, sec.leftLineCount, ...sec.rightLines);
    appState.currentTextFile.leftContent = leftLines.join('\n') + '\n';

    const saveBtn = document.getElementById('btnSaveLeft');
    if (saveBtn) {
      saveBtn.style.boxShadow = '0 0 10px #388bfd';
    }
    showToast(`Copied section ${sectionIndex + 1} (${sec.rightLineCount} lines) to Left. Click '💾 Save Left' to write.`, 'success');
  } else if (direction === 'to_right') {
    let rightLines = appState.currentTextFile.rightContent ? appState.currentTextFile.rightContent.split(/\r\n|\r|\n/) : [];
    if (rightLines.length > 0 && rightLines[rightLines.length - 1] === '' && appState.currentTextFile.rightContent.endsWith('\n')) {
      rightLines.pop();
    }
    rightLines.splice(sec.origStartRight - 1, sec.rightLineCount, ...sec.leftLines);
    appState.currentTextFile.rightContent = rightLines.join('\n') + '\n';

    const saveBtn = document.getElementById('btnSaveRight');
    if (saveBtn) {
      saveBtn.style.boxShadow = '0 0 10px #388bfd';
    }
    showToast(`Copied section ${sectionIndex + 1} (${sec.leftLineCount} lines) to Right. Click '💾 Save Right' to write.`, 'success');
  }

  // Recalculate Aligned Diff with updated memory content
  const updatedDiff = await window.api.computeAlignedDiff(
    appState.currentTextFile.leftContent,
    appState.currentTextFile.rightContent
  );
  appState.currentTextFile.diffResult = updatedDiff;
  renderTextDiff(updatedDiff);
}

function copyCurrentSectionToLeft() {
  const diffResult = appState.currentTextFile.diffResult;
  if (!diffResult || !diffResult.sections || diffResult.sections.length === 0) return;
  const idx = appState.currentTextFile.currentSectionIndex >= 0 ? appState.currentTextFile.currentSectionIndex : 0;
  copyDiffSection(idx, 'to_left');
}

function copyCurrentSectionToRight() {
  const diffResult = appState.currentTextFile.diffResult;
  if (!diffResult || !diffResult.sections || diffResult.sections.length === 0) return;
  const idx = appState.currentTextFile.currentSectionIndex >= 0 ? appState.currentTextFile.currentSectionIndex : 0;
  copyDiffSection(idx, 'to_right');
}

async function copyBlockLeftToRight() {
  if (!appState.currentTextFile.rightFullPath) return;
  const content = appState.currentTextFile.leftContent;
  await window.api.writeTextFile(appState.currentTextFile.rightFullPath, content);
  appendLog(`Copied entire content left -> right.`);
  showToast('Copied entire Left file into Right file', 'success');
  openTextCompare(appState.currentTextFile.leftFullPath, appState.currentTextFile.rightFullPath, appState.currentTextFile.relativePath);
}

async function copyBlockRightToLeft() {
  if (!appState.currentTextFile.leftFullPath) return;
  const content = appState.currentTextFile.rightContent;
  await window.api.writeTextFile(appState.currentTextFile.leftFullPath, content);
  appendLog(`Copied entire content right -> left.`);
  showToast('Copied entire Right file into Left file', 'success');
  openTextCompare(appState.currentTextFile.leftFullPath, appState.currentTextFile.rightFullPath, appState.currentTextFile.relativePath);
}

async function saveTextFile(side) {
  const file = appState.currentTextFile;
  const path = side === 'left' ? file.leftFullPath : file.rightFullPath;
  const content = side === 'left' ? file.leftContent : file.rightContent;
  const saveBtn = side === 'left' ? document.getElementById('btnSaveLeft') : document.getElementById('btnSaveRight');
  
  if (path) {
    await window.api.writeTextFile(path, content);
    if (side === 'left') file.originalLeftContent = content;
    else file.originalRightContent = content;

    if (saveBtn) saveBtn.style.boxShadow = '';
    appendLog(`Saved ${side} file: ${path}`);
    showToast(`Saved ${side} file successfully!`, 'success');
    
    // If files are now identical, notify folder view
    if (file.diffResult && file.diffResult.sectionCount === 0) {
      runFolderComparison();
    }
  } else {
    showToast(`Cannot save: ${side} file has no valid path`, 'error');
  }
}

// --- HELPER: RESOLVE SELECTED COMPARISON ITEMS (EXPANDS DIRECTORIES RECURSIVELY) ---
function getSelectedOrAllComparisonItems() {
  if (appState.selectedIndices && appState.selectedIndices.size > 0) {
    const selectedFilteredItems = Array.from(appState.selectedIndices)
      .map(idx => appState.filteredItems[idx])
      .filter(Boolean);

    if (selectedFilteredItems.length > 0) {
      const targetExact = new Set();
      const targetPrefixes = [];

      selectedFilteredItems.forEach(item => {
        targetExact.add(item.relativePath);
        if (item.isDirectory) {
          targetPrefixes.push(item.relativePath.endsWith('/') ? item.relativePath : item.relativePath + '/');
        }
      });

      return appState.comparisonItems.filter(it => {
        if (targetExact.has(it.relativePath)) return true;
        for (let p = 0; p < targetPrefixes.length; p++) {
          if (it.relativePath.startsWith(targetPrefixes[p])) return true;
        }
        return false;
      });
    }
  }
  return appState.comparisonItems;
}

// --- MODAL: DEEP COMPARE [=? Compare] ---
function openDeepCompareModal() {
  const isSelectionActive = appState.selectedIndices && appState.selectedIndices.size > 0;
  const items = getSelectedOrAllComparisonItems();

  let leftFiles = 0, leftFolders = 0, leftBytes = 0;
  let rightFiles = 0, rightFolders = 0, rightBytes = 0;

  items.forEach(it => {
    if (it.left) {
      if (it.isDirectory) leftFolders++;
      else { leftFiles++; leftBytes += it.left.size || 0; }
    }
    if (it.right) {
      if (it.isDirectory) rightFolders++;
      else { rightFiles++; rightBytes += it.right.size || 0; }
    }
  });

  document.getElementById('modalLeftFiles').textContent = leftFiles;
  document.getElementById('modalLeftFolders').textContent = leftFolders;
  document.getElementById('modalLeftBytes').textContent = formatBytes(leftBytes);

  document.getElementById('modalRightFiles').textContent = rightFiles;
  document.getElementById('modalRightFolders').textContent = rightFolders;
  document.getElementById('modalRightBytes').textContent = formatBytes(rightBytes);

  const legend = document.querySelector('#deepCompareModal legend');
  if (legend) {
    legend.textContent = isSelectionActive
      ? `Selection (${appState.selectedIndices.size} item${appState.selectedIndices.size > 1 ? 's' : ''} selected)`
      : 'Session Selection (All items)';
  }

  // Restore saved Auto-close preference (default true)
  const savedAutoClose = localStorage.getItem('diffcore_auto_close');
  if (savedAutoClose !== null) {
    document.getElementById('chkAutoClose').checked = (savedAutoClose === 'true');
  } else {
    document.getElementById('chkAutoClose').checked = true;
  }

  document.getElementById('deepCompareModal').classList.add('active');
  document.getElementById('deepCompareProgress').style.display = 'none';
  document.getElementById('deepProgressBar').style.width = '0%';
}

function closeDeepCompareModal() {
  document.getElementById('deepCompareModal').classList.remove('active');
}

async function executeDeepCompare() {
  const selectedRadio = document.querySelector('input[name="compareMethod"]:checked');
  const method = selectedRadio ? selectedRadio.value : 'rules';
  const skipBinary = document.getElementById('chkSkipBinary').checked;
  const autoClose = document.getElementById('chkAutoClose').checked;
  try {
    localStorage.setItem('diffcore_auto_close', String(autoClose));
  } catch {}

  const progress = document.getElementById('deepCompareProgress');
  const bar = document.getElementById('deepProgressBar');
  const status = document.getElementById('deepCompareStatusText');

  progress.style.display = 'block';
  status.textContent = `Running ${method.toUpperCase()} comparison...`;
  bar.style.width = '30%';

  const targetItems = getSelectedOrAllComparisonItems();
  const itemsToCompare = targetItems.filter(it => !it.isDirectory && it.left && it.right);

  if (itemsToCompare.length === 0) {
    status.textContent = 'No matching files to compare in selection.';
    bar.style.width = '100%';
    setTimeout(() => {
      closeDeepCompareModal();
      showToast('No matching files to compare in selection.', 'info');
    }, 1000);
    return;
  }

  const res = await window.api.compareSelectionDeep(
    appState.leftPath,
    appState.rightPath,
    itemsToCompare,
    method,
    skipBinary
  );

  bar.style.width = '100%';
  status.textContent = `Finished: ${res.matchCount} matched, ${res.diffCount} differences.`;

  // Update table statuses based on deep results
  if (res.results) {
    const resultMap = new Map(res.results.map(r => [r.relativePath, r]));
    appState.comparisonItems.forEach(it => {
      const match = resultMap.get(it.relativePath);
      if (match) {
        it.status = match.match ? 'identical' : 'different';
      }
    });
    // Re-build hierarchy tree so difference propagation bubbles up to folders
    appState.treeRoot = buildComparisonTree(appState.comparisonItems);
    applyFilterAndRender();
    showToast(`Deep compare completed: ${res.matchCount} same, ${res.diffCount} diffs.`, 'info');
  }

  setTimeout(() => {
    if (document.getElementById('chkAutoClose').checked) {
      closeDeepCompareModal();
    }
  }, 400);
}

// --- STATUS BAR UPDATES ---
async function loadSystemInfo() {
  try {
    const info = await window.api.getSystemInfo();
    if (info && info.platform) {
      document.body.classList.add(`platform-${info.platform}`);
    }
    const diskText = info.freeMem || '';
    document.getElementById('statusLeftDisk').textContent = diskText;
    document.getElementById('statusRightDisk').textContent = diskText;
  } catch {}
}

function updateStatusBar() {
  let leftCount = 0, leftBytes = 0;
  let rightCount = 0, rightBytes = 0;

  if (appState.leftPath) {
    appState.comparisonItems.forEach(it => {
      if (it.left) {
        leftCount++;
        leftBytes += it.left.size || 0;
      }
    });
  }

  if (appState.rightPath) {
    appState.comparisonItems.forEach(it => {
      if (it.right) {
        rightCount++;
        rightBytes += it.right.size || 0;
      }
    });
  }

  document.getElementById('statusLeftCount').textContent = `${leftCount} items`;
  document.getElementById('statusLeftSize').textContent = formatBytes(leftBytes);

  document.getElementById('statusRightCount').textContent = `${rightCount} items`;
  document.getElementById('statusRightSize').textContent = formatBytes(rightBytes);
}

// --- UTILITIES ---
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  if (!bytes) return '';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}-${pad(d.getMonth()+1)}-${String(d.getFullYear()).slice(-2)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatTreeSize(bytes) {
  if (bytes === undefined || bytes === null || bytes === '') return '';
  return Number(bytes).toLocaleString('es-ES');
}

function formatTreeDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}-${pad(d.getMonth()+1)}-${d.getFullYear()} at ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function getIndent(relPath) {
  const depth = (relPath.match(/\//g) || []).length;
  return Math.min(depth * 14, 120);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
