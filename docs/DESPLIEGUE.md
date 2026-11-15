# Despliegue de Qemzagram (gratis, en Oracle Cloud)

Guía paso a paso para publicar Qemzagram en internet **sin pagar nada**, para un grupo chico de personas. Todo corre en un solo servidor gratuito de Oracle Cloud ("Always Free"), con HTTPS automático.

| Pieza | Servicio gratis | Para qué |
|---|---|---|
| Servidor | **Oracle Cloud Always Free** (Ampere A1, ARM64: hasta 4 núcleos y 24 GB de RAM) | API, web, base de datos, antivirus y llamadas |
| Dirección | **DuckDNS** (`tunombre.duckdns.org`) | Dominio gratis que apunta al servidor |
| HTTPS | **Let's Encrypt** vía **Caddy** | Certificados automáticos y renovados solos |
| Archivos | **Backblaze B2** (10 GB gratis, sin tarjeta) | Adjuntos cifrados fuera del servidor |
| Correos | **Brevo** (300/día) o Gmail con contraseña de aplicación | Verificación y recuperación de cuentas |

> ⚠️ **Límites honestos del plan gratis**
> - Oracle pide una **tarjeta** solo para verificar identidad (no cobra mientras uses recursos "Always Free"). A veces rechaza registros o no tiene capacidad ARM en la región: probá en otro momento.
> - Oracle puede **recuperar instancias gratis "ociosas"** (uso de CPU, red y memoria bajo durante 7 días). Pasar la cuenta a "Pay As You Go" lo evita y sigue sin costo si no te salís de lo gratis, pero revisá los avisos de facturación. Por eso los **backups fuera del servidor** (paso 4 del despliegue) no son opcionales.
> - Es **un solo servidor**: si se cae, se cae todo. Para unos pocos usuarios está bien; para público general, no.

---

## 1. Crear el servidor en Oracle Cloud

1. Creá la cuenta en <https://www.oracle.com/cloud/free/>. La **región de inicio no se puede cambiar**: elegí una cercana (por ejemplo *Brazil East (São Paulo)* o *Chile Central (Santiago)*).
2. Menú → **Compute → Instances → Create instance**:
   - **Image:** Canonical **Ubuntu 24.04**.
   - **Shape:** *Ampere* → `VM.Standard.A1.Flex` con **4 OCPU y 24 GB** (si no hay capacidad, 2 OCPU y 12 GB también alcanza).
   - **Networking:** que tenga **IP pública**.
   - **SSH keys:** subí tu clave pública (o descargá la que genera Oracle y guardala bien).
   - **Boot volume:** 100 GB (gratis hasta 200 GB en total).
3. Anotá la **IP pública** de la instancia.

### 1.1 Abrir los puertos (dos lugares)

Oracle tiene **dos firewalls** y hay que abrir los puertos en los dos:

**a) En la consola de Oracle:** instancia → *Subnet* → *Security List* → **Add Ingress Rules** (origen `0.0.0.0/0`):

| Puerto | Protocolo | Para qué |
|---|---|---|
| 80 | TCP | Let's Encrypt y redirección a HTTPS |
| 443 | TCP | Sitio (HTTPS) |
| 443 | UDP | HTTP/3 (opcional) |
| 7881 | TCP | Llamadas (medios por TCP, respaldo) |
| 7882 | UDP | Llamadas (medios) |

**b) Dentro del servidor** (las imágenes de Ubuntu de Oracle traen reglas `iptables` que bloquean todo):

```bash
ssh ubuntu@TU_IP
sudo iptables -I INPUT 6 -p tcp -m multiport --dports 80,443,7881 -m state --state NEW -j ACCEPT
sudo iptables -I INPUT 6 -p udp -m multiport --dports 443,7882 -j ACCEPT
sudo netfilter-persistent save
```

### 1.2 Endurecer el servidor (5 minutos)

```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install unattended-upgrades   # parches de seguridad automáticos
sudo dpkg-reconfigure -plow unattended-upgrades
```

El acceso SSH de Oracle ya es **solo con clave** (sin contraseña). No abras el puerto 22 a más de lo necesario y **nunca** compartas la clave privada.

## 2. Dominio gratis con DuckDNS

1. Entrá a <https://www.duckdns.org> (con GitHub o Google).
2. Creá un subdominio, por ejemplo `qemzagram` → queda `qemzagram.duckdns.org`.
3. En **current ip** poné la **IP pública** del servidor y tocá *update ip*.

DuckDNS también resuelve `livekit.qemzagram.duckdns.org` (lo usan las llamadas): no hay que configurar nada más.

