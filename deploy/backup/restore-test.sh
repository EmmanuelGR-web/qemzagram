#!/bin/sh
# PRUEBA DE RESTAURACIÓN: comprueba que un backup sirve de verdad, sin tocar la base de producción.
#
#   restore-test.sh [archivo]     (sin archivo = el más reciente del destino)
#
# Necesita la clave PRIVADA de age en /run/backup-key.txt (montala solo para esta prueba y sacala después).
# Levanta un PostgreSQL temporal DENTRO de este contenedor, restaura el volcado y verifica:
#   - que pg_restore termine sin errores,
#   - que existan las tablas principales y la tabla de migraciones,
#   - cuántas cuentas, conversaciones y mensajes hay (para compararlos con producción),
#   - que el archivo de fotos/adjuntos se pueda listar.
set -eu
umask 077
KEY=/run/backup-key.txt
: "${BACKUP_PATH:?Falta BACKUP_PATH}"
[ -r "$KEY" ] || { echo "Falta la clave privada en $KEY"; exit 1; }

NAME="${1:-}"
if [ -z "$NAME" ]; then
  NAME=$(rclone lsf --include 'qemzagram-*.tar.age' "destino:${BACKUP_PATH}" | sort | tail -n 1)
  [ -n "$NAME" ] || { echo "No hay backups en destino:${BACKUP_PATH}"; exit 1; }
fi

WORK=$(mktemp -d /tmp/qzrestore.XXXXXX)
chmod 0755 "$WORK"
PGDATA_TMP="$WORK/pgdata"
cleanup() {
  su-exec postgres pg_ctl -D "$PGDATA_TMP" -m immediate stop > /dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap 'cleanup' EXIT

echo "1/4 Descargando ${NAME}…"
rclone copyto "destino:${BACKUP_PATH}/${NAME}" "$WORK/backup.tar.age"

echo "2/4 Descifrando…"
age --decrypt --identity "$KEY" "$WORK/backup.tar.age" | tar -C "$WORK" -xf -
rm -f "$WORK/backup.tar.age"

echo "3/4 Restaurando en un PostgreSQL temporal (aislado, sin red)…"
mkdir -p "$PGDATA_TMP" "$WORK/sock"
chown -R postgres:postgres "$PGDATA_TMP" "$WORK/sock"
chmod 0644 "$WORK/db.dump"
su-exec postgres initdb -D "$PGDATA_TMP" -U postgres --auth=trust > /dev/null
su-exec postgres pg_ctl -D "$PGDATA_TMP" -o "-c listen_addresses='' -k $WORK/sock" -w start > /dev/null
su-exec postgres createdb -h "$WORK/sock" -U postgres restaurada
su-exec postgres pg_restore --exit-on-error --no-owner --no-privileges -h "$WORK/sock" -U postgres -d restaurada "$WORK/db.dump"

q() { su-exec postgres psql -h "$WORK/sock" -U postgres -d restaurada -tAc "$1"; }
for table in users conversations messages attachments audit_log; do
  [ "$(q "select to_regclass('public.$table') is not null")" = "t" ] || { echo "✗ Falta la tabla $table"; exit 1; }
done
MIGRATIONS=$(q "select count(*) from drizzle.__drizzle_migrations")
USERS=$(q "select count(*) from users")
CHATS=$(q "select count(*) from conversations")
MESSAGES=$(q "select count(*) from messages")

echo "4/4 Revisando archivos…"
FILES=$(tar -tf "$WORK/files.tar" | grep -vc '/$' || true)

echo ""
echo "✔ Restauración de prueba OK: ${NAME}"
echo "   migraciones aplicadas: ${MIGRATIONS}"
echo "   cuentas: ${USERS} · conversaciones: ${CHATS} · mensajes: ${MESSAGES}"
echo "   archivos (fotos de perfil y adjuntos en disco): ${FILES}"
echo "   (Comparalos con producción. Los mensajes siguen cifrados: hace falta MESSAGE_ENC_KEY para leerlos.)"
