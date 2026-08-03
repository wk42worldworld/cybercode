import React, { useEffect, useMemo, useState } from 'react'
import { Select } from '../../components/CustomSelect/index.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { Box, Link, Text } from '../../ink.js'
import { gatewayService } from '../../server/gateway/gatewayService.js'
import type {
  GatewayConfigUpdate,
  GatewayKeyStatus,
  GatewayKeyUpdate,
  GatewayStatus,
  GatewayTarget,
} from '../../server/gateway/types.js'
import { ensureEmbeddedRuntimeServer } from '../../server/proxy/embeddedProxy.js'
import type {
  LocalJSXCommandCall,
  LocalJSXCommandOnDone,
} from '../../types/command.js'

const NODE_GUIDE_URL = 'https://wk42worldworld.github.io/cybercode/guide/agent-node.html'
const NODE_USAGE = [
  'Usage:',
  '/node',
  '/node status',
  '/node targets',
  '/node start',
  '/node stop',
  '/node key list|create <name>|rename <key> <name>|rotate <key>|revoke <key>',
  '/node rotate [key-id-or-prefix]',
  '/node revoke [key-id-or-prefix]',
  '/node limit <monthly-requests> [--key=<id-or-prefix>]',
  '/node allow all|none|<public-id[,public-id...]> [--key=<id-or-prefix>]',
  '/node default <public-id|none> [--key=<id-or-prefix>]',
].join('\n')

export type NodeCommandResult = {
  message: string
  apiKey?: string
}

function statusUrl(origin: string): URL {
  return new URL(origin)
}

async function loadNodeStatus(): Promise<{
  origin: string
  status: GatewayStatus
}> {
  const runtime = ensureEmbeddedRuntimeServer()
  return {
    origin: runtime.origin,
    status: await gatewayService.getStatus(statusUrl(runtime.origin)),
  }
}

function configFromStatus(
  status: GatewayStatus,
  update: Partial<GatewayConfigUpdate> = {},
): GatewayConfigUpdate {
  return {
    enabled: status.enabled,
    publicBaseUrl: status.publicBaseUrl ?? null,
    ...update,
  }
}

function formatStatus(status: GatewayStatus): string {
  const available = status.targets.filter(target => target.available)
  const keys = status.keys.length > 0
    ? status.keys.map((key) => {
        const limit = key.monthlyRequestLimit > 0 ? String(key.monthlyRequestLimit) : 'unlimited'
        return `- ${key.name}: ${key.prefix}… · ${key.allowedTargets.length} targets · ${key.usage.requests}/${limit}`
      })
    : ['- no API keys']
  return [
    `Agent node is ${status.enabled && status.keys.length > 0 ? 'online' : 'offline'}.`,
    `Endpoint: ${status.baseUrl}`,
    `Targets: ${available.length} available`,
    `API keys (${status.keys.length}):`,
    ...keys,
  ].join('\n')
}

function formatTargets(status: GatewayStatus): string {
  const targets = status.targets.map((target) => (
    `- ${target.publicId} · ${target.kind} · ${target.available ? 'available' : 'unavailable'} · ${target.description}`
  ))
  return [
    `Node targets (${targets.length}):`,
    ...(targets.length > 0 ? targets : ['- no targets']),
  ].join('\n')
}

function resolveKey(status: GatewayStatus, reference?: string): GatewayKeyStatus {
  if (status.keys.length === 0) {
    throw new Error('Create a node API key with /node start or /node key create <name> first.')
  }
  if (!reference) {
    if (status.keys.length === 1) return status.keys[0]!
    throw new Error('This node has multiple API keys. Specify one by ID, prefix, or exact name.')
  }
  const normalized = reference.toLocaleLowerCase()
  const exactMatches = status.keys.filter((candidate) => (
    candidate.id === reference ||
    candidate.prefix === reference ||
    candidate.name.toLocaleLowerCase() === normalized
  ))
  if (exactMatches.length === 1) return exactMatches[0]!
  if (exactMatches.length > 1) {
    throw new Error(`Ambiguous node API key reference: ${reference}`)
  }
  const prefixMatches = status.keys.filter((candidate) => (
    candidate.id.startsWith(reference) ||
    candidate.name.toLocaleLowerCase().startsWith(normalized)
  ))
  if (prefixMatches.length === 1) return prefixMatches[0]!
  if (prefixMatches.length > 1) {
    throw new Error(`Ambiguous node API key reference: ${reference}`)
  }
  throw new Error(`Unknown node API key: ${reference}`)
}