## 3. Archivos en Backblaze B2

1. Creá la cuenta en <https://www.backblaze.com/cloud-storage> (10 GB gratis, sin tarjeta).
2. **Buckets → Create a Bucket:** nombre único (por ejemplo `qemzagram-media-xxxx`), **Files in Bucket: Private**. Anotá el **Endpoint** (algo como `s3.us-east-005.backblazeb2.com`).
3. **Application Keys → Add a New Application Key:** acceso **solo a ese bucket**, *Read and Write*. Anotá `keyID` y `applicationKey` (esta última se muestra **una sola vez**).

Los archivos llegan a B2 **ya cifrados** por la API: Backblaze no puede ver fotos, audios ni documentos.

## 4. Correo (SMTP)

**Brevo** (recomendado): creá la cuenta en <https://www.brevo.com>, verificá un remitente (tu correo) y en *SMTP & API* creá una **clave SMTP**. Datos: `smtp-relay.brevo.com`, puerto `587`.

> Oracle bloquea el puerto 25: usá siempre **587**. Sin un dominio propio los correos pueden ir a spam: avisales a tus usuarios que revisen esa carpeta.

## 5. Instalar Docker y bajar el código

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu && exit     # salí y volvé a entrar por SSH para que tome el grupo
```

El repositorio es **privado**: la forma más segura es una **deploy key** (clave SSH de solo lectura para este repo):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/qemzagram_deploy -N ""
cat ~/.ssh/qemzagram_deploy.pub     # pegala en GitHub → repo → Settings → Deploy keys (SIN permiso de escritura)
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/qemzagram_deploy
EOF
git clone git@github.com:EmmanuelGR-web/qemzagram.git && cd qemzagram
```

## 6. Configuración con secretos

```bash
docker run --rm -v "$PWD":/repo -w /repo node:24-bookworm-slim node scripts/setup-env.mjs --produccion
nano deploy/.env
```

Completá lo marcado con `← COMPLETAR`: `DOMAIN`, `ACME_EMAIL`, `SMTP_*`, `MAIL_FROM` y `S3_*`. Los demás secretos ya se generaron al azar.

> 🔐 **Guardá una copia de `deploy/.env` fuera del servidor** (por ejemplo en un gestor de contraseñas). Sin `PASSWORD_PEPPER` y `MESSAGE_ENC_KEY` un backup de la base **no sirve**: nadie podría iniciar sesión ni leer los mensajes guardados.

## 7. Levantar todo

```bash
cd deploy
docker compose -f docker-compose.prod.yml up -d --build
```

La primera vez tarda (unos 10–15 minutos): compila la API y la web para ARM64 y el antivirus baja sus firmas. Para ver cómo va:

```bash
docker compose -f docker-compose.prod.yml ps          # todos deberían quedar "healthy" / "running"
docker compose -f docker-compose.prod.yml logs -f api # Ctrl+C para salir
```

Abrí `https://TU_DOMINIO`: debería cargar con el candado de HTTPS. Creá tu cuenta y probá un chat, una foto y una llamada.

### 7.1 Darte el rol de soporte

```bash
docker compose -f docker-compose.prod.yml exec api node dist/support/support-role.cli.js grant @tutag
```

Al entrar, el panel de soporte te va a pedir activar la verificación en dos pasos (obligatoria para soporte).

## 8. Actualizar a una versión nueva

**Antes de actualizar, mirá que el commit esté en verde en GitHub (pestaña *Actions*).** Además de los tests, la CI construye las imágenes de producción (job *Imágenes Docker*) y las prueba: la API arranca contra un PostgreSQL real, corre las migraciones y responde `/health`, y la web responde y hace de proxy a la API. También valida `docker-compose.prod.yml`, revisa los scripts de backup con `shellcheck` y comprueba que los contenedores no corran como root. Si ese job está en rojo, **no actualices el servidor**.

En cada push las imágenes se prueban en amd64, que es rápido. Los Dockerfiles son los mismos para ARM64, pero si cambiaste algo de Docker podés probar la arquitectura exacta de Oracle: *Actions → CI → Run workflow → plataforma `linux/arm64`*. Se emula con QEMU, así que tarda bastante más y gasta más minutos gratis. En el servidor la compilación es nativa en ARM64. **No construyas las imágenes en tu PC**: con 8 GB de RAM la compilación de Next.js la puede congelar.

```bash
cd ~/qemzagram && git pull
cd deploy && docker compose -f docker-compose.prod.yml up -d --build
docker image prune -f   # borra imágenes viejas (libera disco)
```

