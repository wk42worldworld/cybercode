# CyberCode Usage Analytics

Small self-hosted service for anonymous installation, activity, and coarse
geographic distribution counts.

## Data collected

- Product-scoped random installation hash
- CyberCode version
- Operating system and CPU architecture
- Desktop or CLI entry point
- Country and first-level administrative region resolved locally by the server

The client payload contains no location or IP field. Nginx passes the current
connection address only to the local service, which resolves it against an
offline DB-IP Lite database and immediately discards it. SQLite stores only the
country code, localized country name, and first-level administrative region.
The service does not store IP addresses, cities, coordinates, usernames, device
names, project paths, prompts, conversations, model settings, or credentials.
The Nginx heartbeat location must keep `access_log off`.

## Install

```bash
sudo useradd --system --home /opt/cybercode-usage --shell /usr/sbin/nologin cybercode-usage
sudo install -d -o cybercode-usage -g cybercode-usage /opt/cybercode-usage /var/lib/cybercode-usage
sudo install -d -o root -g root /opt/cybercode-usage/vendor /opt/cybercode-usage/assets
sudo install -o root -g root -m 0755 server.py /opt/cybercode-usage/server.py
sudo install -o root -g root -m 0755 update_geoip.py /opt/cybercode-usage/update_geoip.py
sudo install -o root -g root -m 0644 dashboard.html /opt/cybercode-usage/dashboard.html
sudo install -o root -g root -m 0644 login.html /opt/cybercode-usage/login.html
sudo install -o root -g root -m 0644 assets/echarts.min.js assets/world.geojson /opt/cybercode-usage/assets/
sudo install -o root -g root -m 0644 cybercode-usage.service /etc/systemd/system/cybercode-usage.service
sudo install -o root -g root -m 0644 cybercode-usage-geodb.service /etc/systemd/system/cybercode-usage-geodb.service
sudo install -o root -g root -m 0644 cybercode-usage-geodb.timer /etc/systemd/system/cybercode-usage-geodb.timer
```

Install the MMDB reader. On OpenCloudOS/RHEL-family systems, prefer the OS
package:

```bash
sudo dnf install -y python3-maxminddb
```

On other systems, install the pinned package into the service-local vendor
directory:

```bash
sudo python3 -m pip install --no-cache-dir --target /opt/cybercode-usage/vendor -r requirements.txt
```

Create `/etc/cybercode-usage.env` with mode `0600`:

```text
CYBERCODE_ANALYTICS_ADMIN_USER=admin
CYBERCODE_ANALYTICS_ADMIN_PASSWORD=<long-random-password>
CYBERCODE_ANALYTICS_DB=/var/lib/cybercode-usage/usage.sqlite3
CYBERCODE_GEOIP_DB=/var/lib/cybercode-usage/dbip-city-lite.mmdb
```

Merge `nginx.locations.conf` into the site's existing Nginx configuration,
then validate and start:

```bash
sudo systemctl daemon-reload
sudo systemctl start cybercode-usage-geodb.service
sudo systemctl enable --now cybercode-usage cybercode-usage-geodb.timer
sudo nginx -t
sudo systemctl reload nginx
```

The dashboard is available at `/cybercode-stats` and uses a branded web login
that creates an HttpOnly, SameSite=Strict signed session cookie for 12 hours.
Proactive HTTP Basic credentials remain supported for scripts, but unauthorized
browser requests never emit a Basic challenge. The heartbeat endpoint is public,
strictly validated, rate-limited, and de-duplicated by installation and
China-local calendar day.
The monthly timer refreshes DB-IP Lite atomically; the running service notices a
new database automatically. Existing SQLite databases are migrated in place and
existing users remain counted as unknown region until their next heartbeat.