function resolveTarget(status: GatewayStatus, reference: string): GatewayTarget {
  const matches = status.targets.filter((candidate) => (
    candidate.id === reference || candidate.publicId === reference
  ))
  if (matches.length === 1) return matches[0]!
  if (matches.length > 1) {
    throw new Error(`Ambiguous node target: ${reference}`)
  }
  throw new Error(`Unknown node target: ${reference}`)
}

function parseKeyOption(parts: string[]): { parts: string[]; keyReference?: string } {
  const keyOption = parts.find((part) => part.startsWith('--key='))
  return {
    parts: parts.filter((part) => part !== keyOption),
    ...(keyOption && { keyReference: keyOption.slice('--key='.length) }),
  }
}

async function updateNode(
  origin: string,
  status: GatewayStatus,
  update: Partial<GatewayConfigUpdate>,
): Promise<GatewayStatus> {
  return gatewayService.updateConfig(
    configFromStatus(status, update),
    statusUrl(origin),
  )
}

async function updateNodeKey(
  origin: string,
  keyId: string,
  update: GatewayKeyUpdate,
): Promise<GatewayStatus> {
  return gatewayService.updateKey(keyId, update, statusUrl(origin))
}

export async function executeNodeCommand(args: string): Promise<NodeCommandResult | null> {
  const trimmed = args.trim()
  if (!trimmed) return null
  const [actionRaw, valueRaw, ...rest] = trimmed.split(/\s+/)
  const action = actionRaw?.toLowerCase()
  const { origin, status } = await loadNodeStatus()

  if (action === 'status' || action === 'list') {
    return { message: formatStatus(status) }
  }

  if (action === 'targets') {
    return { message: formatTargets(status) }
  }

  if (action === 'start') {
    if (status.keys.length === 0) {
      const result = await gatewayService.createKey(
        { name: 'TUI user' },
        statusUrl(origin),
      )
      return {
        apiKey: result.apiKey,
        message: [
          formatStatus(result.status),
          '',
          `New API key: ${result.apiKey}`,
          'This complete key is shown once. Store it in the receiving agent now.',
        ].join('\n'),
      }
    }
    const next = await updateNode(origin, status, { enabled: true })
    return { message: formatStatus(next) }
  }

  if (action === 'stop') {
    const next = await updateNode(origin, status, { enabled: false })
    return { message: formatStatus(next) }
  }

  if (action === 'key') {
    const subcommand = valueRaw?.toLowerCase()
    if (subcommand === 'list') return { message: formatStatus(status) }
    if (subcommand === 'create') {
      const name = rest.join(' ').trim() || undefined
      const result = await gatewayService.createKey(
        { ...(name && { name }) },
        statusUrl(origin),
      )
      return {
        apiKey: result.apiKey,
        message: [
          formatStatus(result.status),
          '',
          `New API key (${result.keyId}): ${result.apiKey}`,
          'This complete key is shown once. Store it in the receiving agent now.',
        ].join('\n'),
      }
    }
    const keyReference = rest[0]
    const key = resolveKey(status, keyReference)
    if (subcommand === 'rename') {
      const name = rest.slice(1).join(' ').trim()
      if (!name) return { message: NODE_USAGE }
      const next = await updateNodeKey(origin, key.id, { name })
      return { message: formatStatus(next) }
    }
    if (subcommand === 'rotate') {
      const result = await gatewayService.rotateKey(key.id, statusUrl(origin))
      return {
        apiKey: result.apiKey,
        message: [
          formatStatus(result.status),
          '',
          `New API key (${key.name}): ${result.apiKey}`,
          'The previous value for this key was revoked. Other keys are unchanged.',
        ].join('\n'),
      }
    }
    if (subcommand === 'revoke') {
      const next = await gatewayService.revokeKey(key.id, statusUrl(origin))
      return { message: formatStatus(next) }
    }
    return { message: NODE_USAGE }
  }

  if (action === 'rotate') {
    const key = resolveKey(status, valueRaw)
    const result = await gatewayService.rotateKey(key.id, statusUrl(origin))
    return {
      apiKey: result.apiKey,
      message: [
        formatStatus(result.status),
        '',
        `New API key (${key.name}): ${result.apiKey}`,
        'The previous value for this key was revoked. Other keys are unchanged.',
      ].join('\n'),
    }
  }

  if (action === 'revoke') {
    const key = resolveKey(status, valueRaw)
    const next = await gatewayService.revokeKey(key.id, statusUrl(origin))
    return { message: formatStatus(next) }
  }

  if (action === 'limit') {
    const limit = Number.parseInt(valueRaw ?? '', 10)
    if (!Number.isInteger(limit) || limit < 0 || limit > 10_000_000) {
      return { message: NODE_USAGE }
    }
    const parsed = parseKeyOption(rest)
    const key = resolveKey(status, parsed.keyReference ?? parsed.parts[0])
    const next = await updateNodeKey(origin, key.id, { monthlyRequestLimit: limit })
    return { message: formatStatus(next) }
  }

  if (action === 'allow') {
    const parsed = parseKeyOption([valueRaw, ...rest].filter((part): part is string => Boolean(part)))
    const key = resolveKey(status, parsed.keyReference)
    const requested = parsed.parts.join('')
    let allowedTargets: string[]
    if (requested === 'all') {
      allowedTargets = status.targets
        .filter(target => target.available)
        .map(target => target.id)
    } else if (requested === 'none') {
      allowedTargets = []
    } else if (requested) {
      const requestedTargets = [...new Set(requested.split(',').map(item => item.trim()).filter(Boolean))]
      allowedTargets = [...new Set(
        requestedTargets.map((target) => resolveTarget(status, target).id),
      )]
    } else {
      return { message: NODE_USAGE }
    }
    const defaultTarget = key.defaultTarget &&
      allowedTargets.includes(key.defaultTarget)
      ? key.defaultTarget
      : null
    const next = await updateNodeKey(origin, key.id, {
      allowedTargets,
      defaultTarget,
    })
    return { message: formatStatus(next) }
  }

  if (action === 'default') {
    const parsed = parseKeyOption([valueRaw, ...rest].filter((part): part is string => Boolean(part)))
    const key = resolveKey(status, parsed.keyReference)
    const requested = parsed.parts.join(' ')
    if (!requested) return { message: NODE_USAGE }
    if (requested === 'none') {
      const next = await updateNodeKey(origin, key.id, { defaultTarget: null })
      return { message: formatStatus(next) }
    }
    const target = resolveTarget(status, requested)
    if (!target.available) throw new Error(`Node target is unavailable: ${requested}`)
    const next = await updateNodeKey(origin, key.id, {
      allowedTargets: [...new Set([...key.allowedTargets, target.id])],
      defaultTarget: target.id,
    })
    return { message: formatStatus(next) }
  }

  return { message: NODE_USAGE }
}

