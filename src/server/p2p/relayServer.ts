import { createHash, createHmac, randomUUID } from 'node:crypto'
import type { ServerWebSocket } from 'bun'
import {
  P2P_PAIRING_CODE_PATTERN,
  type P2PDataTransportMode,
  type P2PIceServer,
  type P2PRelayClientMessage,
  type P2PRelayGuestJoin,
  type P2PRelayHostRegister,
  type P2PRelaySignal,
  type P2PRelayTunnelActivate,
  type P2PRelayTunnelFrame,
  type P2PRelayTunnelHandshake,
} from './types.js'

const PAIRING_CODE_TTL_MS = 10 * 60_000
const HOST_RECONNECT_GRACE_MS = 15_000
const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const DEFAULT_TURN_CREDENTIAL_TTL_SECONDS = 60 * 60
const TUNNEL_RATE_WINDOW_MS = 10_000
const TUNNEL_RATE_WINDOW_BYTES = 64 * 1024 * 1024
const MAX_TUNNEL_FRAME_BASE64_CHARS = 132 * 1024

type RelaySocketData = {
  connectionId: string
  role?: 'host' | 'guest'
  sessionId?: string
  peerId?: string
  tunnelWindowStartedAt?: number
  tunnelBytesInWindow?: number
}
type RelaySocket = ServerWebSocket<RelaySocketData>

type RelaySession = {
  id: string
  codeHash: string
  nodeName: string
  dataTransport: P2PDataTransportMode
  host?: RelaySocket
  pairingCodeExpiresAt: number
  guests: Map<string, { socket: RelaySocket; deviceName: string }>
  offlineTimer?: ReturnType<typeof setTimeout>
}

type RelayServerOptions = {
  host?: string
  port?: number
  pairingCodeTtlMs?: number
  /** Kept for compatibility with early local tests. */
  sessionTtlMs?: number
  iceServers?: P2PIceServer[]
  dataTransport?: P2PDataTransportMode
}

function hashCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex')
}

function normalizeCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim().toUpperCase()
  return P2P_PAIRING_CODE_PATTERN.test(code) ? code : null
}

function normalizeTunnelPublicKey(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 40 || value.length > 128) return null
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : null
}

function parseJson(raw: string | Buffer | ArrayBuffer): P2PRelayClientMessage {
  const text = typeof raw === 'string'
    ? raw
    : raw instanceof ArrayBuffer
      ? new TextDecoder().decode(raw)
      : raw.toString('utf8')
  return JSON.parse(text) as P2PRelayClientMessage
}

function send(socket: RelaySocket, message: unknown): void {
  if (socket.readyState === 1) socket.send(JSON.stringify(message))
}

function sendError(socket: RelaySocket, code: string, message: string): void {
  send(socket, { type: 'error', code, message })
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status })
}

