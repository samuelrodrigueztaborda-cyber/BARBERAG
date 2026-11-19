#!/bin/bash
# backend/scripts/restore.sh
# Restaura la base de datos BarberAg desde un archivo de respaldo generado por backup.sh
#
# Uso: bash restore.sh /ruta/al/archivo/barberag_2026-08-22_10-00-00.sql.gz
#
# ⚠️  ADVERTENCIA: esto SOBRESCRIBE todos los datos actuales de la base de
# datos con los del respaldo. Úsalo solo cuando estés seguro.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"
if [ -f "$ENV_FILE" ]; then
  export $(grep -v '^#' "$ENV_FILE" | grep -v '^$' | xargs)
fi

DB_HOST="${DB_HOST:-localhost}"
DB_USER="${DB_USER:-barberag_user}"
DB_PASSWORD="${DB_PASSWORD:-barberag_pass}"
DB_NAME="${DB_NAME:-barberag_db}"
DB_PORT="${DB_PORT:-3306}"

ARCHIVO="$1"
if [ -z "$ARCHIVO" ]; then
  echo "❌ Debes indicar el archivo de respaldo a restaurar."
  echo "   Uso: bash restore.sh /ruta/al/archivo/barberag_YYYY-MM-DD_HH-MM-SS.sql.gz"
  exit 1
fi
if [ ! -f "$ARCHIVO" ]; then
  echo "❌ No se encontró el archivo: $ARCHIVO"
  exit 1
fi

echo "⚠️  Esto reemplazará TODOS los datos actuales de la base '$DB_NAME'."
read -p "¿Continuar? (escribe 'si' para confirmar): " CONFIRMACION
if [ "$CONFIRMACION" != "si" ]; then
  echo "Cancelado."
  exit 0
fi

echo "→ Restaurando desde $ARCHIVO ..."
gunzip -c "$ARCHIVO" | mysql \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --user="$DB_USER" \
  --password="$DB_PASSWORD" \
  --default-character-set=utf8mb4 \
  "$DB_NAME"

echo "✅ Restauración completada."