Las migraciones de la base corren solas al arrancar la API. **Antes de actualizar, hacé un backup** (ver abajo).

## 9. Qué queda expuesto y qué no

- **Abierto a internet:** solo Caddy (80/443) y los medios de LiveKit (7881/tcp, 7882/udp).
- **Solo dentro de Docker:** PostgreSQL, la API, la web y ClamAV. La base de datos **no** tiene puerto publicado.
- La API y la web corren **sin root**, con el sistema de archivos **de solo lectura** (salvo sus carpetas de datos) y `no-new-privileges`.
- Caddy reemplaza el `X-Forwarded-For` que mande el cliente: la API ve la IP real (para los límites de peticiones y el bloqueo de logins) y nadie la puede falsificar.

## 10. Problemas frecuentes

| Síntoma | Causa probable |
|---|---|
| El navegador no conecta | Faltan los puertos 80/443 en la *Security List* o en `iptables` (paso 1.1) |
| Caddy no consigue el certificado | DuckDNS no apunta a la IP correcta o el puerto 80 está cerrado |
| La API reinicia en bucle | `docker compose logs api`: dice qué variable de `deploy/.env` falta o es inválida |
| `api` espera a `clamav` | Normal la primera vez: el antivirus baja ~300 MB de firmas (hasta 10 min) |
| Las llamadas conectan pero sin audio/video | Faltan 7881/tcp o 7882/udp en alguno de los dos firewalls |
| No llegan los correos | Revisá `SMTP_*`, el remitente verificado en Brevo y la carpeta de spam |

---

## 11. Backups (diarios, cifrados y fuera del servidor)

El servicio `backup` del compose hace **todos los días** (por defecto a las 3:00 de Argentina):

