# 🛠️ Guía Maestra de Compilación, Empaquetado y Publicación de DiffCore

> **DOCUMENTO PARA DESARROLLADORES Y ASISTENTES DE IA**  
> Este documento contiene las instrucciones exactas, comandos y estándares arquitectónicos para compilar DiffCore en cualquier equipo (macOS, Windows o Linux) y publicar las releases oficiales sin ambigüedad.

---

## 📌 1. Reglas de Oro Obligatorias (No Romper)

1. **Título de la Release en GitHub:**
   - La Release oficial en GitHub **SIEMPRE DEBE LLAMARSE EXACTAMENTE:**  
     `Release 1.0.0`
   - **NUNCA** usar el nombre de la rama (ej. NO usar "Release feature_16102026"). El script `scripts/release.js` ya garantiza este nombre.
2. **Los 7 Artefactos Oficiales de la Release:**
   Cada Release debe contener los 7 instaladores oficiales multiplataforma:
   1. `DiffCore-1.0.0-arm64.dmg` → macOS Apple Silicon (M1/M2/M3/M4)
   2. `DiffCore-1.0.0-x64.dmg` → macOS Apple Intel
   3. `DiffCore.Setup.1.0.0.exe` → Windows 64-bit (Instalador NSIS)
   4. `diffcore_1.0.0_amd64.deb` → Linux Debian / Ubuntu / Mint
   5. `diffcore-1.0.0.x86_64.rpm` → Linux Fedora / RedHat / CentOS / openSUSE
   6. `DiffCore-1.0.0.AppImage` → Linux Universal Portable (funciona en cualquier distro)
   7. `diffcore-1.0.0.tar.gz` → Linux Tarball genérico sin dependencias
3. **Controles de Ventana en Modales (Comportamiento Nativo por SO):**
   - **macOS (`darwin`):** Botones semáforo en la esquina superior izquierda (🔴 rojo para cerrar con '×' en hover, 🟡 amarillo, 🟢 verde). El botón `✕` de la derecha **debe estar oculto** (`display: none !important;`) para no duplicar controles.
   - **Windows (`win32`):** Sin puntos a la izquierda. Botón de cierre plano rectangular estilo Windows 10/11 en la esquina superior derecha con fondo rojo `#c42b1c` al pasar el mouse.
   - **Linux (`linux`):** Sin puntos a la izquierda. Botón de cierre circular estilo GNOME/Adwaita en la esquina superior derecha.
4. **Empaquetado RPM en macOS:**
   - En macOS, **NUNCA** ejecutar `rpmbuild` directo sobre binarios ELF de Linux porque el motor Homebrew de Darwin crashea con SIGSEGV (error 139).
   - Siempre usar `node scripts/build-rpm.js` o `npm run build:rpm`, el cual utiliza `@goreleaser/nfpm` (empaquetador nativo en Go con cero dependencias externas).

---

## 💻 2. Requisitos Previos

- **Node.js:** Versión 18.x o superior (`node -v`).
- **npm:** Versión 9.x o superior (`npm -v`).
- **Git:** Instalado y configurado con acceso al repositorio.
- **GitHub Token:** Para publicar releases, el script detecta automáticamente el token embebido en `git remote get-url origin` (`https://TOKEN@github.com/...`) o la variable de entorno `GITHUB_TOKEN`.

---

## 🚀 3. Comandos de Compilación (NPM Scripts)

Todos los comandos se ejecutan desde la raíz del proyecto:

```bash
# 1. Instalar dependencias
npm install

# 2. Iniciar en modo desarrollo
npm start

# 3. Compilar instaladores macOS (Apple Silicon + Intel DMG)
npm run build:mac

# 4. Compilar instalador Windows (.exe x64)
npm run build:win

# 5. Compilar todos los paquetes Linux (.deb, .rpm, .AppImage, .tar.gz)
npm run build:linux

# 6. Compilar únicamente el paquete Fedora / RedHat (.rpm)
npm run build:rpm

# 7. Compilar absolutamente TODOS los binarios (macOS + Windows + Linux)
npm run build:all

# 8. Pipeline Completo de Release (Compila todos los binarios y los publica en GitHub)
npm run release

# 9. Subir a GitHub sin volver a compilar (si ya están en empaquetado/dist)
node scripts/release.js --upload-only
```

---

## 📂 4. Estructura de Salida (`empaquetado/dist/`)

Una vez compilado, los binarios se encuentran organizados en:

