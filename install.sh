#!/bin/bash
set -e

echo ""
echo "=========================================================="
echo "⚡ Instalador de DiffCore para macOS"
echo "=========================================================="
echo ""

ARCH="$(uname -m)"
echo "🖥️  Arquitectura detectada: $ARCH"

if [ "$ARCH" = "arm64" ]; then
    DMG_NAME="DiffCore-1.0.0-arm64.dmg"
else
    DMG_NAME="DiffCore-1.0.0-x64.dmg"
fi

DOWNLOAD_URL="https://github.com/mvyevenes2-png/homebrew-diffcore/releases/download/v1.0.0/$DMG_NAME"
TMP_DMG="/tmp/$DMG_NAME"
MOUNT_DIR="/tmp/diffcore-mount-$$"

# 1. Descarga directa oficial
echo "⬇️  Descargando $DMG_NAME..."
curl -fL "$DOWNLOAD_URL" -o "$TMP_DMG"

# 2. Montar DMG silenciosamente
echo "📂  Extrayendo aplicación..."
mkdir -p "$MOUNT_DIR"
hdiutil attach "$TMP_DMG" -mountpoint "$MOUNT_DIR" -nobrowse -quiet

# 3. Copiar a /Applications
echo "🚀  Instalando en /Applications..."
rm -rf /Applications/DiffCore.app
cp -R "$MOUNT_DIR/DiffCore.app" /Applications/

# 4. Desmontar y limpiar temporales
echo "💿  Limpiando archivos temporales..."
hdiutil detach "$MOUNT_DIR" -quiet || true
rm -rf "$MOUNT_DIR" "$TMP_DMG"

# 5. Eliminar cuarentena de Gatekeeper para apertura inmediata
echo "🔒  Desbloqueando permisos de seguridad (Gatekeeper)..."
xattr -cr /Applications/DiffCore.app 2>/dev/null || true

echo ""
echo "=========================================================="
echo "🎉 ¡DiffCore se instaló exitosamente en /Applications!"
echo "=========================================================="
echo ""
echo "🚀 Abriendo DiffCore..."
open /Applications/DiffCore.app
