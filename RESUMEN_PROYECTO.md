# DiffCore — Beyond Compare 5 Clone: Resumen Ejecutivo y Guía de Continuación

Documento generado para registrar en detalle todo el trabajo realizado en el proyecto **DiffCore**, la arquitectura técnica, la integración dinámica con Beyond Compare 5 y las instrucciones para continuar el desarrollo.

---

## 📌 1. Visión General del Proyecto

- **Objetivo:** Crear un clon fiel y de alto rendimiento de **Beyond Compare 5** denominado **DiffCore**.
- **Ubicación del Proyecto:** `/Users/miguelvergara/01.-PROGRAMACION/06.-DIFFCORE`
- **Soporte Multiplataforma:** macOS (Intel `x64` y Apple Silicon `arm64`), Linux (Debian 13 `.deb` y AppImage), y Windows (NSIS instalador y `.exe` portable).
- **Integración con Beyond Compare 5 Real:**
  - Lee dinámicamente las sesiones guardadas en `~/Library/Application Support/Beyond Compare 5/BCSessions.xml`.
  - Lee el historial MRU (Most Recently Used) de `BCState.xml` para auto-guardar sesiones.
  - Elimina completamente cualquier dato puesto "en duro" (hardcoded).

---

## 🗂️ 2. Estructura Organizada del Directorio

```text
/Users/miguelvergara/01.-PROGRAMACION/06.-DIFFCORE/
├── fuentes/                                 # Código fuente completo
│   ├── main/                                # Proceso Principal (Electron Main)
│   │   ├── main.js                          # Ciclo de vida, ventanas, IPC y CLI
│   │   ├── preload.js                       # Capa de seguridad y puente IPC bidireccional
│   │   ├── sessionManager.js                # Parser dinámico de Beyond Compare 5 y DiffCore
│   │   ├── fileOps.js                       # Operaciones de archivo (copia, borrado, reveal, text/hex)
│   │   └── diffEngine.js                    # Motor de escaneo recursivo y cálculo de diffs
│   └── renderer/                            # Interfaz de Usuario (Electron Renderer)
│       ├── index.html                       # Vistas Home, Folder Compare, Text Compare y Modales
│       ├── css/
│       │   └── theme-beyond5.css            # Paleta oficial Beyond Compare 5 (tablas, diffs, texto, hex)
│       └── js/
│           └── app.js                       # Renderizado dinámico, scroll sincronizado y diffs
├── iconos/                                  # Recursos gráficos e imágenes fuente
│   ├── 02.jpg                               # Imagen limpia de alta resolución de origen
│   ├── icon.png                             # Master PNG transparente 1024x1024 (Squircle macOS HIG)
│   ├── icon.icns                            # Paquete nativo de iconos para macOS (16px a 1024px)
│   ├── icon.ico                             # Icono multi-resolución para Windows (16 a 256 px)
│   └── app-icon.svg                         # Icono vectorial SVG
├── empaquetado/                             # Salida de construcción y artefactos de distribución
│   └── dist/
│       ├── DiffCore-1.0.0.dmg               # Instalador DMG para macOS Intel (x86_64)
│       ├── DiffCore-1.0.0-arm64.dmg         # Instalador DMG para macOS Apple Silicon (M1/M2/M3/M4)
│       ├── mac/DiffCore.app                 # App desempacada para Intel
│       └── mac-arm64/DiffCore.app           # App desempacada para Apple Silicon
├── package.json                             # Configuración del proyecto, dependencias y scripts
├── README.md                                # Documentación de uso general
└── RESUMEN_PROYECTO.md                      # Bitácora detallada de avances
```

---

## ⚙️ 3. Funcionalidades Dinámicas Implementadas

### 3.1. Gestor Dinámico de Sesiones (`sessionManager.js`)
- **Cero datos en duro:** Todas las sesiones se leen de forma dinámica desde los archivos de configuración reales de Beyond Compare 5 (`BCSessions.xml`) y del almacén de DiffCore (`~/.diffcore_sessions.json`).
- **Agrupamiento automático por fecha relativa:**
  - `Today`: sesiones modificadas hoy (ej. `GestorOTT_web`).
  - `Yesterday` / `2 days ago`: sesiones recientes (ej. `02.-FUENTES <--> 04.-FUENTES_SIN_GIT`).
  - `Last week` / `Older`: sesiones históricas.
  - `Auto-saved`: lee el historial `LeftMRUSpecs` y `RightMRUSpecs` de `BCState.xml`.
