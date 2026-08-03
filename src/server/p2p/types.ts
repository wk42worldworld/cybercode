export const P2P_PAIRING_CODE_PATTERN = /^[A-HJ-KM-NP-Z2-9]{8}$/

export type P2PIceServer = {
  urls: string
  username?: string
  credential?: string
}

export type P2PDataTransportMode = 'webrtc' | 'auto' | 'wss'

export type P2PSessionDescription = {
  type: 'offer' | 'answer'
  sdp: string
}

export type P2PSignalPayload = {
  kind: 'description'
  description: P2PSessionDescription
}

export type P2PRelayHostRegister = {
  type: 'host_register'
  code: string
  nodeName?: string
  protocol: 2
}

export type P2PRelayGuestJoin = {
  type: 'guest_join'
  code: string
  deviceName: string
  tunnelPublicKey?: string
  protocol: 2
}

export type P2PRelayHostRotate = {
  type: 'host_rotate_code'
  code: string
}

export type P2PRelayRegistered = {
  type: 'registered'
  sessionId: string
  pairingCodeExpiresAt: string
  iceServers: P2PIceServer[]
  dataTransport: P2PDataTransportMode
}

export type P2PRelayJoining = {
  type: 'joining'
  sessionId: string
  peerId: string
  nodeName: string
  iceServers: P2PIceServer[]
  dataTransport: P2PDataTransportMode
}

export type P2PRelayJoinRequest = {
  type: 'join_request'
  peerId: string
  deviceName: string
  tunnelPublicKey?: string
}

export type P2PRelaySignal = {
  type: 'signal'
  peerId: string
  signal: P2PSignalPayload
}

export type P2PRelayTunnelHandshake = {
  type: 'tunnel_handshake'
  peerId: string
  tunnelPublicKey: string
}

export type P2PRelayTunnelActivate = {
  type: 'tunnel_activate'
  peerId: string
}

export type P2PRelayTunnelFrame = {
  type: 'tunnel_frame'
  peerId: string
  seq: number
  dataBase64: string
}

export type P2PRelayPeerRevoked = {
  type: 'peer_revoked'
  peerId: string
  message?: string
}

export type P2PRelayError = {
  type: 'error'
  code: string
  message: string
}

export type P2PRelayClientMessage =
  | P2PRelayHostRegister
  | P2PRelayHostRotate
  | P2PRelayGuestJoin
  | P2PRelaySignal
  | P2PRelayTunnelHandshake
  | P2PRelayTunnelActivate
  | P2PRelayTunnelFrame
  | P2PRelayPeerRevoked
  | { type: 'heartbeat' }

export type P2PRelayServerMessage =
  | P2PRelayRegistered
  | P2PRelayJoining
  | P2PRelayJoinRequest
  | P2PRelaySignal
  | P2PRelayTunnelHandshake
  | P2PRelayTunnelActivate
  | P2PRelayTunnelFrame
  | P2PRelayPeerRevoked
  | P2PRelayError
  | { type: 'host_offline' }
  | { type: 'pong' }

export type P2PDataReady = {
  type: 'ready'
  peerId: string
  nodeName: string
  apiKey: string
  models: string[]
}

export type P2PDataHttpRequestStart = {
  type: 'http_request_start'
  requestId: string
  method: string
  path: string
  headers: Record<string, string>
}

export type P2PDataHttpRequestChunk = {
  type: 'http_request_chunk'
  requestId: string
  dataBase64: string
}

export type P2PDataHttpRequestEnd = {
  type: 'http_request_end'
  requestId: string
}

export type P2PDataHttpResponseStart = {
  type: 'http_response_start'
  requestId: string
  status: number
  headers: Record<string, string>
}

export type P2PDataHttpResponseChunk = {
  type: 'http_response_chunk'
  requestId: string
  dataBase64: string
}

export type P2PDataHttpResponseEnd = {
  type: 'http_response_end'
  requestId: string
}

export type P2PDataHttpResponseError = {
  type: 'http_response_error'
  requestId: string
  message: string
}

export type P2PDataMessage =
  | P2PDataReady
  | P2PDataHttpRequestStart
  | P2PDataHttpRequestChunk
  | P2PDataHttpRequestEnd
  | P2PDataHttpResponseStart
  | P2PDataHttpResponseChunk
  | P2PDataHttpResponseEnd
  | P2PDataHttpResponseError
  | { type: 'http_cancel'; requestId: string }
  | { type: 'revoked'; message: string }
  | { type: 'revoke_ack' }

export type P2PRelayStatus = {
  state: 'unavailable' | 'not-connected' | 'connecting' | 'connected'
  reason?: 'signal-not-configured' | 'signal-connection-failed' | 'no-models'
  pairingCode?: string
  pairingCodeExpiresAt?: string
  peerCount: number
  peers: Array<{
    id: string
    name: string
    connectedAt: string
    state: 'connecting' | 'connected'
  }>
}

export type P2PJoinResult = {
  sessionId: string
  peerId: string
  nodeName: string
  baseUrl: string
  apiKey: string
  models: string[]
}
