#!/bin/bash
set -e

echo ""
echo "=========================================================="
echo "⚡ Instalador Local de Prueba DiffCore para macOS"
echo "=========================================================="
echo ""

ARCH="$(uname -m)"
echo "🖥️  Arquitectura detectada: $ARCH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="$(cd "$SCRIPT_DIR/../empaquetado/dist" && pwd)"

if [ "$ARCH" = "arm64" ]; then
    DMG_PATH="$DIST_DIR/DiffCore-1.0.0-arm64.dmg"
else
    DMG_PATH="$DIST_DIR/DiffCore-1.0.0-x64.dmg"
fi

if [ ! -f "$DMG_PATH" ]; then
    echo "✗ Error: No se encontró el instalador en $DMG_PATH"
    exit 1
fi

MOUNT_DIR="/tmp/diffcore-local-mount-$$"

echo "📂 Extrayendo aplicación desde $(basename "$DMG_PATH")..."
mkdir -p "$MOUNT_DIR"
hdiutil attach "$DMG_PATH" -mountpoint "$MOUNT_DIR" -nobrowse -quiet

echo "🚀 Instalando en /Applications..."
rm -rf /Applications/DiffCore.app
cp -R "$MOUNT_DIR/DiffCore.app" /Applications/

echo "💿 Limpiando montura temporal..."
hdiutil detach "$MOUNT_DIR" -quiet || true
rm -rf "$MOUNT_DIR"

echo "🔒 Desbloqueando permisos de seguridad (Gatekeeper)..."
xattr -cr /Applications/DiffCore.app 2>/dev/null || true

echo ""
echo "=========================================================="
echo "🎉 ¡DiffCore se instaló exitosamente en /Applications!"
echo "=========================================================="
echo ""
echo "🚀 Abriendo DiffCore..."
open /Applications/DiffCore.app