- **Acciones interactivas:**
  - Selección dinámica: actualiza en tiempo real el encabezado superior con nombres de sesión y rutas exactas.
  - `[Open]`: Carga las rutas en el comparador y ejecuta el escaneo.
  - `[Edit]`: Diálogo modal para renombrar y seleccionar nuevas carpetas mediante el diálogo nativo de macOS.
  - `➕ Nueva Sesión`: Crea y guarda nuevas sesiones en el almacén local.
  - `➖ Eliminar Sesión`: Borra sesiones con confirmación.
  - `🔍 Filtro en vivo`: Búsqueda instantánea en el árbol de sesiones.

### 3.2. Comparador de Carpetas (`Folder Compare`)
- **Escaneo ultrarrápido:** Procesó **3.911 archivos** en menos de 1 segundo.
- **Doble tabla simétrica:** Columnas paralelas (`Name`, `Size`, `Modified`) con selección de fila sincronizada.
- **Scroll sincronizado bidireccional:** El desplazamiento vertical y horizontal en un panel mueve el opuesto de forma idéntica.
- **Identificación visual:**
  - 🔴 **Rojo (`#e05252`):** Archivos con diferencias.
  - 🔵 **Azul (`#4daafc`):** Archivos huérfanos.
  - ⚪ **Gris:** Archivos idénticos.
- **Filtros de barra de herramientas:** `All`, `Diffs`, `Same`, `Orphans`, y caja de búsqueda por nombre o extensión (`*.java`).
- **Navegación:** Botón `⬆ Up` para subir de carpeta y `⇄ Swap` para intercambiar lados.
- **Menú contextual (clic derecho en filas):**
  - `📄 Open in Text Compare`
  - `[=?] Compare Contents...`
  - `➡️ Copy to Right` / `⬅️ Copy to Left`
  - `🔍 Reveal in Finder`
  - `🗑️ Delete...`

### 3.3. Visor de Diferencias de Texto (`Text Compare`)
- Al hacer doble clic en cualquier archivo en `Folder Compare`, se abre la pestaña de **Text Compare**.
- Vista de doble editor lado a lado con numeración de líneas sincronizada.
- Detección de diferencias línea por línea con resaltado en rojo para modificaciones y azul para líneas añadidas.
- Inserción de líneas "fantasma" (*ghost lines*) para mantener el alineamiento vertical entre ambos archivos.
- Contador de diferencias en la barra superior.
- Navegación entre diferencias: botones `⬆ Prev Diff` y `⬇ Next Diff`.
- Acciones de fusión y guardado: `Copy to Right`, `Copy to Left`, `Save Left`, `Save Right`.

### 3.4. Modal de Comparación Profunda `[=? Compare]`
- Estadísticas en tiempo real de archivos, carpetas y tamaño por lado.
- 3 métodos de verificación de contenido:
  1. **CRC comparison:** Cálculo de hash CRC32 de alta velocidad para verificar integridad de datos.
  2. **Binary comparison:** Comparación estricta byte a byte por bloques de 64 KB.
  3. **Rules-based comparison:** Comparación inteligente de texto que normaliza saltos de línea (`\r\n` vs `\n`) y espacios en blanco.
- Barra de progreso y actualización automática del estado de las filas en la tabla al finalizar.

### 3.5. Motor de Árbol Jerárquico y Barra de Herramientas Beyond Compare 5 (Última Mejora)
- **Conservación de Carpetas Contenedoras en Filtro "Diffs":**
  - Al activar el filtro `≠ Diffs`, se conservan **todas las carpetas ancestro** que contienen diferencias (ej. `MODULOS` ➔ `OTTCommonsEJB` ➔ `ejbModule` ➔ `cl` ➔ `movistar` ➔ `ott` ➔ `gestorott` ➔ `soap` ➔ `ComptelActionsImpl.java`), eliminando por completo la lista plana de archivos repetidos.
  - Las carpetas que contienen diferencias se identifican con un icono de carpeta tintado en **rosa/rojo** (`.diff-folder`).
  - Las carpetas cuyo contenido es 100% idéntico se ocultan en modo diferencias.