function NodePicker({
  onDone,
}: {
  onDone: LocalJSXCommandOnDone
}): React.ReactNode {
  const [status, setStatus] = useState<GatewayStatus | null>(null)
  const [origin, setOrigin] = useState('')
  const [mode, setMode] = useState<'main' | 'keys' | 'default'>('main')
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const result = await loadNodeStatus()
      setOrigin(result.origin)
      setStatus(result.status)
      setSelectedKeyId((current) => (
        current && result.status.keys.some((key) => key.id === current)
          ? current
          : result.status.keys[0]?.id ?? null
      ))
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const selectedKey = useMemo(
    () => status?.keys.find((key) => key.id === selectedKeyId) ?? status?.keys[0],
    [selectedKeyId, status],
  )

  const options = useMemo(() => {
    if (!status) return []
    if (mode === 'keys') {
      return [
        ...status.keys.map((key) => ({
          label: key.name,
          value: `key:${key.id}`,
          description: `${key.prefix}… · ${key.usage.requests} requests this month`,
        })),
        { label: 'Back', value: 'back' },
      ]
    }
    if (mode === 'default') {
      return [
        ...status.targets.filter(target => target.available).map(target => ({
          label: target.label,
          value: `target:${target.id}`,
          description: `${target.kind} · ${target.description}`,
        })),
        { label: 'No default target', value: 'target:none' },
        { label: 'Back', value: 'back' },
      ]
    }
    return [
      {
        label: status.enabled && status.keys.length > 0 ? 'Stop node' : 'Start node',
        value: status.enabled && status.keys.length > 0 ? 'stop' : 'start',
        description: status.enabled && status.keys.length > 0
          ? 'Reject new external-agent requests'
          : 'Listen locally using the built-in runtime',
      },
      {
        label: 'Create another API key',
        value: 'create',
        description: 'The complete key is shown once',
      },
      {
        label: 'Choose API key',
        value: 'keys',
        description: selectedKey
          ? `${selectedKey.name} · ${selectedKey.prefix}…`
          : 'No API key selected',
        disabled: status.keys.length === 0,
      },
      {
        label: 'Rotate selected API key',
        value: 'rotate',
        description: selectedKey?.name ?? 'Create a key first',
        disabled: !selectedKey,
      },
      {
        label: 'Choose default target',
        value: 'default',
        description: selectedKey?.defaultTarget ?? 'Not set',
        disabled: !selectedKey,
      },
      {
        label: 'Allow all available targets',
        value: 'allow-all',
        description: `${status.targets.filter(target => target.available).length} available`,
        disabled: !selectedKey,
      },
      {
        label: 'Close',
        value: 'close',
      },
    ]
  }, [mode, selectedKey, status])

  const select = async (value: string) => {
    if (!status || busy) return
    if (value === 'close') {
      onDone(formatStatus(status), { display: 'system' })
      return
    }
    if (value === 'back') {
      setMode('main')
      return
    }
    if (value === 'keys') {
      setMode('keys')
      return
    }
    if (value === 'default') {
      setMode('default')
      return
    }
    if (value.startsWith('key:')) {
      setSelectedKeyId(value.slice(4))
      setMode('main')
      return
    }

    setBusy(true)
    try {
      if (value === 'start' || value === 'create' || value === 'rotate') {
        const command = value === 'create'
          ? 'key create'
          : value === 'rotate'
            ? `rotate ${selectedKey?.id ?? ''}`.trim()
            : value
        const result = await executeNodeCommand(command)
        if (!result) throw new Error('Node did not return a result')
        onDone(result.message, { display: 'system' })
        return
      }
      if (value === 'stop') {
        setStatus(await updateNode(origin, status, { enabled: false }))
      } else if (value === 'allow-all') {
        if (!selectedKey) throw new Error('Choose an API key first')
        setStatus(await updateNodeKey(origin, selectedKey.id, {
          allowedTargets: status.targets
            .filter(target => target.available)
            .map(target => target.id),
        }))
      } else if (value.startsWith('target:')) {
        if (!selectedKey) throw new Error('Choose an API key first')
        const targetId = value.slice(7)
        setStatus(await updateNodeKey(origin, selectedKey.id, {
          allowedTargets: targetId === 'none'
            ? selectedKey.allowedTargets
            : [...new Set([...selectedKey.allowedTargets, targetId])],
          defaultTarget: targetId === 'none' ? null : targetId,
        }))
        setMode('main')
      }
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      title="Agent node"
      subtitle="Connect another agent through CyberCode's models or agent routes."
      color="permission"
      onCancel={() => onDone(status ? formatStatus(status) : 'Agent node unchanged.', { display: 'system' })}
    >
      {!status ? <Text dimColor>Starting the built-in node runtime...</Text> : null}
      {status ? (
        <Box flexDirection="column">
          <Text>{status.enabled && status.keys.length > 0 ? 'Online' : 'Offline'} · {status.baseUrl}</Text>
          <Text dimColor>{status.targets.filter(target => target.available).length} targets available</Text>
          <Text dimColor>
            {selectedKey
              ? `Selected key: ${selectedKey.name} · ${selectedKey.prefix}…`
              : 'No API key selected'}
          </Text>
        </Box>
      ) : null}
      {error ? <Text color="error">{error}</Text> : null}
      {busy ? <Text dimColor>Updating node...</Text> : null}
      {status ? (
        <Select
          options={options}
          visibleOptionCount={10}
          layout="compact-vertical"
          isDisabled={busy}
          onChange={value => void select(value)}
          onCancel={() => {
            if (mode !== 'main') setMode('main')
            else onDone(formatStatus(status), { display: 'system' })
          }}
        />
      ) : null}
      <Text dimColor>Connection guide: <Link url={NODE_GUIDE_URL} /></Text>
    </Dialog>
  )
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  try {
    const result = await executeNodeCommand(args)
    if (result !== null) {
      onDone(result.message, { display: 'system' })
      return null
    }
  } catch (error) {
    onDone(
      `Node command failed: ${error instanceof Error ? error.message : String(error)}`,
      { display: 'system' },
    )
    return null
  }

  return <NodePicker onDone={onDone} />
}
