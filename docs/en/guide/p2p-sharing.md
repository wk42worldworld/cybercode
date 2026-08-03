# P2P model sharing

P2P sharing lets another CyberCode device use models configured on your computer through an 8-character pairing code. Provider API keys always remain on the sharing device.

## Connect

1. On the sharing device, open **Models & routing → Model sharing → P2P sharing** and enable **Share my models**.
2. Send the displayed 8-character pairing code to the other person.
3. On the joining device, enter that code and click **Connect**. There is no server address to configure.
4. CyberCode completes signaling, NAT traversal, and the encrypted connection automatically, then creates and activates a P2P provider locally.
5. The sharing device can revoke any connected device independently.

Pairing codes rotate automatically without interrupting established connections. One sharing device can serve multiple paired devices at the same time.

## Transport

CyberCode prefers an encrypted device-to-device WebRTC DataChannel. If direct networking, STUN, and TURN are all unavailable, it automatically switches to an encrypted WSS tunnel on the same HTTPS service:

- STUN provides automatic direct NAT traversal on ordinary networks.
- A maintainer-provided TURN service is selected automatically on symmetric NAT or restricted networks.
- When UDP is completely blocked, WSS fallback uses an ephemeral X25519 key per device and carries model payloads and Gateway keys as AES-GCM ciphertext through the relay.
- Every joining device receives an independent, revocable Gateway key.

## Maintainer deployment

End users never enter a server address. Release maintainers run the signaling service and bake its public URL into the desktop build:

```bash
CYBERCODE_P2P_SIGNAL_PORT=8765 bun run p2p:signal
```

Set this Actions variable under **Settings → Secrets and variables → Actions → Variables** in the GitHub repository:

```text
CYBERCODE_P2P_SIGNAL_URL=https://signal.example.com
```

The desktop release workflow embeds this endpoint into all four platform builds. It stops the release when the variable is missing or is not an HTTPS URL.

The reverse proxy must upgrade `/p2p/ws` to WebSocket. Use the automatic transport policy; optional TURN settings are distributed by the signaling service:

```bash
CYBERCODE_P2P_DATA_TRANSPORT=auto
CYBERCODE_P2P_STUN_URLS=stun:stun.cloudflare.com:3478,stun:stun.l.google.com:19302
CYBERCODE_P2P_TURN_URLS=turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp
CYBERCODE_P2P_TURN_SECRET=replace-with-a-long-random-secret
```