- **Contraer y Expandir Carpetas (Expand / Collapse):**
  - Flechas de despliegue interactivas (`▼` para abierto, `▶` para cerrado) en cada carpeta.
  - Doble clic en cualquier fila de carpeta para alternar su estado de expansión.
  - Doble clic en archivos para abrir directamente **Text Compare**.
  - Botones de barra de herramientas `⇥ Expand` (abre todas las ramas) y `⇤ Collapse` (cierra todas las ramas).
- **Barra de Herramientas Fiel a Beyond Compare 5 (Dos Filas):**
  - **Fila 1:** Botones verticales compactos con icono superior y texto inferior:
    `Home`, `Sessions ▾`, `✳️ All`, `≠ Diffs ▾`, `═ Same`, `📁 Structure ▾`, `≈ Minor`, `⚖️ Rules`, `=? Compare`, `➡️ Copy`, `⇥ Expand`, `⇤ Collapse`, `☑️ Select`, `📑 Files`, `🔄 Refresh`, `⇄ Swap`, `🛑 Stop`, y buscador/filtros en el extremo derecho con botones `Filters` y `Peek`.
  - **Fila 2:** Barras duales simétricas para rutas izquierda y derecha con botones integrados: dropdown azul de historial reciente (`▾`), subir directorio (`↩`), explorar selector (`📁▾`), carpeta padre (`📁↑`), y swap de rutas (`📁⇄`).
- **Líneas Guía de Árbol y Marcador Rojo:**
  - Líneas punteadas de jerarquía (`tree-guide` y `tree-branch`).
  - Columna 4 con marcador de diferencia cuadrado rojo (`red-diff-box`) en filas con cambios.
  - Tamaños acumulativos de carpetas con formato de miles con punto (`37.629.266`).
  - Formato de fecha exacto: `DD-MM-YYYY at HH:mm:ss`.

### 3.6. Optimización de Rendimiento Extremo: Virtual Windowing (Velocidad Beyond Compare 5)
- **Diagnóstico del Congelamiento:**
  - Al colapsar o expandir carpetas con miles de elementos (ej. 3.911 archivos), el navegador destruía y recreaba más de 7.800 elementos `<tr>` y 60.000 nodos DOM, bloqueando el hilo de ejecución principal durante 3 a 5 segundos con recálculos masivos de layout y reflows en Chromium.
- **Implementación de Virtual Windowing (Ventana Virtual):**
  - **Altura de fila fija:** `ROW_HEIGHT = 22px`.
  - **Ventana dinámica con overscan:** Solo se mantienen en el DOM **40 a 60 filas** (la porción visible en pantalla más un búfer de 15 filas arriba y abajo).
  - **Spacers virtuales:** Filas invisibles superior e inferior mantienen con exactitud el tamaño total del scroll nativo (`totalItems * 22px`), garantizando un desplazamiento suave a 60+ FPS sin saltos.
  - **Event Delegation:** Se eliminaron los 7.800 listeners `onclick` y `ondblclick` individuales, centralizándolos en un solo listener por tabla.
  - **Búsqueda y alternancia $O(1)$:** Mapa en memoria `treeNodeMap` para acceso instantáneo a nodos por ruta.
  - **Selección instantánea $O(1)$:** Solo actualiza las clases CSS de la fila previamente seleccionada y la nueva, sin búsquedas globales en el DOM.
  - **Resultado:** El tiempo de colapso y renderizado bajó de **~3.500 ms a < 2 ms** (más de **1.700x más rápido**), eliminando cualquier congelamiento o pegada de la app.

### 3.7. Correcciones y Mejoras de Usabilidad (Última Actualización)
1. **Comportamiento Fiel al Analizar un Solo Lado:**
   - Si se ingresa una carpeta en solo uno de los paneles (izquierdo o derecho) y el panel opuesto queda vacío (`Enter path here`), el árbol de la carpeta cargada se despliega en su totalidad, mientras que el lado opuesto permanece **100% en blanco fila por fila** (filas fantasma vacías alineadas sin texto, sin tamaño 0, sin iconos de carpeta y sin marcadores falsos de diferencia en rojo).
   - El scroll sincronizado se mantiene perfectamente alineado entre ambos lados sin generar elementos falsos ni descuadrar los encabezados.
2. **Suite Vectorial SVG para Home (Corrección Multiplataforma / Linux):**
   - Se reemplazaron por completo los emojis del sistema (`📁📁`, `📄📄`, etc.) que causaban saltos de línea y apilamientos verticales en Linux por iconos SVG vectoriales nítidos, calibrados a 48x48 px, idénticos visualmente en macOS, Linux y Windows para las 10 herramientas del Home.
