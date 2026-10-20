const { Menu, app } = require('electron');

const MENU_TRANSLATIONS = {
  en: {
    app: 'DiffCore',
    about: 'About DiffCore',
    settings: 'Settings...',
    services: 'Services',
    hide: 'Hide DiffCore',
    hideOthers: 'Hide Others',
    showAll: 'Show All',
    quit: 'Quit DiffCore',
    file: 'File',
    newComparison: 'New Comparison',
    closeTab: 'Close Tab',
    edit: 'Edit',
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select All',
    view: 'View',
    reload: 'Reload',
    forceReload: 'Force Reload',
    actualSize: 'Actual Size',
    zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out',
    toggleFullScreen: 'Toggle Full Screen',
    window: 'Window',
    minimize: 'Minimize',
    zoom: 'Zoom',
    front: 'Bring All to Front',
    help: 'Help',
    diffCoreHelp: 'DiffCore Help',
    openHelpInBrowser: 'Open Manual in Web Browser...',
    exit: 'Exit'
  },
  es: {
    app: 'DiffCore',
    about: 'Acerca de DiffCore',
    settings: 'Configuración...',
    services: 'Servicios',
    hide: 'Ocultar DiffCore',
    hideOthers: 'Ocultar otros',
    showAll: 'Mostrar todo',
    quit: 'Salir de DiffCore',
    file: 'Archivo',
    newComparison: 'Nueva Comparación',
    closeTab: 'Cerrar Pestaña',
    edit: 'Edición',
    undo: 'Deshacer',
    redo: 'Rehacer',
    cut: 'Cortar',
    copy: 'Copiar',
    paste: 'Pegar',
    selectAll: 'Seleccionar Todo',
    view: 'Ver',
    reload: 'Recargar',
    forceReload: 'Forzar Recarga',
    actualSize: 'Tamaño Real',
    zoomIn: 'Acercar',
    zoomOut: 'Alejar',
    toggleFullScreen: 'Pantalla Completa',
    window: 'Ventana',
    minimize: 'Minimizar',
    zoom: 'Maximizar',
    front: 'Traer todo al frente',
    help: 'Ayuda',
    diffCoreHelp: 'Ayuda de DiffCore',
    openHelpInBrowser: 'Abrir Manual en el Navegador...',
    exit: 'Salir'
  },
  'pt-BR': {
    app: 'DiffCore',
    about: 'Sobre o DiffCore',
    settings: 'Configurações...',
    services: 'Serviços',
    hide: 'Ocultar DiffCore',
    hideOthers: 'Ocultar Outros',
    showAll: 'Mostrar Tudo',
    quit: 'Encerrar o DiffCore',
    file: 'Arquivo',
    newComparison: 'Nova Comparação',
    closeTab: 'Fechar Aba',
    edit: 'Editar',
    undo: 'Desfazer',
    redo: 'Refazer',
    cut: 'Recortar',
    copy: 'Copiar',
    paste: 'Colar',
    selectAll: 'Selecionar Tudo',
    view: 'Exibir',
    reload: 'Recarregar',
    forceReload: 'Forçar Recarregamento',
    actualSize: 'Tamanho Real',
    zoomIn: 'Mais Zoom',
    zoomOut: 'Menos Zoom',
    toggleFullScreen: 'Alternar Tela Cheia',
    window: 'Janela',
    minimize: 'Minimizar',
    zoom: 'Zoom',
    front: 'Trazer Tudo para a Frente',
    help: 'Ajuda',
    diffCoreHelp: 'Ajuda do DiffCore',
    openHelpInBrowser: 'Abrir Manual no Navegador...',
    exit: 'Sair'
  },
  fr: {
    app: 'DiffCore',
    about: 'À propos de DiffCore',
    settings: 'Paramètres...',
    services: 'Services',
    hide: 'Masquer DiffCore',
    hideOthers: 'Masquer les autres',
    showAll: 'Tout afficher',
    quit: 'Quitter DiffCore',
    file: 'Fichier',
    newComparison: 'Nouvelle Comparaison',
    closeTab: 'Fermer l\'onglet',
    edit: 'Édition',
    undo: 'Annuler',
    redo: 'Rétablir',
    cut: 'Couper',
    copy: 'Copier',
    paste: 'Coller',
    selectAll: 'Tout Sélectionner',
    view: 'Présentation',
    reload: 'Recharger',
    forceReload: 'Forcer le Rechargement',
    actualSize: 'Taille Réelle',
    zoomIn: 'Zoom Avant',
    zoomOut: 'Zoom Arrière',
    toggleFullScreen: 'Plein Écran',
    window: 'Fenêtre',
    minimize: 'Réduire',
    zoom: 'Zoom',
    front: 'Tout ramener au premier plan',
    help: 'Aide',
    diffCoreHelp: 'Aide de DiffCore',
    openHelpInBrowser: 'Ouvrir le Manuel dans le Navigateur...',
    exit: 'Quitter'
  },
  it: {
    app: 'DiffCore',
    about: 'Informazioni su DiffCore',
    settings: 'Impostazioni...',
    services: 'Servizi',
    hide: 'Nascondi DiffCore',
    hideOthers: 'Nascondi Altre',
    showAll: 'Mostra Tutte',
    quit: 'Esci da DiffCore',
    file: 'File',
    newComparison: 'Nuovo Confronto',
    closeTab: 'Chiudi Scheda',
    edit: 'Modifica',
    undo: 'Annulla',
    redo: 'Ripristina',
    cut: 'Taglia',
    copy: 'Copia',
    paste: 'Incolla',
    selectAll: 'Seleziona Tutto',
    view: 'Vista',
    reload: 'Ricarica',
    forceReload: 'Ricarica Forzata',
    actualSize: 'Dimensioni Reali',
    zoomIn: 'Ingrandisci',
    zoomOut: 'Rimpicciolisci',
    toggleFullScreen: 'Attiva/Disattiva Schermo Intero',
    window: 'Finestra',
    minimize: 'Riduci a icona',
    zoom: 'Zoom',
    front: 'Porta tutto in primo piano',
    help: 'Aiuto',
    diffCoreHelp: 'Guida di DiffCore',
    openHelpInBrowser: 'Apri il Manuale nel Browser...',
    exit: 'Esci'
  },
  ru: {
    app: 'DiffCore',
    about: 'О программе DiffCore',
    settings: 'Настройки...',
    services: 'Службы',
    hide: 'Скрыть DiffCore',
    hideOthers: 'Скрыть остальные',
    showAll: 'Показать все',
    quit: 'Завершить DiffCore',
    file: 'Файл',
    newComparison: 'Новое сравнение',
    closeTab: 'Закрыть вкладку',
    edit: 'Правка',
    undo: 'Отменить',
    redo: 'Повторить',
    cut: 'Вырезать',
    copy: 'Копировать',
    paste: 'Вставить',
    selectAll: 'Выбрать все',
    view: 'Вид',
    reload: 'Перезагрузить',
    forceReload: 'Принудительная перезагрузка',
    actualSize: 'Исходный размер',
    zoomIn: 'Увеличить',
    zoomOut: 'Уменьшить',
    toggleFullScreen: 'Полноэкранный режим',
    window: 'Окно',
    minimize: 'Свернуть',
    zoom: 'Масштабировать',
    front: 'Все окна — на передний план',
    help: 'Справка',
    diffCoreHelp: 'Справка DiffCore',
    openHelpInBrowser: 'Открыть руководство в браузере...',
    exit: 'Выход'
  }
};

