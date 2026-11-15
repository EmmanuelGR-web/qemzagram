#!/bin/sh
# Corre backup.sh una vez por día a la hora BACKUP_HOUR_UTC (por defecto 6 UTC = 3:00 en Argentina).
# Un error en un backup NO detiene el programador: se registra y se reintenta al día siguiente
# (y si configuraste BACKUP_PING_URL, healthchecks.io te avisa por correo que faltó un backup).
set -u
HOUR="${BACKUP_HOUR_UTC:-6}"
case "$HOUR" in ''|*[!0-9]*) echo "BACKUP_HOUR_UTC inválido"; exit 1 ;; esac

echo "Backups programados todos los días a las ${HOUR}:00 UTC."
while true; do
  now=$(date -u +%s)
  wait=$(( (HOUR * 3600 - now % 86400 + 86400) % 86400 ))
  [ "$wait" -eq 0 ] && wait=86400
  sleep "$wait"
  backup.sh || echo "⚠ El backup falló (código $?). Se reintenta mañana."
done
