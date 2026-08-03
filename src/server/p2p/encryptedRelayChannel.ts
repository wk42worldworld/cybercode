import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  type KeyObject,
} from 'node:crypto'
import WebSocket from 'ws'
import type { P2PRelayTunnelFrame } from './types.js'

type ChannelState = 'connecting' | 'open' | 'closing' | 'closed'
type Listener<T> = (value: T) => void

class ChannelEvent<T> {
  private listeners = new Set<Listener<T>>()

  subscribe(listener: Listener<T>): { unSubscribe: () => void } {
    this.listeners.add(listener)
    return { unSubscribe: () => this.listeners.delete(listener) }
  }

  emit(value: T): void {
    for (const listener of this.listeners) listener(value)
  }

  clear(): void {
    this.listeners.clear()
  }
}

export type P2PTunnelKeyPair = {
  privateKeyDerBase64: string
  publicKeyDerBase64: string
}

export type P2PDataChannel = {
  readyState: ChannelState
  bufferedAmount: number
  bufferedAmountLowThreshold: number
  stateChanged: { subscribe: (listener: Listener<ChannelState>) => { unSubscribe: () => void } }
  onMessage: { subscribe: (listener: Listener<string | Buffer>) => { unSubscribe: () => void } }
  bufferedAmountLow: { subscribe: (listener: (...values: unknown[]) => void) => { unSubscribe: () => void } }
  send: (raw: string | Buffer) => void
  close: () => void
}

type EncryptedRelayChannelOptions = {
  getSocket: () => WebSocket
  sessionId: string
  peerId: string
  role: 'host' | 'guest'
  localPrivateKeyDerBase64: string
  remotePublicKeyDerBase64: string
}

const PROTOCOL_LABEL = 'cybercode-p2p-wss-v1'
const AUTH_TAG_BYTES = 16
const MAX_PLAINTEXT_BYTES = 96 * 1024

function importPrivateKey(value: string): KeyObject {
  return createPrivateKey({
    key: Buffer.from(value, 'base64'),
    format: 'der',
    type: 'pkcs8',
  })
}

function importPublicKey(value: string): KeyObject {
  return createPublicKey({
    key: Buffer.from(value, 'base64'),
    format: 'der',
    type: 'spki',
  })
}

function frameNonce(seq: number): Buffer {
  const nonce = Buffer.alloc(12)
  nonce.writeBigUInt64BE(BigInt(seq), 4)
  return nonce
}

function frameAad(sessionId: string, peerId: string, direction: string, seq: number): Buffer {
  return Buffer.from(`${PROTOCOL_LABEL}|${sessionId}|${peerId}|${direction}|${seq}`)
}

export function createP2PTunnelKeyPair(): P2PTunnelKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('x25519')
  return {
    privateKeyDerBase64: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    publicKeyDerBase64: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  }
}

export function isP2PTunnelPublicKey(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 40 || value.length > 128 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return false
  }
  try {
    const key = importPublicKey(value)
    return key.asymmetricKeyType === 'x25519'
  } catch {
    return false
  }
}

export class EncryptedRelayDataChannel implements P2PDataChannel {
  readonly kind = 'encrypted-wss' as const
  readonly stateChanged = new ChannelEvent<ChannelState>()
  readonly onMessage = new ChannelEvent<string | Buffer>()
  readonly bufferedAmountLow = new ChannelEvent<void>()
  bufferedAmountLowThreshold = 0
  readyState: ChannelState = 'connecting'

  private readonly sendKey: Buffer
  private readonly receiveKey: Buffer
  private sendSeq = 0
  private receiveSeq = 0
  private bufferTimer?: ReturnType<typeof setInterval>

  constructor(private readonly options: EncryptedRelayChannelOptions) {
    const sharedSecret = diffieHellman({
      privateKey: importPrivateKey(options.localPrivateKeyDerBase64),
      publicKey: importPublicKey(options.remotePublicKeyDerBase64),
    })
    const salt = createHash('sha256')
      .update(`${PROTOCOL_LABEL}|${options.sessionId}|${options.peerId}`)
      .digest()
    const material = Buffer.from(hkdfSync('sha256', sharedSecret, salt, PROTOCOL_LABEL, 64))
    const hostToGuest = material.subarray(0, 32)
    const guestToHost = material.subarray(32, 64)
    this.sendKey = options.role === 'host' ? hostToGuest : guestToHost
    this.receiveKey = options.role === 'host' ? guestToHost : hostToGuest
  }

  get bufferedAmount(): number {
    return this.options.getSocket().bufferedAmount
  }

  open(): void {
    if (this.readyState !== 'connecting') return
    this.readyState = 'open'
    this.stateChanged.emit('open')
  }

  send(raw: string | Buffer): void {
    if (this.readyState !== 'open') throw new Error('P2P connection is not ready')
    const socket = this.options.getSocket()
    if (socket.readyState !== WebSocket.OPEN) throw new Error('P2P relay connection is offline')
    const plaintext = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
    if (plaintext.length > MAX_PLAINTEXT_BYTES) throw new Error('P2P relay frame is too large')
    const seq = this.sendSeq
    const direction = this.options.role === 'host' ? 'host-to-guest' : 'guest-to-host'
    const cipher = createCipheriv('aes-256-gcm', this.sendKey, frameNonce(seq))
    cipher.setAAD(frameAad(this.options.sessionId, this.options.peerId, direction, seq))
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])
    socket.send(JSON.stringify({
      type: 'tunnel_frame',
      peerId: this.options.peerId,
      seq,
      dataBase64: encrypted.toString('base64'),
    } satisfies P2PRelayTunnelFrame))
    this.sendSeq++
    this.watchBufferedAmount()
  }

  receive(frame: P2PRelayTunnelFrame): void {
    if (this.readyState !== 'open') return
    if (frame.seq !== this.receiveSeq) throw new Error('P2P relay frame sequence is invalid')
    const encrypted = Buffer.from(frame.dataBase64, 'base64')
    if (encrypted.length <= AUTH_TAG_BYTES || encrypted.length > MAX_PLAINTEXT_BYTES + AUTH_TAG_BYTES) {
      throw new Error('P2P relay frame is invalid')
    }
    const direction = this.options.role === 'host' ? 'guest-to-host' : 'host-to-guest'
    const decipher = createDecipheriv('aes-256-gcm', this.receiveKey, frameNonce(frame.seq))
    decipher.setAAD(frameAad(this.options.sessionId, this.options.peerId, direction, frame.seq))
    decipher.setAuthTag(encrypted.subarray(-AUTH_TAG_BYTES))
    const plaintext = Buffer.concat([
      decipher.update(encrypted.subarray(0, -AUTH_TAG_BYTES)),
      decipher.final(),
    ])
    this.receiveSeq++
    this.onMessage.emit(plaintext.toString('utf8'))
  }

  close(): void {
    if (this.readyState === 'closed') return
    this.readyState = 'closed'
    if (this.bufferTimer) clearInterval(this.bufferTimer)
    this.bufferTimer = undefined
    this.stateChanged.emit('closed')
    this.stateChanged.clear()
    this.onMessage.clear()
    this.bufferedAmountLow.clear()
  }

  private watchBufferedAmount(): void {
    if (this.bufferTimer || this.bufferedAmount <= this.bufferedAmountLowThreshold) return
    this.bufferTimer = setInterval(() => {
      if (this.bufferedAmount > this.bufferedAmountLowThreshold) return
      clearInterval(this.bufferTimer)
      this.bufferTimer = undefined
      this.bufferedAmountLow.emit(undefined)
    }, 20)
  }
}
