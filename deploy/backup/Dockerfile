# Contenedor de backups: pg_dump (misma versión que la base) + age (cifrado) + rclone (subida a B2/S3).
FROM postgres:16-alpine
RUN apk add --no-cache age rclone tzdata
COPY backup.sh restore-test.sh scheduler.sh /usr/local/bin/
RUN chmod 0755 /usr/local/bin/backup.sh /usr/local/bin/restore-test.sh /usr/local/bin/scheduler.sh
ENTRYPOINT []
CMD ["scheduler.sh"]
