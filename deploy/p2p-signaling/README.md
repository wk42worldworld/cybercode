# CyberCode P2P signaling deployment

This service is the public rendezvous point used by desktop builds. It prefers
a WebRTC DataChannel and automatically falls back to encrypted WSS frames when
direct networking is unavailable. Fallback payloads use per-peer X25519 keys
and AES-GCM; the relay forwards ciphertext rather than model API payloads.

## Build

Build the standalone Linux binary from the repository root:

```bash
bun build src/server/p2p/relayMain.ts \
  --compile \
  --minify \
  --target=bun-linux-x64-baseline \
  --outfile=build/cybercode-p2p-signal
```

## Install

Create a dedicated system account and install the binary and unit:

```bash
sudo useradd --system --home /opt/cybercode-p2p --shell /usr/sbin/nologin cybercode-p2p
sudo install -d -o root -g root -m 0755 /opt/cybercode-p2p
sudo install -o root -g root -m 0755 build/cybercode-p2p-signal /opt/cybercode-p2p/
sudo install -o root -g root -m 0644 deploy/p2p-signaling/cybercode-p2p.service /etc/systemd/system/
```

Create `/etc/cybercode-p2p.env` with mode `0600`:

```text
CYBERCODE_P2P_SIGNAL_HOST=127.0.0.1
CYBERCODE_P2P_SIGNAL_PORT=8765
CYBERCODE_P2P_DATA_TRANSPORT=auto
CYBERCODE_P2P_STUN_URLS=stun:stun.cloudflare.com:3478,stun:stun.l.google.com:19302
CYBERCODE_P2P_TURN_URLS=turn:43.160.249.187:3478?transport=udp,turn:43.160.249.187:3478?transport=tcp
CYBERCODE_P2P_TURN_SECRET=REPLACE_WITH_A_LONG_RANDOM_SECRET
CYBERCODE_P2P_TURN_CREDENTIAL_TTL_SECONDS=3600
```

Install coturn, copy `turnserver.conf.example` to `/etc/coturn/turnserver.conf`, and
replace its secret with the same value. The host firewall and cloud security
group must allow TCP/UDP 3478 and UDP 49160-49200.

Include `nginx.locations.conf` inside the existing HTTPS server block, then
start the services:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now coturn cybercode-p2p
sudo nginx -t
sudo systemctl reload nginx
```

The desktop build-time endpoint is:

```text
https://www.mybotworld.com/cybercode-p2p
```

Set that value as the repository Actions variable
`CYBERCODE_P2P_SIGNAL_URL`.
