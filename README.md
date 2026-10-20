# DiffCore

<p align="center">
  <img src="iconos/icon.png" width="128" height="128" alt="DiffCore App Icon" />
</p>

<p align="center">
  <b>Suite profesional de comparación visual, sincronización y fusión de archivos y carpetas de alto rendimiento.</b><br>
  100% multiplataforma para <b>macOS</b>, <b>Linux</b> y <b>Windows</b>.
</p>

---

## 🌟 Características Principales

### 1. 🏠 Pantalla de Inicio y Gestor de Sesiones (Home)
- **Árbol de sesiones dinámico:** Acceso directo a sesiones guardadas, recientes y autoguardadas agrupadas por tiempo (*Today*, *Yesterday*, *Older*).
- **Lanzador de 10 herramientas especializadas:**
  1. **Folder Compare** (Comparación de carpetas)
  2. **Folder Merge** (Fusión de 3 vías de carpetas)
  3. **Folder Sync** (Sincronización de carpetas)
  4. **Text Compare** (Comparación de texto)
  5. **Text Merge** (Fusión de texto de 3 vías)
  6. **Text Edit** (Editor de texto rápido)
  7. **Hex Compare** (Comparación binaria hexadecimal)
  8. **Picture Compare** (Comparación visual de imágenes)
  9. **Table Compare** (Comparación de Excel y CSV/TSV)
  10. **Media Compare** (Comparación de etiquetas y metadatos de audio)
- **Barra de navegación con pestañas:** Soporte para múltiples sesiones abiertas simultáneamente, pestañas con títulos limpios, botón de cierre individual y navegación rápida.

---

### 2. 📁 Comparador de Carpetas (Folder Compare)
- **Doble árbol sincronizado:** Visualización paralela de rutas con columnas alineadas de `Name`, `Size` y `Modified`.
- **Código cromático profesional de alto contraste:**
  - 🔴 **Rojo:** Archivos con diferencias o modificaciones.
  - 🔵 **Azul:** Archivos huérfanos (presentes únicamente en el lado izquierdo o derecho).
  - ⚪ **Gris:** Archivos idénticos.
  - 🟦 **Fila activa:** Selección y navegación sincronizada en ambos paneles.
- **Modal de Comparación Profunda `[=?]`:**
  - **CRC comparison:** Cálculo de hash CRC32 de alta velocidad para verificar integridad.
  - **Binary comparison:** Comparación estricta byte a byte por bloques de 64 KB.
  - **Rules-based comparison:** Comparación inteligente de texto que normaliza saltos de línea (`\r\n` vs `\n`) y espacios en blanco.
- **Consola de Registro (Log Panel):** Registro histórico con timestamps exactos de cada escaneo, cálculo y operación de archivos.

---

### 3. 🗂️ Fusión de Carpetas de 3 Vías (Folder Merge)
- Fusión visual comparando **Theirs** (Izquierda), **Base** (Centro) y **Mine** (Derecha).
- Detección automática de conflictos y cambios unilaterales o bilaterales.
- Filtrado rápido por *All*, *Conflicts* y *Changes*.

---

### 4. 🔄 Sincronización de Carpetas (Folder Sync)
- Métodos de sincronización flexibles: Actualizar izquierda a derecha, espejo, sincronización bidireccional y reglas personalizadas.
- Vista previa analítica del plan de sincronización antes de ejecutar acciones en disco.

---

### 5. 📄 Comparador de Texto (Text Compare)
- **Motor Myers Diff con alineación sintáctica:** Alineación de bloques de código idénticos y detección precisa de inserciones, eliminaciones y sustituciones.
- **Diferencias a nivel de carácter (Character-level Diff):** Resaltado en rojo intenso de los caracteres exactos cambiados dentro de cada línea.
- **Virtual Scrolling Engine:** Renderizado ultra-rápido de miles de líneas sin lag ni consumo excesivo de memoria.
- **Filtros rápidos:** Botones *Show All*, *Diffs Only*, y *Same Only*.

---

### 6. 📑 Fusión de Texto de 3 Vías (Text Merge)
- Tres paneles superiores independientes: **Theirs (Izquierda)**, **Base Ancestor (Centro)** y **Mine (Derecha)**.
- Panel inferior de salida combinada con edición en tiempo real.
- Botones de acción rápida: *Take Left*, *Take Base*, *Take Right* y *Take Both*.

---

### 7. 📊 Comparador de Tablas (Table Compare)
- Soporte para libros de cálculo **Excel (`.xlsx`, `.xls`)** y archivos delimitados (**CSV, TSV, punto y coma, tubería**).
- Navegación multi-hoja con pestañas inferiores.
- Resaltado celda por celda de valores modificados.
- Navegación rápida entre filas con diferencias (*Prev Diff* / *Next Diff*).

