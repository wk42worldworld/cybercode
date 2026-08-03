import { api } from './client'

export type P2PTransportState = 'unavailable' | 'not-connected' | 'connecting' | 'connected'

export type P2PPeer = {
  id: string
  name: string
  connectedAt: string
  state: 'connecting' | 'connected'
}

export type P2PTransportStatus = {
  state: P2PTransportState
  reason?: 'signal-not-configured' | 'signal-connection-failed' | 'no-models'
  pairingCode?: string
  pairingCodeExpiresAt?: string
  peerCount: number
  peers: P2PPeer[]
}

export type P2PJoinResult = {
  sessionId: string
  peerId: string
  nodeName: string
  baseUrl: string
  apiKey: string
  models: string[]
}

export const p2pApi = {
  status() {
    return api.get<P2PTransportStatus>('/api/p2p')
  },

  startSharing() {
    return api.post<P2PTransportStatus>('/api/p2p/share', {})
  },

  stopSharing() {
    return api.delete<P2PTransportStatus>('/api/p2p/share')
  },

  join(input: { code: string; deviceName?: string }) {
    return api.post<P2PJoinResult>('/api/p2p/join', input)
  },

  revokePeer(peerId: string) {
    return api.delete<P2PTransportStatus>(`/api/p2p/peers/${encodeURIComponent(peerId)}`)
  },
}

export function isValidP2PPairingCode(value: string): boolean {
  return /^[A-HJ-KM-NP-Z2-9]{8}$/.test(value.trim().toUpperCase())
}
