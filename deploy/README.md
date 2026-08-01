# Runbook Deploy — socai.my.id

Template unit systemd untuk web (`socai-node.service`) dan bot Telegram
(`socai-bot.service`). Sesuaikan `WorkingDirectory`, `User/Group`, dan path
`ExecStart` dengan lingkungan masing-masing.

## Prasyarat

- Node.js `>=24` (disarankan via nvm — sesuaikan path di `ExecStart`).
- PostgreSQL berjalan; kredensial di `.env` (jangan commit).
- `NODE_ENV=production` + `SESSION_SECRET` + `APP_URL` wajib diisi di `.env`.
- `node-pg-migrate` terpasang melalui `npm ci`; koneksi migration memakai `DB_HOST`,
  `DB_NAME`, `DB_PORT`, `DB_USER`, dan `DB_PASSWORD` dari `.env`.

## Catatan Timezone (WIB)

Sejak Sprint 3 (temuan audit A4), parsing teks jadwal Indonesia dan generasi
slot kalender memakai zona **WIB (+07:00) eksplisit** (`lib/shared/wibTime.js`) — tidak
bergantung timezone server. Meski demikian, template unit tetap menyetel
`TZ=Asia/Jakarta` agar tooling lain (log, `new Date()` lain) konsisten WIB.

## Instalasi

```bash
sudo cp deploy/socai-node.service deploy/socai-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now socai-node socai-bot
sudo systemctl status socai-node socai-bot
```

## Verifikasi setelah deploy

```bash
# Health web (DB ping)
curl -s http://127.0.0.1:3010/health
# Health harus menunjukkan checks.schema.status = "ok"
curl -s http://127.0.0.1:3010/health | jq '.status, .checks.database, .checks.schema'

# Smoke: login tanpa body tidak boleh 500
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST http://127.0.0.1:3010/login -H 'Content-Type: text/plain' -d 'x=1'
#   → 200 (bukan 500)

# Log
journalctl -u socai-node -n 50 --no-pager
journalctl -u socai-bot -n 50 --no-pager
```

## Update / Restart

```bash
cd /var/www/socai.my.id
git pull
npm ci
npm run migrate:up
sudo systemctl restart socai-node socai-bot
```

Migration dijalankan manual/terpisah dari systemd agar DB user runtime tidak perlu
hak DDL. Restart aman: graceful shutdown (< 5 detik downtime), agent sessions web
di-abort. Jangan restart sebelum `npm run migrate:up` sukses.

## Rollback

```bash
cd /var/www/socai.my.id && git checkout <commit-sebelumnya>
npm run migrate:down  # hanya jika rollback schema memang diperlukan
sudo systemctl restart socai-node socai-bot
```

## Reverse proxy (Apache contoh)

```apache
<VirtualHost *:443>
    ServerName socai.my.id
    ServerAlias www.socai.my.id
    ProxyPreserveHost On
    ProxyRequests Off
    # Hapus header yang dikirim client agar CSRF origin check tidak bisa dispoof
    RequestHeader unset X-Forwarded-Host
    RequestHeader set X-Forwarded-Proto "https"
    ProxyPass / http://127.0.0.1:3010/
    ProxyPassReverse / http://127.0.0.1:3010/
    SSLCertificateFile /etc/letsencrypt/live/socai.my.id/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/socai.my.id/privkey.pem
</VirtualHost>
```