let currentMenuLang = 'es';
let isTextEditActive = false;

function buildMenuTemplate(lang, mainWindow) {
  const t = MENU_TRANSLATIONS[lang] || MENU_TRANSLATIONS['es'] || MENU_TRANSLATIONS['en'];
  const isMac = process.platform === 'darwin';

  const template = [];

  // 1. macOS Application Menu
  if (isMac) {
    template.push({
      label: 'DiffCore',
      submenu: [
        {
          label: t.about,
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('menu:openAbout');
            }
          }
        },
        {
          label: t.settings,
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('menu:openSettings');
            }
          }
        },
        { type: 'separator' },
        { label: t.services, role: 'services' },
        { type: 'separator' },
        { label: t.hide, role: 'hide' },
        { label: t.hideOthers, role: 'hideOthers' },
        { label: t.showAll, role: 'unhide' },
        { type: 'separator' },
        { label: t.quit, role: 'quit' }
      ]
    });
  }

  // 2. File Menu
  const fileSubmenu = [
    {
      label: t.newComparison,
      accelerator: 'CmdOrCtrl+N',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('menu:newTab');
        }
      }
    },
    {
      label: t.closeTab,
      accelerator: 'CmdOrCtrl+W',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('menu:closeTab');
        }
      }
    }
  ];

  if (!isMac) {
    fileSubmenu.push(
      { type: 'separator' },
      {
        label: t.settings,
        accelerator: 'CmdOrCtrl+,',
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('menu:openSettings');
          }
        }
      },
      { type: 'separator' },
      { label: t.exit, role: 'quit' }
    );
  }

  template.push({
    label: t.file,
    submenu: fileSubmenu
  });

  // 3. Edit Menu (Hidden on Home/Folder, shown when entering Text Compare / Text Edit)
  if (isTextEditActive) {
    template.push({
      label: t.edit,
      submenu: [
        { label: t.undo, role: 'undo' },
        { label: t.redo, role: 'redo' },
        { type: 'separator' },
        { label: t.cut, role: 'cut' },
        { label: t.copy, role: 'copy' },
        { label: t.paste, role: 'paste' },
        { type: 'separator' },
        { label: t.selectAll, role: 'selectAll' }
      ]
    });
  }

  // 4. View Menu (Toggle Developer Tools removed as requested)
  template.push({
    label: t.view,
    submenu: [
      { label: t.reload, role: 'reload' },
      { label: t.forceReload, role: 'forceReload' },
      { type: 'separator' },
      { label: t.actualSize, role: 'resetZoom' },
      { label: t.zoomIn, role: 'zoomIn' },
      { label: t.zoomOut, role: 'zoomOut' },
      { type: 'separator' },
      { label: t.toggleFullScreen, role: 'togglefullscreen' }
    ]
  });

  // 5. Window Menu
  const windowSubmenu = [
    { label: t.minimize, role: 'minimize' },
    { label: t.zoom, role: 'zoom' }
  ];
  if (isMac) {
    windowSubmenu.push(
      { type: 'separator' },
      { label: t.front, role: 'front' }
    );
  }

  template.push({
    label: t.window,
    submenu: windowSubmenu
  });

  // 6. Help Menu
  template.push({
    label: t.help,
    submenu: [
      {
        label: t.diffCoreHelp || 'DiffCore Help',
        accelerator: isMac ? 'Cmd+?' : 'F1',
        click: () => {
          if (typeof helpOpener === 'function') {
            helpOpener();
          } else if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('menu:openHelp');
          }
        }
      },
      {
        label: t.openHelpInBrowser || 'Open Manual in Web Browser...',
        click: () => {
          if (typeof helpBrowserOpener === 'function') {
            helpBrowserOpener();
          }
        }
      },
      { type: 'separator' },
      {
        label: t.about,
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('menu:openAbout');
          }
        }
      }
    ]
  });

  return template;
}

