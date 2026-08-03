import 'reflect-metadata'
import { timingSafeEqual } from 'node:crypto'
import WebSocket from 'ws'
import { RTCPeerConnection } from 'werift'
import { gatewayService } from '../gateway/gatewayService.js'
import { handleGatewayRequest } from '../gateway/handler.js'
import { ApiError } from '../middleware/errorHandler.js'
import {
  createP2PTunnelKeyPair,
  EncryptedRelayDataChannel,
  isP2PTunnelPublicKey,
  type P2PDataChannel,
  type P2PTunnelKeyPair,
} from './encryptedRelayChannel.js'
import { generateP2PPairingCode } from './relayServer.js'
import {
  P2P_PAIRING_CODE_PATTERN,
  type P2PDataTransportMode,
  type P2PDataMessage,
  type P2PIceServer,
  type P2PJoinResult,
  type P2PRelayServerMessage,
  type P2PRelaySignal,
  type P2PRelayStatus,
  type P2PRelayTunnelFrame,
  type P2PSessionDescription,
} from './types.js'

const MAX_BODY_BYTES = 12 * 1024 * 1024
const DATA_CHUNK_BYTES = 32 * 1024
const DATA_BUFFER_HIGH_WATER_BYTES = 512 * 1024
const DATA_BUFFER_LOW_WATER_BYTES = 128 * 1024
const SIGNAL_TIMEOUT_MS = 30_000
const MODEL_FIRST_BYTE_TIMEOUT_MS = 120_000
const HEARTBEAT_INTERVAL_MS = 20_000
const RECONNECT_DELAY_MS = 1_500
const PAIRING_CODE_ROTATE_EARLY_MS = 30_000
const ENCRYPTED_RELAY_FALLBACK_MS = 6_000
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

type P2PShareInput = {
  allowedTargets?: string[]
  nodeName?: string
  /** Internal deployment override; never exposed in the user interface. */
  signalUrl?: string
}

type P2PGatewayService = Pick<typeof gatewayService, 'getStatus' | 'createKey' | 'revokeKey'>

type P2PServiceOptions = {
  signalUrl?: string
  serverPort?: number
  relayFallbackMs?: number
  gateway?: P2PGatewayService
  gatewayRequestHandler?: typeof handleGatewayRequest
}

type InboundRequest = {
  method: string
  path: string
  headers: Record<string, string>
  chunks: Buffer[]
  size: number
  abortController: AbortController
}

type PendingResponse = {
  queued: Uint8Array[]
  ended: boolean
  controller?: ReadableStreamDefaultController<Uint8Array>
  resolveStart: (value: { status: number; headers: Record<string, string> }) => void
  rejectStart: (error: Error) => void
  startPromise: Promise<{ status: number; headers: Record<string, string> }>
  terminalError?: Error
}

type HostPeer = {
  id: string
  name: string
  keyId: string
  apiKey: string
  models: string[]
  connectedAt: string
  state: 'connecting' | 'connected'
  peerConnection?: RTCPeerConnection
  channel: P2PDataChannel
  relayChannel?: EncryptedRelayDataChannel
  tunnelPublicKey?: string
  selectedTransport?: 'webrtc' | 'wss'
  readySent: boolean
  inboundRequests: Map<string, InboundRequest>
  resolveRevokeAck?: () => void
  reconnectTimer?: ReturnType<typeof setTimeout>
  fallbackTimer?: ReturnType<typeof setTimeout>
}

type HostSession = {
  signalUrl: string
  code: string
  nodeName: string
  socket: WebSocket
  state: 'connecting' | 'connected'
  sessionId?: string
  dataTransport: P2PDataTransportMode
  pairingCodeExpiresAt?: string
  iceServers: P2PIceServer[]
  allowedTargets: string[]
  peers: Map<string, HostPeer>
  heartbeat?: ReturnType<typeof setInterval>
  pairingRotationTimer?: ReturnType<typeof setTimeout>
  reconnectTimer?: ReturnType<typeof setTimeout>
  stopped: boolean
}

type RemoteConnection = {
  sessionId: string
  peerId: string
  code: string
  nodeName: string
  signalUrl: string
  socket: WebSocket
  iceServers: P2PIceServer[]
  dataTransport: P2PDataTransportMode
  tunnelKeyPair: P2PTunnelKeyPair
  peerConnection?: RTCPeerConnection
  channel?: P2PDataChannel
  relayChannel?: EncryptedRelayDataChannel
  selectedTransport?: 'webrtc' | 'wss'
  relayActivationPending?: boolean
  apiKey?: string
  models: string[]
  state: 'connecting' | 'connected' | 'revoked' | 'offline'
  pendingResponses: Map<string, PendingResponse>
  resolveReady: (result: P2PJoinResult) => void
  rejectReady: (error: Error) => void
  readySettled: boolean
  heartbeat?: ReturnType<typeof setInterval>
}

function configuredSignalUrl(override?: string): string | null {
  const raw = override?.trim()
    || process.env.CYBERCODE_P2P_SIGNAL_URL?.trim()
    || process.env.CYBERCODE_P2P_BUILTIN_SIGNAL_URL?.trim()
    || process.env.CYBERCODE_P2P_RELAY_URL?.trim()
  if (!raw) return null
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw ApiError.internal('The built-in P2P signaling service URL is invalid')
  }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) {
    throw ApiError.internal('The built-in P2P signaling service must use HTTPS or WSS')
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '')
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString().replace(/\/$/, '')
}