function splitServerUrls(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function resolveP2PDataTransport(env: NodeJS.ProcessEnv = process.env): P2PDataTransportMode {
  const value = env.CYBERCODE_P2P_DATA_TRANSPORT?.trim().toLowerCase()
  return value === 'webrtc' || value === 'wss' ? value : 'auto'
}

export function resolveP2PIceServers(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): P2PIceServer[] {
  const stunUrls = splitServerUrls(env.CYBERCODE_P2P_STUN_URLS || env.CYBERCODE_P2P_STUN_URL)
  const servers: P2PIceServer[] = (stunUrls.length > 0
    ? stunUrls
    : ['stun:stun.l.google.com:19302'])
    .map((urls) => ({ urls }))
  const turnUrls = splitServerUrls(env.CYBERCODE_P2P_TURN_URLS || env.CYBERCODE_P2P_TURN_URL)
  const username = env.CYBERCODE_P2P_TURN_USERNAME?.trim()
  const credential = env.CYBERCODE_P2P_TURN_CREDENTIAL?.trim()
  const sharedSecret = env.CYBERCODE_P2P_TURN_SECRET?.trim()
  if (turnUrls.length > 0 && sharedSecret) {
    const requestedTtl = Number(env.CYBERCODE_P2P_TURN_CREDENTIAL_TTL_SECONDS)
    const ttlSeconds = Number.isFinite(requestedTtl)
      ? Math.min(Math.max(Math.floor(requestedTtl), 300), 86_400)
      : DEFAULT_TURN_CREDENTIAL_TTL_SECONDS
    const expiresAt = Math.floor(now / 1_000) + ttlSeconds
    const ephemeralUsername = `${expiresAt}:cybercode`
    const ephemeralCredential = createHmac('sha1', sharedSecret)
      .update(ephemeralUsername)
      .digest('base64')
    servers.push(...turnUrls.map((urls) => ({
      urls,
      username: ephemeralUsername,
      credential: ephemeralCredential,
    })))
  } else if (turnUrls.length > 0 && username && credential) {
    servers.push(...turnUrls.map((urls) => ({ urls, username, credential })))
  }
  return servers
}

export function startP2PRelayServer(options: RelayServerOptions = {}) {
  const sessions = new Map<string, RelaySession>()
  const sessionsByCode = new Map<string, RelaySession>()
  const pairingCodeTtlMs = options.pairingCodeTtlMs ?? options.sessionTtlMs ?? PAIRING_CODE_TTL_MS
  const iceServersForClient = () => options.iceServers ?? resolveP2PIceServers()
  const dataTransport = options.dataTransport ?? resolveP2PDataTransport()

  const removeExpiredPairingCodes = () => {
    const now = Date.now()
    for (const session of sessions.values()) {
      if (session.pairingCodeExpiresAt > now) continue
      if (sessionsByCode.get(session.codeHash) === session) sessionsByCode.delete(session.codeHash)
    }
  }

  const registerHost = (socket: RelaySocket, message: P2PRelayHostRegister) => {
    if (socket.data.role) {
      sendError(socket, 'ALREADY_REGISTERED', 'Signaling connection is already registered')
      return
    }
    const code = normalizeCode(message.code)
    if (!code || message.protocol !== 2) {
      sendError(socket, 'INVALID_REGISTRATION', 'Invalid host registration')
      return
    }
    removeExpiredPairingCodes()
    const codeHash = hashCode(code)
    const resumable = sessionsByCode.get(codeHash)
    if (resumable && !resumable.host) {
      if (resumable.offlineTimer) clearTimeout(resumable.offlineTimer)
      resumable.offlineTimer = undefined
      resumable.host = socket
      socket.data.role = 'host'
      socket.data.sessionId = resumable.id
      send(socket, {
        type: 'registered',
        sessionId: resumable.id,
        pairingCodeExpiresAt: new Date(resumable.pairingCodeExpiresAt).toISOString(),
        iceServers: iceServersForClient(),
        dataTransport: resumable.dataTransport,
      })
      return
    }
    if (resumable) {
      sendError(socket, 'CODE_IN_USE', 'Pairing code is already in use')
      return
    }
    const session: RelaySession = {
      id: randomUUID(),
      codeHash,
      nodeName: typeof message.nodeName === 'string' && message.nodeName.trim()
        ? message.nodeName.trim().slice(0, 80)
        : 'CyberCode',
      dataTransport,
      host: socket,
      pairingCodeExpiresAt: Date.now() + pairingCodeTtlMs,
      guests: new Map(),
    }
    socket.data.role = 'host'
    socket.data.sessionId = session.id
    sessions.set(session.id, session)
    sessionsByCode.set(codeHash, session)
    send(socket, {
      type: 'registered',
      sessionId: session.id,
      pairingCodeExpiresAt: new Date(session.pairingCodeExpiresAt).toISOString(),
      iceServers: iceServersForClient(),
      dataTransport: session.dataTransport,
    })
  }

  const rotateHostCode = (socket: RelaySocket, value: unknown) => {
    if (socket.data.role !== 'host' || !socket.data.sessionId) {
      sendError(socket, 'NOT_REGISTERED', 'Sharing host is not registered')
      return
    }
    const code = normalizeCode(value)
    const session = sessions.get(socket.data.sessionId)
    if (!code || !session || session.host !== socket) {
      sendError(socket, 'INVALID_CODE', 'Invalid pairing code')
      return
    }
    removeExpiredPairingCodes()
    const nextHash = hashCode(code)
    const collision = sessionsByCode.get(nextHash)
    if (collision && collision !== session) {
      sendError(socket, 'CODE_IN_USE', 'Pairing code is already in use')
      return
    }
    if (sessionsByCode.get(session.codeHash) === session) sessionsByCode.delete(session.codeHash)
    session.codeHash = nextHash
    session.pairingCodeExpiresAt = Date.now() + pairingCodeTtlMs
    sessionsByCode.set(nextHash, session)
    send(socket, {
      type: 'registered',
      sessionId: session.id,
      pairingCodeExpiresAt: new Date(session.pairingCodeExpiresAt).toISOString(),
      iceServers: iceServersForClient(),
      dataTransport: session.dataTransport,
    })
  }

  const joinGuest = (socket: RelaySocket, message: P2PRelayGuestJoin) => {
    if (socket.data.role) {
      sendError(socket, 'ALREADY_JOINED', 'Signaling connection is already paired')
      return
    }
    const code = normalizeCode(message.code)
    if (!code || message.protocol !== 2) {
      sendError(socket, 'INVALID_CODE', 'Invalid pairing code')
      return
    }
    removeExpiredPairingCodes()
    const session = sessionsByCode.get(hashCode(code))
    if (!session || !session.host || session.host.readyState !== 1) {
      sendError(socket, 'PAIRING_UNAVAILABLE', 'Pairing code is expired or offline')
      return
    }
    const tunnelPublicKey = normalizeTunnelPublicKey(message.tunnelPublicKey)
    if (session.dataTransport === 'wss' && !tunnelPublicKey) {
      sendError(socket, 'TUNNEL_UNSUPPORTED', 'This CyberCode version does not support the encrypted relay')
      return
    }
    const peerId = randomUUID()
    const deviceName = message.deviceName?.trim().slice(0, 80) || 'CyberCode device'
    socket.data.role = 'guest'
    socket.data.sessionId = session.id
    socket.data.peerId = peerId
    session.guests.set(peerId, { socket, deviceName })
    send(socket, {
      type: 'joining',
      sessionId: session.id,
      peerId,
      nodeName: session.nodeName,
      iceServers: iceServersForClient(),
      dataTransport: session.dataTransport,
    })
    send(session.host, { type: 'join_request', peerId, deviceName, ...(tunnelPublicKey && { tunnelPublicKey }) })
  }

  const forwardPeerMessage = (
    socket: RelaySocket,
    message: P2PRelaySignal | P2PRelayTunnelHandshake | P2PRelayTunnelActivate | P2PRelayTunnelFrame,
  ) => {
    const sessionId = socket.data.sessionId
    if (!sessionId) return sendError(socket, 'NOT_JOINED', 'Signaling connection is not registered')
    const session = sessions.get(sessionId)
    if (!session) return sendError(socket, 'HOST_OFFLINE', 'Sharing host is offline')
    if (socket.data.role === 'host') {
      const guest = session.guests.get(message.peerId)
      if (!guest) return sendError(socket, 'PEER_OFFLINE', 'Joining device is offline')
      send(guest.socket, message)
      return
    }
    if (socket.data.role === 'guest' && socket.data.peerId === message.peerId) {
      if (!session.host || session.host.readyState !== 1) {
        return sendError(socket, 'HOST_OFFLINE', 'Sharing host is offline')
      }
      send(session.host, message)
    }
  }

  const allowTunnelFrame = (socket: RelaySocket, message: P2PRelayTunnelFrame): boolean => {
    if (
      !Number.isSafeInteger(message.seq)
      || message.seq < 0
      || typeof message.dataBase64 !== 'string'
      || message.dataBase64.length === 0
      || message.dataBase64.length > MAX_TUNNEL_FRAME_BASE64_CHARS
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(message.dataBase64)
    ) {
      sendError(socket, 'INVALID_TUNNEL_FRAME', 'Invalid encrypted relay frame')
      return false
    }
    const now = Date.now()
    if (!socket.data.tunnelWindowStartedAt || now - socket.data.tunnelWindowStartedAt >= TUNNEL_RATE_WINDOW_MS) {
      socket.data.tunnelWindowStartedAt = now
      socket.data.tunnelBytesInWindow = 0
    }
    socket.data.tunnelBytesInWindow = (socket.data.tunnelBytesInWindow ?? 0) + message.dataBase64.length
    if (socket.data.tunnelBytesInWindow > TUNNEL_RATE_WINDOW_BYTES) {
      sendError(socket, 'TUNNEL_RATE_LIMITED', 'Encrypted relay traffic limit exceeded')
      return false
    }
    return true
  }

  const revokePeer = (socket: RelaySocket, peerId: string, message?: string) => {
    if (socket.data.role !== 'host' || !socket.data.sessionId) return
    const session = sessions.get(socket.data.sessionId)
    const guest = session?.guests.get(peerId)
    if (!session || !guest) return
    send(guest.socket, { type: 'peer_revoked', peerId, message })
    session.guests.delete(peerId)
  }

  const handleMessage = (socket: RelaySocket, message: P2PRelayClientMessage) => {
    if (!message || typeof message !== 'object' || !('type' in message)) return
    if (message.type === 'host_register') return registerHost(socket, message)
    if (message.type === 'host_rotate_code') return rotateHostCode(socket, message.code)
    if (message.type === 'guest_join') return joinGuest(socket, message)
    if (message.type === 'signal') return forwardPeerMessage(socket, message)
    if (message.type === 'tunnel_handshake') {
      if (socket.data.role !== 'host' || !normalizeTunnelPublicKey(message.tunnelPublicKey)) {
        return sendError(socket, 'INVALID_TUNNEL_HANDSHAKE', 'Invalid encrypted relay handshake')
      }
      return forwardPeerMessage(socket, message)
    }
    if (message.type === 'tunnel_activate') {
      if (socket.data.role !== 'host') return sendError(socket, 'INVALID_TUNNEL_ACTIVATION', 'Only the host can activate relay fallback')
      return forwardPeerMessage(socket, message)
    }
    if (message.type === 'tunnel_frame') {
      if (!allowTunnelFrame(socket, message)) return
      return forwardPeerMessage(socket, message)
    }
    if (message.type === 'peer_revoked') return revokePeer(socket, message.peerId, message.message)
    if (message.type === 'heartbeat') send(socket, { type: 'pong' })
  }

  const server = Bun.serve<RelaySocketData>({
    hostname: options.host ?? '0.0.0.0',
    port: options.port ?? Number(process.env.CYBERCODE_P2P_SIGNAL_PORT || process.env.CYBERCODE_P2P_RELAY_PORT || 8765),
    fetch(req, server) {
      const url = new URL(req.url)
      if (url.pathname === '/health') {
        removeExpiredPairingCodes()
        return Response.json({
          status: 'ok',
          hosts: sessions.size,
          activePairingCodes: sessionsByCode.size,
          transport: 'webrtc-signaling',
          dataTransport,
        })
      }
      if (url.pathname === '/p2p/ws') {
        const upgraded = server.upgrade(req, { data: { connectionId: randomUUID() } })
        return upgraded ? undefined : jsonError('WebSocket upgrade failed', 400)
      }
      return jsonError('Not Found', 404)
    },
    websocket: {
      maxPayloadLength: 256 * 1024,
      backpressureLimit: 4 * 1024 * 1024,
      closeOnBackpressureLimit: true,
      open() {},
      message(socket, raw) {
        try {
          handleMessage(socket, parseJson(raw))
        } catch {
          sendError(socket, 'INVALID_MESSAGE', 'Invalid signaling message')
        }
      },
      close(socket) {
        const sessionId = socket.data.sessionId
        if (!sessionId) return
        const session = sessions.get(sessionId)
        if (!session) return
        if (socket.data.role === 'host') {
          if (session.host !== socket) return
          session.host = undefined
          session.offlineTimer = setTimeout(() => {
            if (session.host) return
            sessions.delete(session.id)
            if (sessionsByCode.get(session.codeHash) === session) sessionsByCode.delete(session.codeHash)
            for (const guest of session.guests.values()) send(guest.socket, { type: 'host_offline' })
          }, HOST_RECONNECT_GRACE_MS)
          return
        }
        if (socket.data.peerId) session.guests.delete(socket.data.peerId)
      },
    },
  })

  return {
    server,
    stop() {
      for (const session of sessions.values()) {
        if (session.offlineTimer) clearTimeout(session.offlineTimer)
        for (const guest of session.guests.values()) send(guest.socket, { type: 'host_offline' })
        if (session.host?.readyState === 1) session.host.close(1000, 'Signaling server stopped')
      }
      sessions.clear()
      sessionsByCode.clear()
      server.stop(true)
    },
  }
}

export function generateP2PPairingCode(length = 8): string {
  const values = new Uint32Array(length)
  crypto.getRandomValues(values)
  return Array.from(values, (value) => PAIRING_CODE_ALPHABET[value % PAIRING_CODE_ALPHABET.length]).join('')
}
