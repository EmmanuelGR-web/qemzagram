#!/bin/sh
# Backup completo de Qemzagram: base de datos + fotos de perfil + adjuntos en disco (si STORAGE_DRIVER=local).
#
#  1. pg_dump en formato "custom" y verificación de que el volcado se puede leer (pg_restore --list).
#  2. Todo junto en un .tar, CIFRADO con age para la clave PÚBLICA BACKUP_AGE_RECIPIENT.
#     El servidor NO tiene la clave privada: si lo hackean, los backups viejos siguen ilegibles.
#  3. Subida con rclone al destino "destino:" (bucket de backups, distinto del de los adjuntos)
#     con verificación de integridad (y, si BACKUP_KEEP_DAYS > 0, borra los de más de esos días).
#  4. Aviso opcional a healthchecks.io (BACKUP_PING_URL): si un día no llega, te manda un correo.
set -eu
umask 077

: "${DATABASE_URL:?Falta DATABASE_URL}"
: "${BACKUP_AGE_RECIPIENT:?Falta BACKUP_AGE_RECIPIENT (clave pública age1...)}"
: "${BACKUP_PATH:?Falta BACKUP_PATH (bucket/carpeta de destino)}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-0}"

ping() {
  [ -n "${BACKUP_PING_URL:-}" ] && wget -q -T 10 -O /dev/null "${BACKUP_PING_URL}$1" || true
}

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
NAME="qemzagram-${STAMP}.tar.age"
WORK=$(mktemp -d /tmp/qzbackup.XXXXXX)
# Al salir (bien o mal): se borran los temporales y, si algo falló, se avisa a healthchecks.io.
finish() {
  code=$?
  rm -rf "$WORK"
  [ "$code" -ne 0 ] && { echo "✗ Backup ${NAME} falló (código ${code})"; ping /fail; }
  exit "$code"
}
trap finish EXIT
trap 'exit 130' INT TERM
ping /start

echo "[$(date -u +%FT%TZ)] Backup ${NAME}: volcando la base…"
pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" --file="$WORK/db.dump"
pg_restore --list "$WORK/db.dump" > /dev/null

# Archivos en disco (los volúmenes se montan en solo lectura). Si están vacíos igual se incluye la carpeta.
tar -C /data -cf "$WORK/files.tar" uploads media

tar -C "$WORK" -cf - db.dump files.tar | age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" --output "$WORK/$NAME"
rm -f "$WORK/db.dump" "$WORK/files.tar"
SIZE=$(du -h "$WORK/$NAME" | cut -f1)

echo "[$(date -u +%FT%TZ)] Subiendo ${NAME} (${SIZE})…"
# copyto verifica el hash del archivo subido cuando el destino lo permite.
rclone copyto --retries 5 "$WORK/$NAME" "destino:${BACKUP_PATH}/${NAME}"
# KEEP_DAYS=0: no se borra nada desde acá (lo recomendado: la clave no puede borrar y la regla de ciclo
# de vida del bucket limpia los viejos). >0: borra los backups con más de esos días.
if [ "$KEEP_DAYS" -gt 0 ]; then
  rclone delete --min-age "${KEEP_DAYS}d" --include 'qemzagram-*.tar.age' "destino:${BACKUP_PATH}" || echo "⚠ No se pudieron borrar backups viejos"
fi

echo "[$(date -u +%FT%TZ)] ✔ Backup listo: ${NAME} (${SIZE})."
ping ""
