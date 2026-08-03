import {
  createHash,
  generateKeyPairSync,
  sign,
} from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
  createPortableSignatureDigest,
  TAURI_UPDATER_PUBLIC_KEY,
  verifyPortableSignature,
} from './portableSignature.js'

describe('portable updater signatures', () => {
  test('uses the same public key as the desktop updater', async () => {
    const config = JSON.parse(await readFile(
      resolve(import.meta.dir, '../../../desktop/src-tauri/tauri.conf.json'),
      'utf8',
    )) as { plugins: { updater: { pubkey: string } } }

    expect(TAURI_UPDATER_PUBLIC_KEY).toBe(config.plugins.updater.pubkey)
  })

  test('accepts a valid Tauri-compatible prehashed Minisign signature', () => {
    const fixture = createSignatureFixture(Buffer.from('trusted portable payload'))

    expect(verifyPortableSignature(
      createPortableSignatureDigest(fixture.payload),
      fixture.signature,
      fixture.publicKey,
    )).toBe(true)
  })

  test('rejects modified payloads and signatures from another key', () => {
    const fixture = createSignatureFixture(Buffer.from('trusted portable payload'))
    const other = createSignatureFixture(fixture.payload)

    expect(verifyPortableSignature(
      createPortableSignatureDigest(Buffer.from('modified portable payload')),
      fixture.signature,
      fixture.publicKey,
    )).toBe(false)
    expect(verifyPortableSignature(
      createPortableSignatureDigest(fixture.payload),
      other.signature,
      fixture.publicKey,
    )).toBe(false)
  })

  test('rejects malformed and legacy signature envelopes', () => {
    const fixture = createSignatureFixture(Buffer.from('trusted portable payload'))
    const decoded = Buffer.from(fixture.signature, 'base64').toString('utf8')
    const legacy = Buffer.from(decoded.replace('\nRUQ', '\nRWQ'), 'utf8').toString('base64')

    expect(verifyPortableSignature(
      createPortableSignatureDigest(fixture.payload),
      'not-base64',
      fixture.publicKey,
    )).toBe(false)
    expect(verifyPortableSignature(
      createPortableSignatureDigest(fixture.payload),
      legacy,
      fixture.publicKey,
    )).toBe(false)
  })
})

function createSignatureFixture(payload: Buffer): {
  payload: Buffer
  publicKey: string
  signature: string
} {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const publicDer = publicKey.export({ format: 'der', type: 'spki' })
  const rawPublicKey = publicDer.subarray(publicDer.byteLength - 32)
  const keyId = Buffer.from('12345678')
  const publicPayload = Buffer.concat([
    Buffer.from('Ed'),
    keyId,
    rawPublicKey,
  ])
  const publicText = [
    'untrusted comment: minisign public key',
    publicPayload.toString('base64'),
    '',
  ].join('\n')

  const digest = createHash('blake2b512').update(payload).digest()
  const messageSignature = sign(null, digest, privateKey)
  const trustedComment = 'timestamp:0\tfile:portable.bin\tprehashed'
  const globalSignature = sign(
    null,
    Buffer.concat([messageSignature, Buffer.from(trustedComment)]),
    privateKey,
  )
  const signaturePayload = Buffer.concat([
    Buffer.from('ED'),
    keyId,
    messageSignature,
  ])
  const signatureText = [
    'untrusted comment: signature from minisign secret key',
    signaturePayload.toString('base64'),
    `trusted comment: ${trustedComment}`,
    globalSignature.toString('base64'),
    '',
  ].join('\n')

  return {
    payload,
    publicKey: Buffer.from(publicText).toString('base64'),
    signature: Buffer.from(signatureText).toString('base64'),
  }
}
