import {
  createHash,
  createPublicKey,
  verify as verifyEd25519,
} from 'node:crypto'

// Keep this in sync with desktop/src-tauri/tauri.conf.json. Portable bundles
// reuse the same updater signing key, so mirror downloads never become trusted
// merely because a mirror also supplied their checksum.
export const TAURI_UPDATER_PUBLIC_KEY =
  'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEY1NERGMEEzQkU2MDc4MzcKUldRM2VHQytvL0JOOVZPMUZjK3ROV2xwc3FXVm80N0lxUHZCT2FIZU5NUDd5Y1ZOR3RnVlZkZ3gK'

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')
const TAURI_SIGNATURE_MAX_LENGTH = 4_096

type ParsedPublicKey = {
  keyId: Buffer
  key: ReturnType<typeof createPublicKey>
}

type ParsedSignature = {
  keyId: Buffer
  signature: Buffer
  trustedComment: string
  globalSignature: Buffer
}

export function createPortableSignatureDigest(data: Uint8Array): Buffer {
  return createHash('blake2b512').update(data).digest()
}

export function verifyPortableSignature(
  digest: Uint8Array,
  encodedSignature: string,
  encodedPublicKey = TAURI_UPDATER_PUBLIC_KEY,
): boolean {
  try {
    const publicKey = parsePublicKey(encodedPublicKey)
    const signature = parseSignature(encodedSignature)
    if (!publicKey.keyId.equals(signature.keyId)) return false
    if (!verifyEd25519(null, digest, publicKey.key, signature.signature)) return false

    const globalMessage = Buffer.concat([
      signature.signature,
      Buffer.from(signature.trustedComment, 'utf8'),
    ])
    return verifyEd25519(
      null,
      globalMessage,
      publicKey.key,
      signature.globalSignature,
    )
  } catch {
    return false
  }
}

function parsePublicKey(encodedPublicKey: string): ParsedPublicKey {
  const decoded = decodeOuterBase64(encodedPublicKey, TAURI_SIGNATURE_MAX_LENGTH)
  const lines = decoded.trim().split(/\r?\n/)
  if (lines.length !== 2) throw new Error('Invalid updater public key')
  const payload = decodeBase64(lines[1]!, 42)
  const algorithm = payload.subarray(0, 2).toString('ascii')
  if (algorithm !== 'Ed' && algorithm !== 'ED') {
    throw new Error('Unsupported updater public key algorithm')
  }
  const rawKey = payload.subarray(10)
  return {
    keyId: payload.subarray(2, 10),
    key: createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, rawKey]),
      format: 'der',
      type: 'spki',
    }),
  }
}

function parseSignature(encodedSignature: string): ParsedSignature {
  const decoded = decodeOuterBase64(encodedSignature, TAURI_SIGNATURE_MAX_LENGTH)
  const lines = decoded.trim().split(/\r?\n/)
  if (lines.length !== 4 || !lines[2]!.startsWith('trusted comment: ')) {
    throw new Error('Invalid updater signature')
  }
  const payload = decodeBase64(lines[1]!, 74)
  if (payload.subarray(0, 2).toString('ascii') !== 'ED') {
    throw new Error('Portable signatures must use prehashed Minisign mode')
  }
  return {
    keyId: payload.subarray(2, 10),
    signature: payload.subarray(10),
    trustedComment: lines[2]!.slice('trusted comment: '.length),
    globalSignature: decodeBase64(lines[3]!, 64),
  }
}

function decodeOuterBase64(value: string, maxLength: number): string {
  const normalized = value.trim()
  if (
    normalized.length === 0
    || normalized.length > maxLength
    || !/^[a-zA-Z0-9+/=]+$/.test(normalized)
  ) {
    throw new Error('Invalid base64 envelope')
  }
  return Buffer.from(normalized, 'base64').toString('utf8')
}

function decodeBase64(value: string, expectedLength: number): Buffer {
  if (!/^[a-zA-Z0-9+/]+={0,2}$/.test(value)) {
    throw new Error('Invalid base64 payload')
  }
  const decoded = Buffer.from(value, 'base64')
  if (decoded.byteLength !== expectedLength) {
    throw new Error('Unexpected base64 payload length')
  }
  return decoded
}
