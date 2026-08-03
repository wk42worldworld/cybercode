import { startP2PRelayServer } from './relayServer.js'

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const signalServer = startP2PRelayServer({
  host: readArg('--host') || process.env.CYBERCODE_P2P_SIGNAL_HOST || process.env.CYBERCODE_P2P_RELAY_HOST || '0.0.0.0',
  port: Number(readArg('--port') || process.env.CYBERCODE_P2P_SIGNAL_PORT || process.env.CYBERCODE_P2P_RELAY_PORT || 8765),
})

console.log(`[P2P Signal] listening on http://${signalServer.server.hostname}:${signalServer.server.port}`)

const shutdown = () => {
  signalServer.stop()
  process.exit(0)
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