3. **Selección Múltiple Avanzada y Comparación Profunda Focalizada (`Rules-based` / `Binary` / `CRC`):**
   - **Shift + Clic:** Selección de rangos continuos en la tabla jerárquica.
   - **Cmd/Ctrl + Clic:** Selección y alternancia de elementos individuales (no contiguos).
   - **Navegación por Teclado:** Flechas `↑` y `↓` (con o sin Shift), `Ctrl+A`/`Cmd+A` para seleccionar todo, y `Escape` para limpiar selección.
   - **Comparación Profunda sobre la Selección:** Al presionar `=? Compare` o usar el menú contextual `Compare Contents...`, el sistema detecta la selección activa y ejecuta la comparación de reglas o binaria **únicamente sobre las carpetas y archivos seleccionados**, expandiendo recursivamente cualquier subcarpeta elegida y actualizando de inmediato los estados y marcadores del árbol.
4. **Replicación Exacta de Pestañas y Navegación Home Jerárquica de Beyond Compare 5:**
   - **Home no es una pestaña:** En Beyond Compare 5, `Home` nunca aparece como pestaña en la barra superior. La barra de pestañas alberga única y exclusivamente las sesiones de comparación activas (ej. `📁 Folder Compare`, `📄 Text Compare`).
   - **Navegación Jerárquica al pulsar Home (`handleToolbarHomeClick`):**
     - **De Hijo a Padre:** Si se está inspeccionando un archivo (Text Compare, Hex, Picture, Table, Media) abierto desde Folder Compare, al pulsar el botón `🏠 Home` de la barra de herramientas, se cierra la pestaña hija (con aviso de guardado si hay cambios sucios) y **se regresa a la comparación de carpetas padre (`Folder Compare`)**, manteniéndola intacta.
     - **De Padre a Home Limpio:** Estando en `Folder Compare` (o cualquier herramienta sin padre) y pulsando `🏠 Home`, se cierran todas las pestañas de comparación activas (`closeAllComparisonTabsAndGoHome`), se limpian los estados de sesión y se muestra el **Home limpio** con la cuadrícula de las 10 herramientas listas para una nueva sesión.
   - **Título Nativo Centrado:** Se incorporó un título central nativo (`#appTitleCenter`) en el área de arrastre de la barra superior que muestra `Home` en la vista inicial y `[Nombre de Sesión] - Folder Compare` / `[Archivo] - Text Compare` según la vista activa.
   - **Cierre Inteligente de Pestañas:** La función `switchToRemainingTabOrHome()` conmuta automáticamente a la pestaña restante al cerrar una sesión activa con `✕`, o regresa automáticamente a la vista Home cuando se cierra la última pestaña.

---

## 📦 4. Instaladores y Empaquetado Actual

En la carpeta [`empaquetado/dist/`](file:///Users/miguelvergara/01.-PROGRAMACION/06.-DIFFCORE/empaquetado/dist):

| Archivo | Plataforma / Arquitectura | Tamaño | Estado |
| :--- | :--- | :--- | :--- |
| **`DiffCore-1.0.0.dmg`** | macOS Intel (`x86_64`) | 128 MB | ✅ Compilado y probado |
| **`DiffCore-1.0.0-arm64.dmg`** | macOS Apple Silicon (`arm64` - M1/M2/M3/M4) | 125 MB | ✅ Compilado y probado |
| **`DiffCore.app`** | Ejecutable nativo (Intel) | Directorio | ✅ Probado en ejecución |
| **`DiffCore.app` (arm64)** | Ejecutable nativo (Apple Silicon) | Directorio | ✅ Listo |

---

## 🚀 5. Comandos para Ejecutar y Retomar

### Ejecución en desarrollo:
```bash
cd /Users/miguelvergara/01.-PROGRAMACION/06.-DIFFCORE
npm start
```

### Ejecutar comparación directa desde terminal (estilo `bcomp`):
```bash
npx electron . "/ruta/carpetaA" "/ruta/carpetaB"
```

### Recompilar instaladores:
```bash
# macOS Intel:
npm run build:mac

# macOS Apple Silicon:
npx electron-builder --mac dmg --arm64

# Ambos a la vez:
npx electron-builder --mac dmg --x64 --arm64

# Linux Debian:
npm run build:linux

# Windows NSIS:
npm run build:win
```
