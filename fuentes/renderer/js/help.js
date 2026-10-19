/**
 * DiffCore Help Viewer - Interactive Navigation & Live Search Engine
 */

let helpState = {
  currentTopic: 'welcome',
  history: ['welcome'],
  historyIndex: 0,
  topics: {},
  indexItems: []
};

// Initialize Help Viewer
window.addEventListener('DOMContentLoaded', () => {
  setupSplitter();
  setupTabs();
  setupSearch();
  setupHistoryNavigation();
  buildIndexList();

  // Check URL query parameters (e.g. ?topic=java)
  const urlParams = new URLSearchParams(window.location.search);
  const requestedTopic = urlParams.get('topic');
  if (requestedTopic && document.getElementById(`doc-${requestedTopic}`)) {
    navigateTo(requestedTopic, false);
  } else {
    navigateTo('welcome', false);
  }

  // Listen for navigation messages from main process
  if (window.api && typeof window.api.onNavigateHelp === 'function') {
    window.api.onNavigateHelp((topic) => {
      if (topic) navigateTo(topic);
    });
  }
});

// Setup Splitter Resizing
function setupSplitter() {
  const sidebar = document.getElementById('helpSidebar');
  const resizer = document.getElementById('helpResizer');
  if (!sidebar || !resizer) return;

  let isDragging = false;
  let startX = 0;
  let startWidth = 300;

  resizer.addEventListener('mousedown', (e) => {
    isDragging = true;
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const diff = e.clientX - startX;
    const newWidth = Math.max(220, Math.min(550, startWidth + diff));
    sidebar.style.width = `${newWidth}px`;
  });

  window.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      resizer.classList.remove('dragging');
      document.body.style.cursor = '';
    }
  });
}

// Setup Sidebar Tabs (Contents / Index / Search)
function setupTabs() {
  const tabBtns = document.querySelectorAll('.sidebar-tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetPanel = document.getElementById(btn.dataset.target);
      if (targetPanel) targetPanel.classList.add('active');

      if (btn.dataset.target === 'panelSearch') {
        const input = document.getElementById('sidebarSearchInput');
        if (input) input.focus();
      }
    });
  });
}

// Toggle folder groups
function toggleFolder(headerEl) {
  const group = headerEl.closest('.tree-group');
  if (group) {
    group.classList.toggle('expanded');
  }
}

// Navigate to topic
function navigateTo(topicId, pushHistory = true) {
  const aliases = {
    'folder-sync': 'folder-merge',
    'text-edit': 'text-merge',
    'java-decompiler': 'java-support'
  };
  const resolvedTopicId = aliases[topicId] || topicId;
  const targetDoc = document.getElementById(`doc-${resolvedTopicId}`);
  if (!targetDoc) return;

  // Hide all sections
  document.querySelectorAll('.doc-section-content').forEach(s => s.style.display = 'none');
  targetDoc.style.display = 'block';

  // Highlight active tree item
  document.querySelectorAll('.tree-item').forEach(it => {
    it.classList.remove('active');
    if (it.dataset.topic === topicId || it.dataset.topic === resolvedTopicId) {
      it.classList.add('active');
      // Ensure parents are expanded
      let parent = it.closest('.tree-group');
      while (parent) {
        parent.classList.add('expanded');
        parent = parent.parentElement.closest('.tree-group');
      }
    }
  });

  // Scroll content to top
  const container = document.getElementById('helpContentArea');
  if (container) container.scrollTop = 0;

  // History tracking
  if (pushHistory) {
    if (helpState.historyIndex < helpState.history.length - 1) {
      helpState.history = helpState.history.slice(0, helpState.historyIndex + 1);
    }
    helpState.history.push(topicId);
    helpState.historyIndex = helpState.history.length - 1;
  }

  updateNavButtons();
  helpState.currentTopic = topicId;
}

// History Navigation
function setupHistoryNavigation() {
  const btnPrev = document.getElementById('navPrevBtn');
  const btnNext = document.getElementById('navNextBtn');
  if (btnPrev) {
    btnPrev.onclick = () => {
      if (helpState.historyIndex > 0) {
        helpState.historyIndex--;
        navigateTo(helpState.history[helpState.historyIndex], false);
      }
    };
  }
  if (btnNext) {
    btnNext.onclick = () => {
      if (helpState.historyIndex < helpState.history.length - 1) {
        helpState.historyIndex++;
        navigateTo(helpState.history[helpState.historyIndex], false);
      }
    };
  }
}

function updateNavButtons() {
  const btnPrev = document.getElementById('navPrevBtn');
  const btnNext = document.getElementById('navNextBtn');
  if (btnPrev) btnPrev.disabled = helpState.historyIndex <= 0;
  if (btnNext) btnNext.disabled = helpState.historyIndex >= helpState.history.length - 1;
}

// Search functionality
function setupSearch() {
  const searchInput = document.getElementById('sidebarSearchInput');
  if (!searchInput) return;

  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim().toLowerCase();
    if (!query) {
      return;
    }

    // Switch to search tab automatically if not already active
    const searchTabBtn = document.querySelector('[data-target="panelSearch"]');
    if (searchTabBtn && !searchTabBtn.classList.contains('active')) {
      searchTabBtn.click();
    }

    performSearch(query);
  });
}