1. `pg_dump` de la base y verificación de que el volcado se puede leer.
2. Copia de las fotos de perfil y de los adjuntos en disco (si usás `STORAGE_DRIVER=local`).
3. Todo junto, **cifrado con [age](https://age-encryption.org)** para tu clave **pública**. El servidor **no** tiene la clave privada: si alguien lo hackea, no puede abrir los backups.
4. Subida con verificación de integridad a un **bucket de B2 distinto** del de los adjuntos.

> Los adjuntos guardados en B2 (`STORAGE_DRIVER=s3`) ya están fuera del servidor. Para protegerlos de un borrado accidental, activá en ese bucket la opción de B2 **"Keep all versions"** (o *Object Lock*).

### 11.1 Configurarlo (una sola vez)

1. **Clave de backups** (en el servidor, sin guardarla en disco):
   ```bash
   cd ~/qemzagram/deploy
   docker compose -f docker-compose.prod.yml run --rm --no-deps backup age-keygen
   ```
   Muestra dos líneas: `# public key: age1…` y `AGE-SECRET-KEY-1…`. **Copiá la secreta en tu gestor de contraseñas** (junto con `deploy/.env`) y poné la pública en `BACKUP_AGE_RECIPIENT`. Sin la clave secreta los backups **no se pueden abrir**: ni vos ni nadie.
2. **Bucket de backups en B2:** otro bucket privado (por ejemplo `qemzagram-backups-xxxx`). En *Lifecycle Settings* creá una regla personalizada para `backups/`: **ocultar a los 14 días y borrar 1 día después** (así se guardan las últimas 2 semanas).
3. **Clave de B2 solo para backups:** acceso solo a ese bucket, con permiso de **leer, escribir y listar pero NO de borrar**. En la web de B2, *Read and Write* incluye borrar; para el modo más seguro creala con la [CLI de B2](https://www.backblaze.com/docs/cloud-storage-command-line-tools): `b2 key create --bucket qemzagram-backups-xxxx qz-backups listBuckets,listFiles,readFiles,writeFiles`. Así, ni con el servidor tomado se pueden borrar los backups. En ese caso dejá `BACKUP_KEEP_DAYS=0` (la limpieza la hace la regla de B2).
4. Completá `BACKUP_*` en `deploy/.env` y reiniciá: `docker compose -f docker-compose.prod.yml up -d`.
5. **Hacé un backup ya** para comprobar que funciona:
   ```bash
   docker compose -f docker-compose.prod.yml exec backup backup.sh
   ```

### 11.2 Aviso si un backup falta (gratis)

Creá un "check" en <https://healthchecks.io> (gratis, sin tarjeta) con período de **1 día** y poné su URL en `BACKUP_PING_URL`. Si un día el backup falla o no corre, te llega un correo.

### 11.3 Prueba de restauración (una vez por mes)

Un backup que nunca se probó **no es un backup**. Esta prueba baja el último backup, lo descifra, lo restaura en un PostgreSQL **temporal y aislado** (dentro del contenedor, sin red y sin tocar producción) y verifica tablas, migraciones y cantidades:

```bash
cd ~/qemzagram/deploy
nano /dev/shm/clave.txt          # pegá la línea AGE-SECRET-KEY-1… (queda en RAM, no en el disco)
docker compose -f docker-compose.prod.yml run --rm --no-deps -v /dev/shm/clave.txt:/run/backup-key.txt:ro backup restore-test.sh
shred -u /dev/shm/clave.txt      # borrá la clave apenas termina
```

Compará las cantidades (cuentas, conversaciones, mensajes) con las de producción.

### 11.4 Restaurar de verdad (desastre)

Si el servidor se perdió: creá uno nuevo (pasos 1 a 6) con **el mismo `deploy/.env`** (sin `PASSWORD_PEPPER` y `MESSAGE_ENC_KEY` originales, nadie puede iniciar sesión ni leer los mensajes). Después:

```bash
cd ~/qemzagram/deploy
docker compose -f docker-compose.prod.yml up -d db                 # solo la base, vacía
nano /dev/shm/clave.txt                                             # la clave secreta de age
docker compose -f docker-compose.prod.yml run --rm --no-deps -v /dev/shm/clave.txt:/run/backup-key.txt:ro backup sh -c '
  set -e; f=$(rclone lsf --include "qemzagram-*.tar.age" "destino:$BACKUP_PATH" | sort | tail -n 1)
  rclone cat "destino:$BACKUP_PATH/$f" | age -d -i /run/backup-key.txt | tar -C /tmp -xf -
  pg_restore --exit-on-error --no-owner --no-privileges -d "$DATABASE_URL" /tmp/db.dump
  echo "Base restaurada desde $f. Archivos en disco: /tmp/files.tar (ver abajo)."'
shred -u /dev/shm/clave.txt
docker compose -f docker-compose.prod.yml up -d                     # levanta todo
```

Si usabas `STORAGE_DRIVER=local`, restaurá también `files.tar` en los volúmenes `api-uploads` y `api-media` (con `STORAGE_DRIVER=s3` los adjuntos siguen en B2; solo hay que restaurar las fotos de perfil de `uploads`).

## 12. Monitoreo y alertas (gratis)

| Qué | Cómo | Te avisa si… |
|---|---|---|
| Sitio caído | [UptimeRobot](https://uptimerobot.com) (gratis): monitor HTTPS de `https://TU_DOMINIO/api/health` cada 5 min | La API o la base no responden, o vence el certificado |
| Backups | healthchecks.io (§11.2) | Un día no hubo backup |
| Contenedores | `docker compose ps` (todos con `restart: unless-stopped` y *healthchecks*) | — (se reinician solos si se caen) |
| Logs | `docker compose logs --since 1h api` (rotan solos: 5 × 10 MB por servicio) | — |
| Disco | `df -h` y `docker system df` una vez por semana | — |
| Dependencias | Dependabot + CI en GitHub | Hay una actualización de seguridad |

`/api/health` responde `{"status":"ok"}` solo si la API **y** la base de datos funcionan; no revela ningún dato.

## 13. Si algo sale mal (respuesta a incidentes)

1. **Contener:** si sospechás un acceso indebido, cortá el tráfico (`docker compose stop caddy`) pero **no borres nada** (los logs y la base son evidencia).
2. **Evaluar:** revisá `audit_log` (inicios de sesión, cambios de contraseña, acciones de soporte) y los logs de `api` y `caddy`.
3. **Rotar secretos** según lo comprometido:
   - `JWT_ACCESS_SECRET` / `JWT_TICKET_SECRET`: cambiarlos cierra **todas** las sesiones (seguro y sin pérdida de datos).
   - Claves de B2, SMTP, LiveKit y VAPID: se regeneran en cada servicio y se actualizan en `deploy/.env`.
   - `PASSWORD_PEPPER` y `MESSAGE_ENC_KEY` **no se pueden cambiar** sin una migración (romperían todas las contraseñas y los mensajes guardados): protegelos como lo más valioso.
4. **Avisar:** si se expusieron datos personales, la Ley 25.326 obliga a medidas de seguridad y la AAIP recomienda notificar a las personas afectadas y a la Agencia. Consultá con un/a profesional.
5. **Aprender:** anotá qué pasó, cómo se detectó y qué se cambió para que no vuelva a pasar.
