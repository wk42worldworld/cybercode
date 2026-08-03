import { describe, expect, it } from 'vitest'
import type WebSocket from 'ws'

import {
  createP2PTunnelKeyPair,
  EncryptedRelayDataChannel,
  isP2PTunnelPublicKey,
} from '../p2p/encryptedRelayChannel.js'
import type { P2PRelayTunnelFrame } from '../p2p/types.js'

function fakeSocket(send: (raw: string) => void): WebSocket {
  return {
    readyState: 1,
    bufferedAmount: 0,
    send,
  } as unknown as WebSocket
}

describe('encrypted WSS relay channel', () => {
  it('derives directional keys and carries ciphertext in both directions', () => {
    const hostKeys = createP2PTunnelKeyPair()
    const guestKeys = createP2PTunnelKeyPair()
    expect(isP2PTunnelPublicKey(hostKeys.publicKeyDerBase64)).toBe(true)
    expect(isP2PTunnelPublicKey(guestKeys.publicKeyDerBase64)).toBe(true)

    let host!: EncryptedRelayDataChannel
    let guest!: EncryptedRelayDataChannel
    const observedFrames: P2PRelayTunnelFrame[] = []
    const hostSocket = fakeSocket((raw) => {
      const frame = JSON.parse(raw) as P2PRelayTunnelFrame
      observedFrames.push(frame)
      guest.receive(frame)
    })
    const guestSocket = fakeSocket((raw) => {
      const frame = JSON.parse(raw) as P2PRelayTunnelFrame
      observedFrames.push(frame)
      host.receive(frame)
    })
    host = new EncryptedRelayDataChannel({
      getSocket: () => hostSocket,
      sessionId: 'session-1',
      peerId: 'peer-1',
      role: 'host',
      localPrivateKeyDerBase64: hostKeys.privateKeyDerBase64,
      remotePublicKeyDerBase64: guestKeys.publicKeyDerBase64,
    })
    guest = new EncryptedRelayDataChannel({
      getSocket: () => guestSocket,
      sessionId: 'session-1',
      peerId: 'peer-1',
      role: 'guest',
      localPrivateKeyDerBase64: guestKeys.privateKeyDerBase64,
      remotePublicKeyDerBase64: hostKeys.publicKeyDerBase64,
    })
    host.open()
    guest.open()

    const receivedByGuest: string[] = []
    const receivedByHost: string[] = []
    guest.onMessage.subscribe((raw) => receivedByGuest.push(String(raw)))
    host.onMessage.subscribe((raw) => receivedByHost.push(String(raw)))
    host.send(JSON.stringify({ type: 'ready', apiKey: 'secret-key' }))
    guest.send(JSON.stringify({ type: 'http_request_end', requestId: 'request-1' }))

    expect(receivedByGuest).toEqual([JSON.stringify({ type: 'ready', apiKey: 'secret-key' })])
    expect(receivedByHost).toEqual([JSON.stringify({ type: 'http_request_end', requestId: 'request-1' })])
    expect(JSON.stringify(observedFrames)).not.toContain('secret-key')
    expect(observedFrames.map((frame) => frame.seq)).toEqual([0, 0])
  })

  it('rejects tampered and replayed frames', () => {
    const hostKeys = createP2PTunnelKeyPair()
    const guestKeys = createP2PTunnelKeyPair()
    let captured!: P2PRelayTunnelFrame
    const hostSocket = fakeSocket((raw) => {
      captured = JSON.parse(raw) as P2PRelayTunnelFrame
    })
    const guestSocket = fakeSocket(() => {})
    const host = new EncryptedRelayDataChannel({
      getSocket: () => hostSocket,
      sessionId: 'session-2',
      peerId: 'peer-2',
      role: 'host',
      localPrivateKeyDerBase64: hostKeys.privateKeyDerBase64,
      remotePublicKeyDerBase64: guestKeys.publicKeyDerBase64,
    })
    const guest = new EncryptedRelayDataChannel({
      getSocket: () => guestSocket,
      sessionId: 'session-2',
      peerId: 'peer-2',
      role: 'guest',
      localPrivateKeyDerBase64: guestKeys.privateKeyDerBase64,
      remotePublicKeyDerBase64: hostKeys.publicKeyDerBase64,
    })
    host.open()
    guest.open()
    host.send('protected')

    const tamperedBytes = Buffer.from(captured.dataBase64, 'base64')
    tamperedBytes[0] = tamperedBytes[0]! ^ 1
    expect(() => guest.receive({ ...captured, dataBase64: tamperedBytes.toString('base64') })).toThrow()
    expect(() => guest.receive(captured)).not.toThrow()
    expect(() => guest.receive(captured)).toThrow('sequence')
  })
})