let helpOpener = null;
function setHelpOpener(fn) {
  helpOpener = fn;
}

let helpBrowserOpener = null;
function setHelpBrowserOpener(fn) {
  helpBrowserOpener = fn;
}

function setupApplicationMenu(mainWindow, initialLang) {
  if (initialLang && MENU_TRANSLATIONS[initialLang]) {
    currentMenuLang = initialLang;
  }
  const template = buildMenuTemplate(currentMenuLang, mainWindow);
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  if (mainWindow && !mainWindow.isDestroyed() && process.platform !== 'darwin') {
    mainWindow.setMenu(menu);
  }
}

function updateMenuLanguage(mainWindow, lang) {
  if (!MENU_TRANSLATIONS[lang]) return;
  currentMenuLang = lang;
  setupApplicationMenu(mainWindow, lang);
}

function updateActiveView(mainWindow, viewName) {
  // Show Edit menu when entering Text Compare, Text Edit, or Text Merge; hide on Home, Folder Compare, etc.
  const nextState = (viewName === 'text' || viewName === 'textedit' || viewName === 'textmerge');
  if (isTextEditActive === nextState) return;
  isTextEditActive = nextState;
  setupApplicationMenu(mainWindow, currentMenuLang);
}

function getContextMenuForEditable() {
  const t = MENU_TRANSLATIONS[currentMenuLang] || MENU_TRANSLATIONS['es'] || MENU_TRANSLATIONS['en'];
  return Menu.buildFromTemplate([
    { label: t.undo || 'Deshacer', role: 'undo' },
    { label: t.redo || 'Rehacer', role: 'redo' },
    { type: 'separator' },
    { label: t.cut || 'Cortar', role: 'cut' },
    { label: t.copy || 'Copiar', role: 'copy' },
    { label: t.paste || 'Pegar', role: 'paste' },
    { type: 'separator' },
    { label: t.selectAll || 'Seleccionar todo', role: 'selectAll' }
  ]);
}

function getContextMenuForSelection() {
  const t = MENU_TRANSLATIONS[currentMenuLang] || MENU_TRANSLATIONS['es'] || MENU_TRANSLATIONS['en'];
  return Menu.buildFromTemplate([
    { label: t.copy || 'Copiar', role: 'copy' },
    { type: 'separator' },
    { label: t.selectAll || 'Seleccionar todo', role: 'selectAll' }
  ]);
}

module.exports = {
  setupApplicationMenu,
  updateMenuLanguage,
  updateActiveView,
  getContextMenuForEditable,
  getContextMenuForSelection,
  setHelpOpener,
  setHelpBrowserOpener
};
