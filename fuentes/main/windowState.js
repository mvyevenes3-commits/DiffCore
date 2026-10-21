const { app, screen } = require('electron');
const path = require('path');
const fs = require('fs');

/**
 * Retorna la ruta al archivo donde se persiste el estado de la ventana.
 */
function getWindowStateFile() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

/**
 * Valida que las coordenadas guardadas sean visibles en al menos uno de los monitores conectados.
 * Esto evita que la ventana aparezca fuera de pantalla si el usuario desconectó un monitor secundario.
 */
function isVisibleOnAnyDisplay(bounds) {
  try {
    const displays = screen.getAllDisplays();
    return displays.some(display => {
      const d = display.bounds;
      const overlapX = Math.max(0, Math.min(bounds.x + bounds.width, d.x + d.width) - Math.max(bounds.x, d.x));
      const overlapY = Math.max(0, Math.min(bounds.y + bounds.height, d.y + d.height) - Math.max(bounds.y, d.y));
      return overlapX >= 100 && overlapY >= 100;
    });
  } catch (err) {
    return true;
  }
}

/**
 * Carga el estado previo de la ventana (tamaño, posición, si estaba maximizada).
 * Si no existe estado previo, usa valores por defecto.
 */
function loadWindowState(options = {}) {
  const defaults = {
    defaultWidth: 1440,
    defaultHeight: 920,
    minWidth: 960,
    minHeight: 640,
    defaultMaximized: true,
    ...options
  };

  const state = {
    width: defaults.defaultWidth,
    height: defaults.defaultHeight,
    isMaximized: defaults.defaultMaximized,
    x: undefined,
    y: undefined
  };

  try {
    const stateFile = getWindowStateFile();
    if (fs.existsSync(stateFile)) {
      const raw = fs.readFileSync(stateFile, 'utf8');
      const data = JSON.parse(raw);
      if (typeof data.width === 'number' && data.width >= defaults.minWidth) {
        state.width = data.width;
      }
      if (typeof data.height === 'number' && data.height >= defaults.minHeight) {
        state.height = data.height;
      }
      if (typeof data.isMaximized === 'boolean') {
        state.isMaximized = data.isMaximized;
      }
      if (typeof data.x === 'number' && typeof data.y === 'number') {
        const candidateBounds = {
          x: data.x,
          y: data.y,
          width: state.width,
          height: state.height
        };
        if (isVisibleOnAnyDisplay(candidateBounds)) {
          state.x = data.x;
          state.y = data.y;
        }
      }
    }
  } catch (err) {
    console.warn('[WindowState] Error cargando estado de ventana:', err);
  }

  return state;
}

/**
 * Escucha los eventos de la ventana para guardar automáticamente tamaño y posición
 * cuando el usuario la redimensiona, mueve, maximiza, restaura o cierra.
 */
function trackWindowState(win, state) {
  if (!win) return;

  let saveTimer = null;

  function updateBounds() {
    if (win.isDestroyed()) return;
    state.isMaximized = win.isMaximized();
    if (!win.isMaximized() && !win.isMinimized() && !win.isFullScreen()) {
      try {
        const bounds = (typeof win.getNormalBounds === 'function') 
          ? win.getNormalBounds() 
          : win.getBounds();
        state.x = bounds.x;
        state.y = bounds.y;
        state.width = bounds.width;
        state.height = bounds.height;
      } catch (e) {
        const bounds = win.getBounds();
        state.x = bounds.x;
        state.y = bounds.y;
        state.width = bounds.width;
        state.height = bounds.height;
      }
    }
  }

  function saveState() {
    try {
      updateBounds();
      const stateFile = getWindowStateFile();
      const dir = path.dirname(stateFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = {
        x: state.x,
        y: state.y,
        width: state.width,
        height: state.height,
        isMaximized: state.isMaximized
      };
      fs.writeFileSync(stateFile, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.warn('[WindowState] No se pudo guardar el estado de la ventana:', err);
    }
  }

  function debouncedSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveState();
    }, 400);
  }

  win.on('resize', debouncedSave);
  win.on('move', debouncedSave);
  win.on('maximize', () => {
    state.isMaximized = true;
    saveState();
  });
  win.on('unmaximize', () => {
    state.isMaximized = false;
    debouncedSave();
  });
  win.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveState();
  });
}

module.exports = {
  loadWindowState,
  trackWindowState
};