function performSearch(query) {
  const resultsContainer = document.getElementById('searchResultsList');
  if (!resultsContainer) return;

  resultsContainer.innerHTML = '';
  const sections = document.querySelectorAll('.doc-section-content');
  const matches = [];

  sections.forEach(sec => {
    const topicId = sec.id.replace('doc-', '');
    const titleEl = sec.querySelector('.doc-title');
    const title = titleEl ? titleEl.textContent : topicId;
    const text = sec.textContent.toLowerCase();

    if (text.includes(query)) {
      // Find snippet around match
      const pos = text.indexOf(query);
      const start = Math.max(0, pos - 40);
      const end = Math.min(text.length, pos + query.length + 60);
      let snippet = sec.textContent.substring(start, end).replace(/\s+/g, ' ');

      // Highlight term
      const regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
      snippet = snippet.replace(regex, '<mark>$1</mark>');

      matches.push({ topicId, title, snippet });
    }
  });

  if (matches.length === 0) {
    resultsContainer.innerHTML = `<li style="padding: 16px; color: var(--text-muted); text-align: center;">No se encontraron resultados para "${escapeHtml(query)}"</li>`;
    return;
  }

  matches.forEach(m => {
    const li = document.createElement('li');
    li.className = 'search-result-item';
    li.onclick = () => navigateTo(m.topicId);
    li.innerHTML = `
      <div class="search-res-title">📄 ${escapeHtml(m.title)}</div>
      <div class="search-res-snippet">...${m.snippet}...</div>
    `;
    resultsContainer.appendChild(li);
  });
}

// Build Index list
function buildIndexList() {
  const container = document.getElementById('indexList');
  if (!container) return;

  const items = [
    { title: 'Alineación de Diferencias (Myers Diff)', topic: 'text-compare' },
    { title: 'Archivos .class descompilados', topic: 'java-support' },
    { title: 'Archivos Binarios (Comparador Hexadecimal)', topic: 'hex-compare' },
    { title: 'Atajos de Teclado', topic: 'shortcuts' },
    { title: 'Auto-guardado de Sesiones', topic: 'home-screen' },
    { title: 'Beyond Compare 5 - Compatibilidad', topic: 'welcome' },
    { title: 'Comparador de Carpetas', topic: 'folder-compare' },
    { title: 'Comparador de Imágenes', topic: 'picture-compare' },
    { title: 'Comparador de Tablas (Excel/CSV)', topic: 'table-compare' },
    { title: 'Comparador de Texto', topic: 'text-compare' },
    { title: 'Comparador Multimedia (Audio/Video)', topic: 'media-compare' },
    { title: 'Contenedores .jar, .war, .ear', topic: 'java-support' },
    { title: 'Deshacer y Rehacer (Undo/Redo)', topic: 'text-compare' },
    { title: 'Descompilador Vineflower / Fernflower', topic: 'java-support' },
    { title: 'Editor Rápido de Texto', topic: 'text-edit' },
    { title: 'Filtros de Carpetas (✳ Todos, ≠ Difs, ＝ Iguales)', topic: 'folder-compare' },
    { title: 'Fusión 3-Way de Carpetas', topic: 'folder-merge' },
    { title: 'Fusión 3-Way de Texto', topic: 'text-merge' },
    { title: 'Glosario de Términos', topic: 'glossary' },
    { title: 'Integración con Git (difftool / mergetool)', topic: 'cli-git' },
    { title: 'Línea de Comandos (CLI)', topic: 'cli-git' },
    { title: 'Menús Contextuales Nativos', topic: 'folder-compare' },
    { title: 'Mini-mapa y Riel de Resumen', topic: 'text-compare' },
    { title: 'Modales de Archivos no Soportados', topic: 'hex-compare' },
    { title: 'Redirección de Drag & Drop', topic: 'java-support' },
    { title: 'Reglas de Comparación', topic: 'rules-settings' },
    { title: 'Sincronización de Carpetas (Espejo/Actualizar)', topic: 'folder-sync' },
    { title: 'Solución de Problemas (Troubleshooting)', topic: 'glossary' },
    { title: 'Telemetría de Rendimiento (RAM y Latencia)', topic: 'home-screen' }
  ];

  items.sort((a, b) => a.title.localeCompare(b.title));

  container.innerHTML = '';
  items.forEach(it => {
    const li = document.createElement('li');
    li.className = 'index-item';
    li.onclick = () => navigateTo(it.topic);
    li.innerHTML = `<div class="index-title">📌 ${escapeHtml(it.title)}</div>`;
    container.appendChild(li);
  });
}

// Open manual in external browser
function openInExternalBrowser() {
  if (window.api && typeof window.api.openHelpInBrowser === 'function') {
    window.api.openHelpInBrowser();
  } else {
    window.open(window.location.href, '_blank');
  }
}

// Print document
function printDocument() {
  window.print();
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
