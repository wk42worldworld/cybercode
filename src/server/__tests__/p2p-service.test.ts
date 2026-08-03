import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { startP2PRelayServer } from '../p2p/relayServer.js'
import { P2PService } from '../p2p/p2pService.js'

const gatewayMocks = {
  createKey: vi.fn(),
  getStatus: vi.fn(),
  revokeKey: vi.fn(),
  handleRequest: vi.fn(),
}

describe('P2P service', () => {
  let signalServer: ReturnType<typeof startP2PRelayServer> | undefined
  const services: P2PService[] = []
  let keySequence = 0

  beforeEach(() => {
    keySequence = 0
    gatewayMocks.getStatus.mockReset()
    gatewayMocks.getStatus.mockResolvedValue({
      targets: [{ id: 'model/provider-1/test-model', publicId: 'test/model', available: true }],
    })
    gatewayMocks.createKey.mockReset()
    gatewayMocks.createKey.mockImplementation(async (input: { name: string }) => {
      keySequence += 1
      const keyId = `key-${keySequence}`
      return {
        keyId,
        apiKey: `cc_p2p_${keySequence}`,
        status: {
          targets: [{ id: 'model/provider-1/test-model', publicId: 'test/model', available: true }],
          keys: [{ id: keyId, name: input.name, allowedTargets: ['model/provider-1/test-model'] }],
        },
      }
    })
    gatewayMocks.revokeKey.mockReset()
    gatewayMocks.revokeKey.mockResolvedValue(undefined)
    gatewayMocks.handleRequest.mockReset()
    gatewayMocks.handleRequest.mockImplementation(async (_req: Request, url: URL) => {
      if (url.pathname === '/v1/models') {
        return Response.json({ object: 'list', data: [{ id: 'test/model' }] })
      }
      return new Response('data: first\n\ndata: second\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      })
    })
  })

  afterEach(async () => {
    await Promise.all(services.splice(0).map((service) => service.shutdown()))
    signalServer?.stop()
    signalServer = undefined
  })

  function makeService(signalUrl: string, serverPort: number, relayFallbackMs?: number): P2PService {
    const service = new P2PService({
      signalUrl,
      serverPort,
      relayFallbackMs,
      gateway: {
        createKey: gatewayMocks.createKey,
        getStatus: gatewayMocks.getStatus,
        revokeKey: gatewayMocks.revokeKey,
      },
      gatewayRequestHandler: gatewayMocks.handleRequest,
    })
    services.push(service)
    return service
  }

  it('pairs by code and carries model requests over the WebRTC data channel', async () => {
    signalServer = startP2PRelayServer({ host: '127.0.0.1', port: 0, iceServers: [], dataTransport: 'webrtc' })
    const signalUrl = `http://127.0.0.1:${signalServer.server.port}`
    const host = makeService(signalUrl, 41001)
    const guest = makeService(signalUrl, 41002)

    const sharing = await host.startSharing({ nodeName: 'Workstation' })
    const joined = await guest.joinRemote({
      code: sharing.pairingCode!,
      deviceName: 'Laptop',
    })

    expect(joined.nodeName).toBe('Workstation')
    expect(joined.baseUrl).toContain('/p2p/connections/')
    expect(joined.models).toEqual(['test/model'])
    expect(gatewayMocks.createKey).toHaveBeenCalledWith(expect.objectContaining({
      name: expect.stringMatching(/^P2P · Laptop · /),
    }))

    const modelsUrl = new URL(`${joined.baseUrl}/v1/models`)
    const modelsResponse = await guest.handlePeerHttpRequest(new Request(modelsUrl, {
      headers: { authorization: `Bearer ${joined.apiKey}` },
    }), modelsUrl)
    expect(modelsResponse.status).toBe(200)
    expect(await modelsResponse.json()).toEqual({ object: 'list', data: [{ id: 'test/model' }] })

    const chatUrl = new URL(`${joined.baseUrl}/v1/chat/completions`)
    const chatResponse = await guest.handlePeerHttpRequest(new Request(chatUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${joined.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'test/model', messages: [] }),
    }), chatUrl)
    expect(await chatResponse.text()).toBe('data: first\n\ndata: second\n\n')
  }, 12_000)

  it('revokes one paired device without affecting another device with the same name', async () => {
    signalServer = startP2PRelayServer({ host: '127.0.0.1', port: 0, iceServers: [], dataTransport: 'webrtc' })
    const signalUrl = `http://127.0.0.1:${signalServer.server.port}`
    const host = makeService(signalUrl, 42001)
    const guestOne = makeService(signalUrl, 42002)
    const guestTwo = makeService(signalUrl, 42003)

    const sharing = await host.startSharing()
    const [first, second] = await Promise.all([
      guestOne.joinRemote({ code: sharing.pairingCode!, deviceName: 'CyberCode device' }),
      guestTwo.joinRemote({ code: sharing.pairingCode!, deviceName: 'CyberCode device' }),
    ])
    const status = await host.status()
    expect(status.peers).toHaveLength(2)
    expect(new Set(gatewayMocks.createKey.mock.calls.map(([input]) => input.name)).size).toBe(2)

    await host.revokePeer(first.peerId)
    const firstUrl = new URL(`${first.baseUrl}/v1/models`)
    const revoked = await guestOne.handlePeerHttpRequest(new Request(firstUrl, {
      headers: { authorization: `Bearer ${first.apiKey}` },
    }), firstUrl)
    expect(revoked.status).toBe(401)

    const secondUrl = new URL(`${second.baseUrl}/v1/models`)
    const stillConnected = await guestTwo.handlePeerHttpRequest(new Request(secondUrl, {
      headers: { authorization: `Bearer ${second.apiKey}` },
    }), secondUrl)
    expect(stillConnected.status).toBe(200)
  }, 12_000)

  it('falls back to an encrypted WSS tunnel without changing the model API flow', async () => {
    signalServer = startP2PRelayServer({ host: '127.0.0.1', port: 0, iceServers: [], dataTransport: 'wss' })
    const signalUrl = `http://127.0.0.1:${signalServer.server.port}`
    const host = makeService(signalUrl, 43001)
    const guest = makeService(signalUrl, 43002)

    const sharing = await host.startSharing({ nodeName: 'Relay workstation' })
    const joined = await guest.joinRemote({ code: sharing.pairingCode!, deviceName: 'Restricted network' })
    expect(joined.nodeName).toBe('Relay workstation')
    expect(joined.models).toEqual(['test/model'])

    const modelsUrl = new URL(`${joined.baseUrl}/v1/models`)
    const modelsResponse = await guest.handlePeerHttpRequest(new Request(modelsUrl, {
      headers: { authorization: `Bearer ${joined.apiKey}` },
    }), modelsUrl)
    expect(modelsResponse.status).toBe(200)
    expect(await modelsResponse.json()).toEqual({ object: 'list', data: [{ id: 'test/model' }] })

    const chatUrl = new URL(`${joined.baseUrl}/v1/chat/completions`)
    const chatResponse = await guest.handlePeerHttpRequest(new Request(chatUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${joined.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'test/model', messages: [] }),
    }), chatUrl)
    expect(await chatResponse.text()).toBe('data: first\n\ndata: second\n\n')
  }, 12_000)

  it('automatically selects encrypted WSS when WebRTC does not open in time', async () => {
    signalServer = startP2PRelayServer({
      host: '127.0.0.1',
      port: 0,
      dataTransport: 'auto',
      iceServers: [{ urls: 'turn:192.0.2.1:3478', username: 'unreachable', credential: 'unreachable' }],
    })
    const signalUrl = `http://127.0.0.1:${signalServer.server.port}`
    const host = makeService(signalUrl, 44001, 50)
    const guest = makeService(signalUrl, 44002, 50)

    const sharing = await host.startSharing()
    const startedAt = Date.now()
    const joined = await guest.joinRemote({ code: sharing.pairingCode! })
    expect(Date.now() - startedAt).toBeLessThan(2_000)

    const modelsUrl = new URL(`${joined.baseUrl}/v1/models`)
    const response = await guest.handlePeerHttpRequest(new Request(modelsUrl, {
      headers: { authorization: `Bearer ${joined.apiKey}` },
    }), modelsUrl)
    expect(response.status).toBe(200)
  }, 12_000)
})