function signalingWebSocketUrl(signalUrl: string): string {
  const parsed = new URL(signalUrl)
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : parsed.protocol === 'http:' ? 'ws:' : parsed.protocol
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/p2p/ws`
  return parsed.toString()
}

function parseSignalMessage(raw: WebSocket.RawData): P2PRelayServerMessage {
  const value = Array.isArray(raw) ? Buffer.concat(raw) : raw
  return JSON.parse(typeof value === 'string' ? value : value.toString('utf8')) as P2PRelayServerMessage
}

function parseDataMessage(raw: string | Buffer): P2PDataMessage {
  return JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8')) as P2PDataMessage
}

function sendSignal(socket: WebSocket, message: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
}

function sendData(channel: P2PDataChannel | undefined, message: P2PDataMessage): void {
  if (!channel || channel.readyState !== 'open') throw new Error('P2P connection is not ready')
  channel.send(JSON.stringify(message))
}

async function sendDataWithBackpressure(channel: P2PDataChannel, message: P2PDataMessage): Promise<void> {
  if (channel.readyState !== 'open') throw new Error('P2P connection is not ready')
  channel.bufferedAmountLowThreshold = DATA_BUFFER_LOW_WATER_BYTES
  if (channel.bufferedAmount > DATA_BUFFER_HIGH_WATER_BYTES) {
    await new Promise<void>((resolve, reject) => {
      let settled = false
      let lowUnsubscribe = () => {}
      let stateUnsubscribe = () => {}
      let timeout: ReturnType<typeof setTimeout> | undefined
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        if (timeout) clearTimeout(timeout)
        lowUnsubscribe()
        stateUnsubscribe()
        if (error) reject(error)
        else resolve()
      }
      timeout = setTimeout(() => finish(new Error('P2P connection is congested')), 15_000)
      lowUnsubscribe = channel.bufferedAmountLow.subscribe(() => finish()).unSubscribe
      stateUnsubscribe = channel.stateChanged.subscribe((state) => {
        if (state !== 'open') finish(new Error('P2P connection was interrupted'))
      }).unSubscribe
      if (channel.bufferedAmount <= DATA_BUFFER_LOW_WATER_BYTES) finish()
    })
  }
  sendData(channel, message)
}

function encodeBase64(value: Uint8Array): string {
  return Buffer.from(value).toString('base64')
}

function decodeBase64(value: string): Buffer {
  return Buffer.from(value, 'base64')
}

function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [name, value] of headers) {
    if (!HOP_BY_HOP_HEADERS.has(name)) result[name] = value
  }
  return result
}

function requestHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [name, value] of headers) {
    if (
      name === 'authorization'
      || name === 'content-type'
      || name === 'anthropic-version'
      || name === 'anthropic-beta'
      || name === 'x-api-key'
      || name.startsWith('x-session')
    ) result[name] = value
  }
  return result
}

function tokenFromRequest(req: Request): string | null {
  const bearer = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  return bearer ?? req.headers.get('x-api-key')
}

function secretsEqual(left: string, right: string): boolean {
  const leftValue = Buffer.from(left)
  const rightValue = Buffer.from(right)
  return leftValue.length === rightValue.length && timingSafeEqual(leftValue, rightValue)
}

function closePendingResponses(connection: RemoteConnection, error: Error): void {
  for (const pending of connection.pendingResponses.values()) {
    pending.terminalError = error
    pending.rejectStart(error)
    pending.controller?.error(error)
  }
  connection.pendingResponses.clear()
}

function rtcDescription(description: { type: 'offer' | 'answer'; sdp: string }): P2PSessionDescription {
  return { type: description.type, sdp: description.sdp }
}

export class P2PService {
  private serverPort = 3456
  private readonly signalUrlOverride?: string
  private readonly gateway: P2PGatewayService
  private readonly gatewayRequestHandler: typeof handleGatewayRequest
  private readonly relayFallbackMs: number
  private session: HostSession | null = null
  private remoteConnections = new Map<string, RemoteConnection>()
  private lastFailure: string | null = null

  constructor(options: P2PServiceOptions = {}) {
    this.signalUrlOverride = options.signalUrl
    this.gateway = options.gateway ?? gatewayService
    this.gatewayRequestHandler = options.gatewayRequestHandler ?? handleGatewayRequest
    this.relayFallbackMs = options.relayFallbackMs ?? ENCRYPTED_RELAY_FALLBACK_MS
    if (options.serverPort) this.serverPort = options.serverPort
  }

  setServerPort(port: number): void {
    this.serverPort = port
  }

  async status(): Promise<P2PRelayStatus> {
    if (!this.session) {
      return {
        state: configuredSignalUrl(this.signalUrlOverride) ? 'not-connected' : 'unavailable',
        ...(!configuredSignalUrl(this.signalUrlOverride) && { reason: 'signal-not-configured' as const }),
        ...(this.lastFailure && { reason: 'signal-connection-failed' as const }),
        peerCount: 0,
        peers: [],
      }
    }
    return {
      state: this.session.state,
      ...(this.lastFailure && this.session.state !== 'connected' && { reason: 'signal-connection-failed' as const }),
      pairingCode: this.session.code,
      pairingCodeExpiresAt: this.session.pairingCodeExpiresAt,
      peerCount: this.session.peers.size,
      peers: [...this.session.peers.values()].map((peer) => ({
        id: peer.id,
        name: peer.name,
        connectedAt: peer.connectedAt,
        state: peer.state,
      })),
    }
  }

  async startSharing(input: P2PShareInput = {}): Promise<P2PRelayStatus> {
    const signalUrl = configuredSignalUrl(input.signalUrl || this.signalUrlOverride)
    if (!signalUrl) throw ApiError.internal('P2P signaling service is not configured in this build')

    const gateway = await this.gateway.getStatus()
    const availableTargets = gateway.targets.filter((target) => target.available)
    const requested = input.allowedTargets?.length ? new Set(input.allowedTargets) : null
    const allowedTargets = availableTargets
      .filter((target) => !requested || requested.has(target.id))
      .map((target) => target.id)
    if (allowedTargets.length === 0) {
      throw ApiError.conflict('Configure at least one available model or route before enabling P2P sharing')
    }

    await this.stopSharing()
    const session: HostSession = {
      signalUrl,
      code: generateP2PPairingCode(),
      nodeName: input.nodeName?.trim().slice(0, 80) || 'CyberCode',
      socket: new WebSocket(signalingWebSocketUrl(signalUrl)),
      state: 'connecting',
      dataTransport: 'auto',
      iceServers: [],
      allowedTargets,
      peers: new Map(),
      stopped: false,
    }
    this.session = session
    this.lastFailure = null
    await this.connectHostSignal(session, true)
    return this.status()
  }

  async stopSharing(): Promise<void> {
    const session = this.session
    this.session = null
    if (!session) return
    session.stopped = true
    if (session.heartbeat) clearInterval(session.heartbeat)
    if (session.pairingRotationTimer) clearTimeout(session.pairingRotationTimer)
    if (session.reconnectTimer) clearTimeout(session.reconnectTimer)
    for (const peer of session.peers.values()) await this.closeHostPeer(peer, true)
    session.peers.clear()
    if (session.socket.readyState === WebSocket.OPEN || session.socket.readyState === WebSocket.CONNECTING) {
      session.socket.close(1000, 'Sharing stopped')
    }
  }

  async revokePeer(peerId: string): Promise<P2PRelayStatus> {
    const session = this.session
    if (!session) throw ApiError.notFound('P2P sharing is not enabled')
    const peer = session.peers.get(peerId)
    if (!peer) throw ApiError.notFound('P2P device not found')
    try {
      const acknowledged = new Promise<void>((resolve) => {
        peer.resolveRevokeAck = resolve
      })
      sendData(peer.channel, { type: 'revoked', message: 'Access was revoked by the sharing device' })
      await Promise.race([
        acknowledged,
        new Promise<void>((resolve) => setTimeout(resolve, 750)),
      ])
    } catch {}
    sendSignal(session.socket, { type: 'peer_revoked', peerId, message: 'Access was revoked by the sharing device' })
    session.peers.delete(peerId)
    await this.closeHostPeer(peer, true)
    return this.status()
  }

  async joinRemote(input: { code: string; deviceName?: string; signalUrl?: string }): Promise<P2PJoinResult> {
    const signalUrl = configuredSignalUrl(input.signalUrl || this.signalUrlOverride)
    if (!signalUrl) throw ApiError.internal('P2P signaling service is not configured in this build')
    const code = input.code.trim().toUpperCase()
    if (!P2P_PAIRING_CODE_PATTERN.test(code)) throw ApiError.badRequest('Invalid pairing code')

    const socket = new WebSocket(signalingWebSocketUrl(signalUrl))
    const tunnelKeyPair = createP2PTunnelKeyPair()
    let resolveReady!: (result: P2PJoinResult) => void
    let rejectReady!: (error: Error) => void
    const ready = new Promise<P2PJoinResult>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    let connection: RemoteConnection | null = null
    const fail = (error: Error) => {
      if (connection?.readySettled) return
      if (connection) connection.readySettled = true
      rejectReady(error)
    }

    socket.on('open', () => {
      sendSignal(socket, {
        type: 'guest_join',
        code,
        deviceName: input.deviceName?.trim().slice(0, 80) || 'CyberCode device',
        tunnelPublicKey: tunnelKeyPair.publicKeyDerBase64,
        protocol: 2,
      })
    })
    socket.on('message', (raw) => {
      void (async () => {
        const message = parseSignalMessage(raw)
        if (message.type === 'error') throw new Error(message.message)
        if (message.type === 'joining') {
          connection = {
            sessionId: message.sessionId,
            peerId: message.peerId,
            code,
            nodeName: message.nodeName,
            signalUrl,
            socket,
            iceServers: message.iceServers,
            dataTransport: message.dataTransport || 'webrtc',
            tunnelKeyPair,
            models: [],
            state: 'connecting',
            pendingResponses: new Map(),
            resolveReady,
            rejectReady,
            readySettled: false,
          }
          this.remoteConnections.set(connection.peerId, connection)
          connection.heartbeat = setInterval(() => sendSignal(connection!.socket, { type: 'heartbeat' }), HEARTBEAT_INTERVAL_MS)
          return
        }
        if (message.type === 'signal' && connection && message.peerId === connection.peerId) {
          await this.handleRemoteSignal(connection, message)
          return
        }
        if (message.type === 'tunnel_handshake' && connection && message.peerId === connection.peerId) {
          await this.prepareRemoteRelay(connection, message.tunnelPublicKey)
          return
        }
        if (message.type === 'tunnel_activate' && connection && message.peerId === connection.peerId) {
          if (connection.relayChannel) this.activateRemoteRelay(connection)
          else connection.relayActivationPending = true
          return
        }
        if (message.type === 'tunnel_frame' && connection && message.peerId === connection.peerId) {
          this.receiveRemoteRelayFrame(connection, message)
          return
        }
        if (message.type === 'peer_revoked' && connection) {
          this.markRemoteRevoked(connection, message.message || 'Access was revoked')
          fail(new Error(message.message || 'Access was revoked'))
          return
        }
        if (
          message.type === 'host_offline'
          && connection
          && connection.channel?.readyState !== 'open'
        ) connection.state = 'offline'
      })().catch((error) => fail(error instanceof Error ? error : new Error(String(error))))
    })
    socket.on('error', (error) => fail(error))
    socket.on('close', () => {
      if (!connection?.readySettled) fail(new Error('P2P signaling connection closed'))
      else if (connection.selectedTransport === 'wss' && connection.state !== 'revoked') {
        connection.state = 'offline'
        closePendingResponses(connection, new Error('Encrypted relay connection closed'))
      }
    })

    try {
      return await Promise.race([
        ready,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('P2P connection timed out')), SIGNAL_TIMEOUT_MS)),
      ])
    } catch (error) {
      if (connection) await this.closeRemoteConnection(connection, true)
      else socket.close()
      throw ApiError.internal(error instanceof Error ? error.message : String(error))
    }
  }

  async handlePeerHttpRequest(req: Request, url: URL): Promise<Response> {
    const match = url.pathname.match(/^\/p2p\/connections\/([^/]+)(\/v1\/(?:models|chat\/completions|messages))$/)
    if (!match) return Response.json({ error: 'Not Found' }, { status: 404 })
    const connection = this.remoteConnections.get(match[1]!)
    if (!connection || connection.state === 'offline') {
      return Response.json({ error: { message: 'P2P device is offline', type: 'connection_error' } }, { status: 503 })
    }
    if (connection.state === 'revoked') {
      return Response.json({ error: { message: 'P2P access was revoked', type: 'authentication_error' } }, { status: 401 })
    }
    if (!connection.apiKey || !connection.channel || connection.channel.readyState !== 'open') {
      return Response.json({ error: { message: 'P2P connection is not ready', type: 'connection_error' } }, { status: 503 })
    }
    const token = tokenFromRequest(req)
    if (!token || !secretsEqual(token, connection.apiKey)) {
      return Response.json({ error: { message: 'Invalid P2P access key', type: 'authentication_error' } }, { status: 401 })
    }
    if (req.method !== 'GET' && req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 })
    const body = req.method === 'GET' ? undefined : new Uint8Array(await req.arrayBuffer())
    if (body && body.byteLength > MAX_BODY_BYTES) return Response.json({ error: 'Request body is too large' }, { status: 413 })

    const requestId = crypto.randomUUID()
    let resolveStart!: PendingResponse['resolveStart']
    let rejectStart!: PendingResponse['rejectStart']
    const startPromise = new Promise<{ status: number; headers: Record<string, string> }>((resolve, reject) => {
      resolveStart = resolve
      rejectStart = reject
    })
    const pending: PendingResponse = { queued: [], ended: false, resolveStart, rejectStart, startPromise }
    connection.pendingResponses.set(requestId, pending)
    try {
      sendData(connection.channel, {
        type: 'http_request_start',
        requestId,
        method: req.method,
        path: match[2]!,
        headers: requestHeaders(req.headers),
      })
      if (body) {
        for (let offset = 0; offset < body.length; offset += DATA_CHUNK_BYTES) {
          await sendDataWithBackpressure(connection.channel, {
            type: 'http_request_chunk',
            requestId,
            dataBase64: encodeBase64(body.subarray(offset, offset + DATA_CHUNK_BYTES)),
          })
        }
      }
      sendData(connection.channel, { type: 'http_request_end', requestId })

      const start = await Promise.race([
        pending.startPromise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('P2P model request timed out')), MODEL_FIRST_BYTE_TIMEOUT_MS)),
      ])
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          pending.controller = controller
          if (pending.terminalError) {
            controller.error(pending.terminalError)
            return
          }
          for (const chunk of pending.queued.splice(0)) controller.enqueue(chunk)
          if (pending.ended) controller.close()
        },
        cancel: () => {
          connection.pendingResponses.delete(requestId)
          try {
            sendData(connection.channel, { type: 'http_cancel', requestId })
          } catch {}
        },
      })
      return new Response(stream, { status: start.status, headers: start.headers })
    } catch (error) {
      connection.pendingResponses.delete(requestId)
      return Response.json({
        error: { message: error instanceof Error ? error.message : String(error), type: 'connection_error' },
      }, { status: 502 })
    }
  }

  async shutdown(): Promise<void> {
    await this.stopSharing()
    const remotes = [...this.remoteConnections.values()]
    this.remoteConnections.clear()
    await Promise.all(remotes.map((connection) => this.closeRemoteConnection(connection, false)))
  }

  private async connectHostSignal(session: HostSession, initial: boolean): Promise<void> {
    const socket = session.socket
    const registered = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('P2P signaling connection timed out')), SIGNAL_TIMEOUT_MS)
      socket.once('open', () => {
        sendSignal(socket, {
          type: 'host_register',
          code: session.code,
          nodeName: session.nodeName,
          protocol: 2,
        })
      })
      socket.on('message', (raw) => {
        void (async () => {
          const message = parseSignalMessage(raw)
          if (message.type === 'error') {
            if (message.code === 'CODE_IN_USE') {
              session.code = generateP2PPairingCode()
              sendSignal(socket, session.state === 'connected'
                ? { type: 'host_rotate_code', code: session.code }
                : {
                    type: 'host_register',
                    code: session.code,
                    nodeName: session.nodeName,
                    protocol: 2,
                  })
              return
            }
            throw new Error(message.message)
          }
          if (message.type === 'registered') {
            clearTimeout(timeout)
            session.state = 'connected'
            session.sessionId = message.sessionId
            session.dataTransport = message.dataTransport || 'webrtc'
            session.pairingCodeExpiresAt = message.pairingCodeExpiresAt
            session.iceServers = message.iceServers
            this.lastFailure = null
            this.schedulePairingCodeRotation(session)
            if (session.heartbeat) clearInterval(session.heartbeat)
            session.heartbeat = setInterval(() => sendSignal(session.socket, { type: 'heartbeat' }), HEARTBEAT_INTERVAL_MS)
            for (const peer of session.peers.values()) {
              if (peer.selectedTransport === 'wss' && peer.channel.readyState === 'open') peer.state = 'connected'
            }
            resolve()
            return
          }
          await this.handleHostSignalMessage(session, message)
        })().catch((error) => {
          this.lastFailure = error instanceof Error ? error.message : String(error)
          if (initial) reject(error)
        })
      })
      socket.once('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
    })

    socket.on('close', () => {
      if (session.stopped || this.session !== session) return
      session.state = 'connecting'
      this.lastFailure = 'P2P signaling connection closed'
      for (const peer of session.peers.values()) {
        if (peer.selectedTransport === 'wss') peer.state = 'connecting'
      }
      if (session.heartbeat) clearInterval(session.heartbeat)
      session.reconnectTimer = setTimeout(() => {
        if (session.stopped || this.session !== session) return
        session.socket = new WebSocket(signalingWebSocketUrl(session.signalUrl))
        void this.connectHostSignal(session, false).catch(() => {})
      }, RECONNECT_DELAY_MS)
    })

    try {
      await registered
    } catch (error) {
      if (initial) {
        this.lastFailure = error instanceof Error ? error.message : String(error)
        await this.stopSharing()
        throw ApiError.internal(`Unable to connect to the built-in P2P service: ${this.lastFailure}`)
      }
      throw error
    }
  }

  private schedulePairingCodeRotation(session: HostSession): void {
    if (session.pairingRotationTimer) clearTimeout(session.pairingRotationTimer)
    const expiresAt = session.pairingCodeExpiresAt
      ? new Date(session.pairingCodeExpiresAt).getTime()
      : Date.now() + 10 * 60_000
    const delay = Math.max(1_000, expiresAt - Date.now() - PAIRING_CODE_ROTATE_EARLY_MS)
    session.pairingRotationTimer = setTimeout(() => {
      if (session.stopped || this.session !== session || session.socket.readyState !== WebSocket.OPEN) return
      session.code = generateP2PPairingCode()
      sendSignal(session.socket, { type: 'host_rotate_code', code: session.code })
    }, delay)
  }

  private async handleHostSignalMessage(session: HostSession, message: P2PRelayServerMessage): Promise<void> {
    if (message.type === 'join_request') {
      await this.createHostPeer(session, message.peerId, message.deviceName, message.tunnelPublicKey)
      return
    }
    if (message.type === 'signal' && message.signal.kind === 'description' && message.signal.description.type === 'answer') {
      const peer = session.peers.get(message.peerId)
      if (peer?.peerConnection && peer.selectedTransport !== 'wss') {
        await peer.peerConnection.setRemoteDescription(message.signal.description)
      }
      return
    }
    if (message.type === 'tunnel_frame') {
      const peer = session.peers.get(message.peerId)
      if (peer?.relayChannel) this.receiveHostRelayFrame(peer, message)
    }
  }

  private async createHostPeer(
    session: HostSession,
    peerId: string,
    deviceName: string,
    tunnelPublicKey?: string,
  ): Promise<void> {
    const existing = session.peers.get(peerId)
    const remoteTunnelPublicKey = isP2PTunnelPublicKey(tunnelPublicKey)
      ? tunnelPublicKey
      : existing?.tunnelPublicKey
    if (existing) await this.closeHostPeer(existing, false)

    let keyId = existing?.keyId
    let apiKey = existing?.apiKey
    let models = existing?.models
    if (!keyId || !apiKey || !models) {
      const created = await this.gateway.createKey({
        name: `P2P · ${deviceName.slice(0, 48)} · ${peerId.slice(0, 6)}`,
        allowedTargets: session.allowedTargets,
      })
      const createdKey = created.status.keys.find((key) => key.id === created.keyId)
      models = createdKey
        ? created.status.targets
          .filter((target) => target.available && createdKey.allowedTargets.includes(target.id))
          .map((target) => target.publicId)
        : []
      if (models.length === 0) {
        await this.gateway.revokeKey(created.keyId).catch(() => {})
        throw new Error('No shared model is currently available')
      }
      keyId = created.keyId
      apiKey = created.apiKey
    }

    let relayChannel: EncryptedRelayDataChannel | undefined
    let hostTunnelKeyPair: P2PTunnelKeyPair | undefined
    if (remoteTunnelPublicKey && session.sessionId) {
      hostTunnelKeyPair = createP2PTunnelKeyPair()
      relayChannel = new EncryptedRelayDataChannel({
        getSocket: () => session.socket,
        sessionId: session.sessionId,
        peerId,
        role: 'host',
        localPrivateKeyDerBase64: hostTunnelKeyPair.privateKeyDerBase64,
        remotePublicKeyDerBase64: remoteTunnelPublicKey,
      })
    }
    if (session.dataTransport === 'wss' && !relayChannel) {
      throw new Error('Joining device does not support encrypted relay fallback')
    }

    const peerConnection = session.dataTransport === 'wss'
      ? undefined
      : new RTCPeerConnection({ iceServers: session.iceServers })
    const rtcChannel = peerConnection?.createDataChannel('cybercode-model-tunnel', { ordered: true })
    const channel = rtcChannel || relayChannel
    if (!channel) throw new Error('No P2P transport is available')
    const peer: HostPeer = {
      id: peerId,
      name: deviceName,
      keyId,
      apiKey,
      models,
      connectedAt: existing?.connectedAt || new Date().toISOString(),
      state: 'connecting',
      peerConnection,
      channel,
      relayChannel,
      tunnelPublicKey: remoteTunnelPublicKey,
      readySent: false,
      inboundRequests: new Map(),
    }
    session.peers.set(peerId, peer)
    if (relayChannel && hostTunnelKeyPair) {
      this.attachHostDataChannel(session, peer, relayChannel, 'wss')
      sendSignal(session.socket, {
        type: 'tunnel_handshake',
        peerId,
        tunnelPublicKey: hostTunnelKeyPair.publicKeyDerBase64,
      })
    }
    if (session.dataTransport === 'wss') {
      this.activateHostRelay(session, peer)
      return
    }
    if (!peerConnection || !rtcChannel) throw new Error('WebRTC transport is unavailable')
    this.attachHostDataChannel(session, peer, rtcChannel, 'webrtc')
    peerConnection.connectionStateChange.subscribe((state) => {
      if ((state === 'failed' || state === 'disconnected') && !session.stopped && session.peers.get(peerId) === peer) {
        if (session.dataTransport === 'auto' && peer.relayChannel) {
          this.activateHostRelay(session, peer)
          return
        }
        if (peer.reconnectTimer) clearTimeout(peer.reconnectTimer)
        peer.reconnectTimer = setTimeout(() => {
          if (!session.stopped && session.peers.get(peerId) === peer && session.socket.readyState === WebSocket.OPEN) {
            void this.createHostPeer(session, peerId, deviceName, peer.tunnelPublicKey).catch((error) => {
              this.lastFailure = error instanceof Error ? error.message : String(error)
            })
          }
        }, RECONNECT_DELAY_MS)
      }
    })
    if (session.dataTransport === 'auto' && relayChannel) {
      peer.fallbackTimer = setTimeout(() => this.activateHostRelay(session, peer), this.relayFallbackMs)
    }

    const offer = await peerConnection.createOffer()
    await peerConnection.setLocalDescription(offer)
    if (peer.selectedTransport === 'wss') {
      await peerConnection.close().catch(() => {})
      return
    }
    sendSignal(session.socket, {
      type: 'signal',
      peerId,
      signal: { kind: 'description', description: rtcDescription(peerConnection.localDescription!) },
    })
  }

  private activateHostRelay(session: HostSession, peer: HostPeer): void {
    if (!peer.relayChannel || peer.selectedTransport) return
    peer.selectedTransport = 'wss'
    peer.channel = peer.relayChannel
    if (peer.fallbackTimer) clearTimeout(peer.fallbackTimer)
    peer.fallbackTimer = undefined
    sendSignal(session.socket, { type: 'tunnel_activate', peerId: peer.id })
    peer.relayChannel.open()
  }

  private attachHostDataChannel(
    session: HostSession,
    peer: HostPeer,
    channel: P2PDataChannel,
    transport: 'webrtc' | 'wss',
  ): void {
    channel.stateChanged.subscribe((state) => {
      if (state !== 'open') return
      if (peer.selectedTransport && peer.selectedTransport !== transport) {
        channel.close()
        return
      }
      peer.selectedTransport = transport
      peer.channel = channel
      if (peer.fallbackTimer) clearTimeout(peer.fallbackTimer)
      peer.fallbackTimer = undefined
      peer.state = 'connected'
      if (peer.readySent) return
      peer.readySent = true
      sendData(channel, {
        type: 'ready',
        peerId: peer.id,
        nodeName: session.nodeName,
        apiKey: peer.apiKey,
        models: peer.models,
      })
    })
    channel.onMessage.subscribe((raw) => {
      if (peer.channel !== channel) return
      void this.handleHostDataMessage(peer, parseDataMessage(raw)).catch((error) => {
        this.lastFailure = error instanceof Error ? error.message : String(error)
      })
    })
  }

  private receiveHostRelayFrame(peer: HostPeer, frame: P2PRelayTunnelFrame): void {
    try {
      peer.relayChannel?.receive(frame)
    } catch (error) {
      this.lastFailure = error instanceof Error ? error.message : String(error)
      peer.relayChannel?.close()
    }
  }

  private async handleHostDataMessage(peer: HostPeer, message: P2PDataMessage): Promise<void> {
    if (message.type === 'revoke_ack') {
      peer.resolveRevokeAck?.()
      peer.resolveRevokeAck = undefined
      return
    }
    if (message.type === 'http_request_start') {
      if (!/^\/v1\/(?:models|chat\/completions|messages)$/.test(message.path)) {
        sendData(peer.channel, { type: 'http_response_error', requestId: message.requestId, message: 'Unsupported P2P path' })
        return
      }
      peer.inboundRequests.set(message.requestId, {
        method: message.method,
        path: message.path,
        headers: message.headers,
        chunks: [],
        size: 0,
        abortController: new AbortController(),
      })
      return
    }
    if (message.type === 'http_request_chunk') {
      const request = peer.inboundRequests.get(message.requestId)
      if (!request) return
      const chunk = decodeBase64(message.dataBase64)
      request.size += chunk.length
      if (request.size > MAX_BODY_BYTES) {
        peer.inboundRequests.delete(message.requestId)
        request.abortController.abort()
        sendData(peer.channel, { type: 'http_response_error', requestId: message.requestId, message: 'Request body is too large' })
        return
      }
      request.chunks.push(chunk)
      return
    }
    if (message.type === 'http_cancel') {
      const request = peer.inboundRequests.get(message.requestId)
      request?.abortController.abort()
      peer.inboundRequests.delete(message.requestId)
      return
    }
    if (message.type === 'http_request_end') {
      const request = peer.inboundRequests.get(message.requestId)
      if (!request) return
      peer.inboundRequests.delete(message.requestId)
      await this.forwardHostRequest(peer, message.requestId, request)
    }
  }

  private async forwardHostRequest(peer: HostPeer, requestId: string, input: InboundRequest): Promise<void> {
    try {
      const body = input.chunks.length ? Buffer.concat(input.chunks) : undefined
      const request = new Request(`http://127.0.0.1:${this.serverPort}${input.path}`, {
        method: input.method,
        headers: input.headers,
        ...(body && { body }),
        signal: input.abortController.signal,
      })
      const response = await this.gatewayRequestHandler(request, new URL(request.url))
      sendData(peer.channel, {
        type: 'http_response_start',
        requestId,
        status: response.status,
        headers: headersToRecord(response.headers),
      })
      if (response.body) {
        const reader = response.body.getReader()
        try {
          while (true) {
            const next = await reader.read()
            if (next.done) break
            for (let offset = 0; offset < next.value.length; offset += DATA_CHUNK_BYTES) {
              await sendDataWithBackpressure(peer.channel, {
                type: 'http_response_chunk',
                requestId,
                dataBase64: encodeBase64(next.value.subarray(offset, offset + DATA_CHUNK_BYTES)),
              })
            }
          }
        } finally {
          reader.releaseLock()
        }
      }
      sendData(peer.channel, { type: 'http_response_end', requestId })
    } catch (error) {
      try {
        sendData(peer.channel, {
          type: 'http_response_error',
          requestId,
          message: error instanceof Error ? error.message : 'P2P host request failed',
        })
      } catch {}
    }
  }

  private prepareRemoteRelay(connection: RemoteConnection, tunnelPublicKey: string): void {
    if (!isP2PTunnelPublicKey(tunnelPublicKey)) throw new Error('Encrypted relay handshake is invalid')
    connection.relayChannel?.close()
    const relayChannel = new EncryptedRelayDataChannel({
      getSocket: () => connection.socket,
      sessionId: connection.sessionId,
      peerId: connection.peerId,
      role: 'guest',
      localPrivateKeyDerBase64: connection.tunnelKeyPair.privateKeyDerBase64,
      remotePublicKeyDerBase64: tunnelPublicKey,
    })
    connection.relayChannel = relayChannel
    this.attachRemoteDataChannel(connection, relayChannel, 'wss')
    if (connection.relayActivationPending) this.activateRemoteRelay(connection)
  }

  private activateRemoteRelay(connection: RemoteConnection): void {
    const relayChannel = connection.relayChannel
    if (!relayChannel || connection.selectedTransport) return
    connection.relayActivationPending = false
    connection.selectedTransport = 'wss'
    connection.channel = relayChannel
    relayChannel.open()
    if (connection.peerConnection) void connection.peerConnection.close().catch(() => {})
  }

  private receiveRemoteRelayFrame(connection: RemoteConnection, frame: P2PRelayTunnelFrame): void {
    try {
      connection.relayChannel?.receive(frame)
    } catch (error) {
      connection.relayChannel?.close()
      connection.state = 'offline'
      closePendingResponses(connection, error instanceof Error ? error : new Error(String(error)))
    }
  }

  private async handleRemoteSignal(connection: RemoteConnection, message: P2PRelaySignal): Promise<void> {
    if (message.signal.kind !== 'description' || message.signal.description.type !== 'offer') return
    if (connection.selectedTransport === 'wss') return
    if (connection.peerConnection) await connection.peerConnection.close().catch(() => {})
    const peerConnection = new RTCPeerConnection({ iceServers: connection.iceServers })
    connection.peerConnection = peerConnection
    if (!connection.channel || connection.channel.readyState !== 'open') connection.state = 'connecting'
    peerConnection.onDataChannel.subscribe((channel) => this.attachRemoteDataChannel(connection, channel, 'webrtc'))
    peerConnection.connectionStateChange.subscribe((state) => {
      if (state === 'connected' && connection.channel?.readyState === 'open') connection.state = 'connected'
      if (
        (state === 'failed' || state === 'closed')
        && connection.state !== 'revoked'
        && (connection.selectedTransport === 'webrtc' || connection.dataTransport === 'webrtc')
      ) {
        connection.state = 'offline'
        closePendingResponses(connection, new Error('P2P connection was interrupted'))
      }
    })
    await peerConnection.setRemoteDescription(message.signal.description)
    const answer = await peerConnection.createAnswer()
    await peerConnection.setLocalDescription(answer)
    sendSignal(connection.socket, {
      type: 'signal',
      peerId: connection.peerId,
      signal: { kind: 'description', description: rtcDescription(peerConnection.localDescription!) },
    })
  }

  private attachRemoteDataChannel(
    connection: RemoteConnection,
    channel: P2PDataChannel,
    transport: 'webrtc' | 'wss',
  ): void {
    channel.stateChanged.subscribe((state) => {
      if (state === 'open') {
        if (connection.selectedTransport && connection.selectedTransport !== transport) {
          channel.close()
          return
        }
        connection.selectedTransport = transport
        connection.channel = channel
      }
      if (state === 'open' && connection.apiKey) connection.state = 'connected'
      if (state === 'closed' && connection.state !== 'revoked' && connection.channel === channel) {
        connection.state = 'offline'
        closePendingResponses(connection, new Error('P2P connection was interrupted'))
      }
    })
    channel.onMessage.subscribe((raw) => {
      if (connection.channel !== channel) return
      let message: P2PDataMessage
      try {
        message = parseDataMessage(raw)
      } catch {
        return
      }
      if (message.type === 'ready') {
        connection.apiKey = message.apiKey
        connection.models = message.models
        connection.nodeName = message.nodeName
        connection.state = 'connected'
        if (!connection.readySettled) {
          connection.readySettled = true
          connection.resolveReady({
            sessionId: connection.sessionId,
            peerId: connection.peerId,
            nodeName: connection.nodeName,
            baseUrl: `http://127.0.0.1:${this.serverPort}/p2p/connections/${connection.peerId}`,
            apiKey: message.apiKey,
            models: message.models,
          })
        }
        return
      }
      if (message.type === 'revoked') {
        connection.state = 'revoked'
        try {
          sendData(channel, { type: 'revoke_ack' })
        } catch {}
        this.markRemoteRevoked(connection, message.message)
        return
      }
      const pending = 'requestId' in message ? connection.pendingResponses.get(message.requestId) : undefined
      if (!pending) return
      if (message.type === 'http_response_start') {
        pending.resolveStart({ status: message.status, headers: message.headers })
      } else if (message.type === 'http_response_chunk') {
        const chunk = decodeBase64(message.dataBase64)
        if (pending.controller) pending.controller.enqueue(chunk)
        else pending.queued.push(chunk)
      } else if (message.type === 'http_response_error') {
        const error = new Error(message.message)
        pending.terminalError = error
        pending.rejectStart(error)
        pending.controller?.error(error)
        connection.pendingResponses.delete(message.requestId)
      } else if (message.type === 'http_response_end') {
        pending.ended = true
        pending.controller?.close()
        connection.pendingResponses.delete(message.requestId)
      }
    })
  }

  private markRemoteRevoked(connection: RemoteConnection, message: string): void {
    connection.state = 'revoked'
    if (connection.heartbeat) clearInterval(connection.heartbeat)
    closePendingResponses(connection, new Error(message))
    try {
      connection.channel?.close()
    } catch {}
    if (connection.peerConnection) void connection.peerConnection.close().catch(() => {})
    if (connection.socket.readyState === WebSocket.OPEN) connection.socket.close(1000, 'Access revoked')
  }

  private async closeHostPeer(peer: HostPeer, revokeKey: boolean): Promise<void> {
    if (peer.reconnectTimer) clearTimeout(peer.reconnectTimer)
    if (peer.fallbackTimer) clearTimeout(peer.fallbackTimer)
    for (const request of peer.inboundRequests.values()) request.abortController.abort()
    peer.inboundRequests.clear()
    try {
      peer.channel.close()
    } catch {}
    if (peer.relayChannel && peer.relayChannel !== peer.channel) peer.relayChannel.close()
    if (peer.peerConnection) await peer.peerConnection.close().catch(() => {})
    if (revokeKey) await this.gateway.revokeKey(peer.keyId).catch(() => {})
  }

  private async closeRemoteConnection(connection: RemoteConnection, remove: boolean): Promise<void> {
    if (connection.heartbeat) clearInterval(connection.heartbeat)
    closePendingResponses(connection, new Error('P2P connection closed'))
    try {
      connection.channel?.close()
    } catch {}
    if (connection.relayChannel && connection.relayChannel !== connection.channel) connection.relayChannel.close()
    if (connection.peerConnection) await connection.peerConnection.close().catch(() => {})
    if (connection.socket.readyState === WebSocket.OPEN || connection.socket.readyState === WebSocket.CONNECTING) {
      connection.socket.close(1000, 'P2P connection closed')
    }
    if (remove) this.remoteConnections.delete(connection.peerId)
  }
}

export const p2pService = new P2PService()
