import { afterEach, describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import { RTCPeerConnection } from 'werift'
import { resolveP2PIceServers, startP2PRelayServer } from '../p2p/relayServer.js'

type SignalMessage = { type: string; [key: string]: unknown }

function waitForMessage(socket: WebSocket, predicate: (message: SignalMessage) => boolean): Promise<SignalMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.removeEventListener('message', onMessage)
      reject(new Error('Timed out waiting for signaling message'))
    }, 4_000)
    const onMessage = (event: MessageEvent) => {
      const message = JSON.parse(String(event.data)) as SignalMessage
      if (!predicate(message)) return
      clearTimeout(timeout)
      socket.removeEventListener('message', onMessage)
      resolve(message)
    }
    socket.addEventListener('message', onMessage)
  })
}

async function openWebSocket(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url)
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true })
    socket.addEventListener('error', () => reject(new Error('WebSocket failed')), { once: true })
  })
  return socket
}

describe('P2P signaling', () => {
  let signalServer: ReturnType<typeof startP2PRelayServer> | undefined
  const sockets: WebSocket[] = []
  const peerConnections: RTCPeerConnection[] = []

  afterEach(async () => {
    for (const socket of sockets) socket.close()
    sockets.length = 0
    await Promise.all(peerConnections.splice(0).map((peer) => peer.close().catch(() => {})))
    signalServer?.stop()
    signalServer = undefined
  })

  async function connectSocket(): Promise<WebSocket> {
    const origin = `ws://127.0.0.1:${signalServer!.server.port}`
    const socket = await openWebSocket(`${origin}/p2p/ws`)
    sockets.push(socket)
    return socket
  }

  it('issues short-lived TURN credentials without exposing the shared secret', () => {
    const now = Date.UTC(2026, 7, 3, 0, 0, 0)
    const servers = resolveP2PIceServers({
      CYBERCODE_P2P_STUN_URLS: 'stun:one.example:3478, stun:two.example:3478',
      CYBERCODE_P2P_TURN_URLS: 'turn:turn.example:3478?transport=udp,turn:turn.example:3478?transport=tcp',
      CYBERCODE_P2P_TURN_SECRET: 'server-only-secret',
      CYBERCODE_P2P_TURN_CREDENTIAL_TTL_SECONDS: '1800',
    }, now)

    const username = `${Math.floor(now / 1_000) + 1800}:cybercode`
    const credential = createHmac('sha1', 'server-only-secret').update(username).digest('base64')
    expect(servers).toEqual([
      { urls: 'stun:one.example:3478' },
      { urls: 'stun:two.example:3478' },
      { urls: 'turn:turn.example:3478?transport=udp', username, credential },
      { urls: 'turn:turn.example:3478?transport=tcp', username, credential },
    ])
    expect(JSON.stringify(servers)).not.toContain('server-only-secret')
  })

  it('uses only the pairing code to negotiate a direct WebRTC data channel', async () => {
    signalServer = startP2PRelayServer({ host: '127.0.0.1', port: 0, iceServers: [] })
    const host = await connectSocket()
    const registeredPromise = waitForMessage(host, (message) => message.type === 'registered')
    host.send(JSON.stringify({
      type: 'host_register',
      code: 'ABCD27KM',
      nodeName: 'Shared Mac',
      protocol: 2,
    }))
    const registered = await registeredPromise
    expect(registered.sessionId).toEqual(expect.any(String))

    const guest = await connectSocket()
    const joinRequestPromise = waitForMessage(host, (message) => message.type === 'join_request')
    const joiningPromise = waitForMessage(guest, (message) => message.type === 'joining')
    guest.send(JSON.stringify({
      type: 'guest_join',
      code: 'ABCD27KM',
      deviceName: 'Joining Linux',
      protocol: 2,
    }))
    const [joinRequest, joining] = await Promise.all([joinRequestPromise, joiningPromise])
    expect(joining.nodeName).toBe('Shared Mac')
    expect(joinRequest.peerId).toBe(joining.peerId)

    const hostPeer = new RTCPeerConnection({ iceServers: [] })
    const guestPeer = new RTCPeerConnection({ iceServers: [] })
    peerConnections.push(hostPeer, guestPeer)
    const hostChannel = hostPeer.createDataChannel('cybercode-model-tunnel')
    const received = new Promise<string>((resolve) => {
      guestPeer.onDataChannel.subscribe((channel) => {
        channel.onMessage.subscribe((message) => resolve(String(message)))
      })
    })

    const offerForGuest = waitForMessage(guest, (message) => message.type === 'signal')
    const offer = await hostPeer.createOffer()
    await hostPeer.setLocalDescription(offer)
    host.send(JSON.stringify({
      type: 'signal',
      peerId: joining.peerId,
      signal: { kind: 'description', description: hostPeer.localDescription },
    }))
    const forwardedOffer = await offerForGuest
    const offerSignal = forwardedOffer.signal as { description: { type: 'offer'; sdp: string } }
    await guestPeer.setRemoteDescription(offerSignal.description)

    const answerForHost = waitForMessage(host, (message) => message.type === 'signal')
    const answer = await guestPeer.createAnswer()
    await guestPeer.setLocalDescription(answer)
    guest.send(JSON.stringify({
      type: 'signal',
      peerId: joining.peerId,
      signal: { kind: 'description', description: guestPeer.localDescription },
    }))
    const forwardedAnswer = await answerForHost
    const answerSignal = forwardedAnswer.signal as { description: { type: 'answer'; sdp: string } }
    await hostPeer.setRemoteDescription(answerSignal.description)

    await new Promise<void>((resolve, reject) => {
      if (hostChannel.readyState === 'open') return resolve()
      const timeout = setTimeout(() => reject(new Error('Data channel did not open')), 4_000)
      hostChannel.stateChanged.subscribe((state) => {
        if (state !== 'open') return
        clearTimeout(timeout)
        resolve()
      })
    })
    hostChannel.send('direct-p2p-ok')
    await expect(received).resolves.toBe('direct-p2p-ok')
  }, 10_000)

  it('rotates pairing codes without replacing the host session and accepts multiple peers', async () => {
    signalServer = startP2PRelayServer({ host: '127.0.0.1', port: 0, iceServers: [] })
    const host = await connectSocket()
    const firstRegistration = waitForMessage(host, (message) => message.type === 'registered')
    host.send(JSON.stringify({ type: 'host_register', code: 'ABCD27KM', protocol: 2 }))
    const initial = await firstRegistration

    const firstGuest = await connectSocket()
    const firstJoin = waitForMessage(firstGuest, (message) => message.type === 'joining')
    firstGuest.send(JSON.stringify({ type: 'guest_join', code: 'ABCD27KM', deviceName: 'One', protocol: 2 }))
    await firstJoin

    const rotatedRegistration = waitForMessage(host, (message) => message.type === 'registered')
    host.send(JSON.stringify({ type: 'host_rotate_code', code: 'WXYZ38NP' }))
    const rotated = await rotatedRegistration
    expect(rotated.sessionId).toBe(initial.sessionId)

    const staleGuest = await connectSocket()
    const staleError = waitForMessage(staleGuest, (message) => message.type === 'error')
    staleGuest.send(JSON.stringify({ type: 'guest_join', code: 'ABCD27KM', deviceName: 'Stale', protocol: 2 }))
    await expect(staleError).resolves.toMatchObject({ code: 'PAIRING_UNAVAILABLE' })

    const secondGuest = await connectSocket()
    const secondJoin = waitForMessage(secondGuest, (message) => message.type === 'joining')
    secondGuest.send(JSON.stringify({ type: 'guest_join', code: 'WXYZ38NP', deviceName: 'Two', protocol: 2 }))
    await expect(secondJoin).resolves.toMatchObject({ sessionId: initial.sessionId })
  })
})