```
empaquetado/dist/
├── DiffCore-1.0.0-arm64.dmg      (macOS Apple Silicon)
├── DiffCore-1.0.0-x64.dmg        (macOS Apple Intel)
├── DiffCore.Setup.1.0.0.exe      (Windows NSIS Setup x64)
├── diffcore_1.0.0_amd64.deb      (Debian / Ubuntu)
├── diffcore-1.0.0.x86_64.rpm     (Fedora / RedHat / openSUSE)
├── DiffCore-1.0.0.AppImage       (Universal Linux)
└── diffcore-1.0.0.tar.gz         (Tarball Linux genérico)
```

---

## 🔍 5. Arquitectura del Código

- **Proceso Principal (`fuentes/main/`):**
  - `main.js`: Inicialización de `BrowserWindow`, menú nativo, configuración de `titleBarStyle` adaptativa.
  - `preload.js`: Bridge seguro de Electron (`contextBridge.exposeInMainWorld('api', ...)`). Expone `platform: process.platform` para detección de SO.
  - `diffEngine.js`: Algoritmo de comparación Myers Diff alineado idéntico a Beyond Compare 5.
  - `fileOps.js`: Operaciones asíncronas de sistema de archivos, lectura hexadecimal y metadatos. Detección automática de binarios y archivos no soportados.
  - `javaDecompiler.js`: Motor de descompilación Java Bytecode (`Java class to source`) impulsado por `@run-slicer/vf` (Vineflower/Fernflower compilado en WebAssembly/JS nativo). **Zero dependencias de Java**: no requiere tener JRE/JDK instalado en el sistema operativo del usuario.
  - `archiveHandler.js`: Manejador de contenedores de empaquetados Java (`.jar`, `.war`, `.ear`, `.zip`) usando `adm-zip`. Descomprime y virtualiza transparentemente la estructura de directorios en caché temporal (`os.tmpdir()/diffcore-archives/`) para compararla de forma idéntica a carpetas normales en Folder Compare.
  - `menu.js`: Menú de aplicación con atajos de teclado y selección de vistas.
- **Proceso Renderer (`fuentes/renderer/`):**
  - `index.html`: Estructura HTML de todas las vistas (Home, Text Compare, Folder Compare, etc.), modales (`#binaryAlertModal` para archivos binarios no soportados).
  - `js/app.js`: Lógica de interfaz, sincronización de scroll, edición inline, apertura de archivos vacíos preservando la Línea 1, `initModalControls()`, redirección inteligente de drag & drop para `.jar`/`.war`/`.ear`, y detección de clases `.class` para mostrar el badge `Java class to source ▾`.
  - `css/theme-beyond5.css`: Tema visual Beyond Compare 5, estilos para `body.platform-darwin`, `body.platform-win32` y `body.platform-linux`.
- **Scripts de Automatización (`scripts/`):**
  - `scripts/release.js`: Orquestador que compila los 7 paquetes, consulta GitHub Releases por API REST, actualiza el título a `Release 1.0.0`, elimina versiones previas si existen y sube los 7 assets con barra de progreso.
  - `scripts/build-rpm.js`: Generador de paquetes `.rpm` para Fedora/RHEL usando `nfpm`.

---

## 🤖 6. Instrucciones para la Próxima Asistente de IA

Si el usuario te dice:
- *"Empaqueta o compila el proyecto"*:
  Ejecuta `npm run build:all` o `npm run release`.
- *"Sube la release a GitHub"*:
  Ejecuta `npm run release`. Asegúrate de que el título sea `Release 1.0.0`.
- *"Falta el paquete para Fedora"*:
  Ejecuta `npm run build:rpm` o verifica que `diffcore-1.0.0.x86_64.rpm` esté presente en `empaquetado/dist/`.
- *"Revisa los botones de las ventanas o modales"*:
  Asegúrate de que `initModalControls()` en `fuentes/renderer/js/app.js` y las reglas en `fuentes/renderer/css/theme-beyond5.css` se mantengan intactas para macOS, Windows y Linux.
- *"Comparar archivos .class o paquetes .jar/.war/.ear"*:
  - `.class`: Se descompilan al vuelo con `@run-slicer/vf` en `javaDecompiler.js` y se muestran como código fuente Java editable/comparable con badge `Java class to source ▾`.
  - `.jar`, `.war`, `.ear`: Se tratan como carpetas en `archiveHandler.js` y se abren directamente en el Comparador de Carpetas. Si el usuario los arrastra al comparador de texto, DiffCore los redirige automáticamente al Comparador de Carpetas.
  - Archivos binarios no soportados: Se detectan automáticamente en `fileOps.readTextFile` y levantan `#binaryAlertModal` ofreciendo abrirlos en el Comparador Hexadecimal.
