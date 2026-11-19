#!/bin/bash
# backend/scripts/backup.sh
# Respaldo automático de la base de datos BarberAg (RNF-27: copias diarias,
# retención mínima de 30 días).
#
# Uso manual:   bash backup.sh
# Uso con cron: ver crontab.ejemplo en esta misma carpeta.

set -e

# ── Configuración (lee del .env si existe, si no usa estos valores por defecto) ──
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

BACKUP_DIR="${BACKUP_DIR:-$SCRIPT_DIR/../backups}"
RETENCION_DIAS="${BACKUP_RETENCION_DIAS:-30}"

mkdir -p "$BACKUP_DIR"

FECHA=$(date +%Y-%m-%d_%H-%M-%S)
ARCHIVO="$BACKUP_DIR/barberag_${FECHA}.sql.gz"

echo "→ Generando respaldo de '$DB_NAME' en $ARCHIVO ..."

mysqldump \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --user="$DB_USER" \
  --password="$DB_PASSWORD" \
  --single-transaction \
  --routines \
  --triggers \
  --default-character-set=utf8mb4 \
  "$DB_NAME" | gzip > "$ARCHIVO"

TAMANO=$(du -h "$ARCHIVO" | cut -f1)
echo "✅ Respaldo completado: $ARCHIVO ($TAMANO)"

# ── Rotación: elimina respaldos con más de N días (RNF-27) ──
echo "→ Eliminando respaldos con más de $RETENCION_DIAS días..."
find "$BACKUP_DIR" -name "barberag_*.sql.gz" -type f -mtime "+$RETENCION_DIAS" -print -delete

echo "✅ Listo. Respaldos actuales en $BACKUP_DIR:"
ls -lh "$BACKUP_DIR" | grep barberag_ || echo "  (ninguno todavía además del recién creado)"