---

### 8. 🔢 Comparador Hexadecimal (Hex Compare)
- Volcado hexadecimal lado a lado sincronizado byte a byte.
- Desplazamiento sincronizado y resaltado en rojo de bytes distintos.

---

### 9. 🖼️ Comparador de Imágenes (Picture Compare)
- Soporte para formatos comunes (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`).
- Modos de visualización: *Side-by-Side*, *Blend*, *Onion Skin* y *Difference Mask*.

---

### 10. 🎵 Comparador de Medios (Media Compare)
- Análisis y comparación de metadatos y etiquetas ID3 para formatos de audio (`.mp3`, `.flac`, `.m4a`, `.wav`).
- Comparación tabular de título, artista, álbum, año, pista, género y bitrate.
- Reproductores de audio integrados en ambos lados.

---

### 🚀 Experiencia Nativa y Multiplataforma
- **Arrastre y suelta nativo (Drag and Drop):** Arrastra archivos o carpetas desde el explorador del sistema (macOS Finder, Windows Explorer, Linux Nautilus/Dolphin) directamente a los paneles, cajas de ruta o tarjetas de inicio.
- **Barra de título arrastrable:** Soporte fluido para mover la ventana desde la barra superior en macOS (`hiddenInset`), Windows y Linux.
- **Temas Claro y Oscuro:** Selector de tema en la barra superior con paleta optimizada de alta legibilidad para largas jornadas.
- **Atajos de teclado estándar:** Selección múltiple con `Shift` y `Cmd/Ctrl`, atajos de navegación y atajos de comparación.

---

## 📁 Estructura del Código Fuente

```text
DiffCore/
├── fuentes/                                 # Código fuente de la aplicación
│   ├── main/                                # Proceso Principal (Electron Main)
│   │   ├── main.js                          # Ciclo de vida, ventana nativa e IPC
│   │   ├── preload.js                       # Capa de seguridad y puente API (contextBridge)
│   │   ├── diffEngine.js                    # Motor Myers Diff, CRC32, binario y reglas
│   │   ├── fileOps.js                       # Operaciones del sistema de archivos
│   │   └── sessionManager.js                # Persistencia de sesiones en JSON
│   └── renderer/                            # Interfaz de Usuario (Electron Renderer)
│       ├── index.html                       # Vistas HTML5 de las 10 herramientas
│       ├── css/
│       │   ├── theme-diffcore.css           # Estilos y tema visual DiffCore
│       │   └── icons.css                    # Definición de iconos
│       └── js/
│           └── app.js                       # Lógica de renderizado, scroll y eventos
├── iconos/                                  # Iconos nativos del sistema
│   ├── icon.png                             # Master PNG transparente 1024x1024
│   ├── icon.icns                            # Icono nativo para macOS
│   ├── icon.ico                             # Icono multi-resolución para Windows
│   └── app-icon.svg                         # Icono vectorial SVG
├── package.json                             # Configuración y dependencias del proyecto
├── .gitignore                               # Archivos y carpetas excluidas de Git
└── README.md                                # Documentación del proyecto
```

---

## 🛠️ Requisitos e Instalación

### Requisitos previos:
- [Node.js](https://nodejs.org/) (versión 18 o superior recomendada)
- [npm](https://www.npmjs.com/) (incluido con Node.js)

### Instalación de dependencias:
```bash
git clone https://github.com/mvyevenes7/DiffCore.git
cd DiffCore
npm install
```

---

## 💻 Ejecución en Desarrollo

Para iniciar la aplicación en modo desarrollo:
```bash
npm start
```

---

## 📦 Compilación y Empaquetado

### macOS:
```bash
# Para macOS Intel (x86_64)
npm run build:mac

# Para macOS Apple Silicon (arm64 - M1/M2/M3/M4)
npx electron-builder --mac dmg --arm64

# Para ambas arquitecturas (Universal / Dual)
npx electron-builder --mac dmg --x64 --arm64
```

### Linux (Debian, Ubuntu, etc.):
```bash
# Genera paquete .deb instalable
npm run build:linux
```

### Windows:
```bash
# Genera instalador NSIS (.exe) y versión portable
npm run build:win
```

Los ejecutables compilados se generan automáticamente en la carpeta `empaquetado/dist/`.

---

## 📄 Licencia y Créditos

Desarrollado por **Miguel Vergara**. Todos los derechos reservados.
Uso exclusivo y desarrollo para DiffCore.
