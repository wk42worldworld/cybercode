import React, { useEffect, useMemo, useState } from 'react'
import { getSessionId } from '../../bootstrap/state.js'
import { Select } from '../../components/CustomSelect/index.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { Box, Text } from '../../ink.js'
import { activateRouteForCli } from '../../server/proxy/embeddedProxy.js'
import { routingService } from '../../server/routing/routingService.js'
import {
  ROUTING_STRATEGIES,
  type RoutingDashboard,
  type RoutingStrategy,
} from '../../server/routing/types.js'
import type {
  LocalJSXCommandCall,
  LocalJSXCommandContext,
  LocalJSXCommandOnDone,
} from '../../types/command.js'
import { stripSignatureBlocks } from '../../utils/messages.js'

const ROUTING_USAGE = [
  'Usage:',
  '/routing',
  '/routing status',
  '/routing use <route-id>',
  '/routing on|off',
  '/routing create <route-id> [name]',
  '/routing enable|disable <route-id>',
  `/routing strategy <route-id> <${ROUTING_STRATEGIES.join('|')}>`,
  '/routing delete <route-id>',
  '/routing reset-health',
].join('\n')

export type RoutingCommandResult = {
  message: string
  runtimeModel?: string
}

function formatDashboard(dashboard: RoutingDashboard): string {
  if (dashboard.config.profiles.length === 0) {
    return `Agent routing is ${dashboard.config.enabled ? 'on' : 'off'}, with no routes configured.`
  }
  const routes = dashboard.config.profiles.map(profile => {
    const availability = dashboard.routeAvailability[profile.id]
    const state = availability?.available
      ? `${availability.candidateCount} available target${availability.candidateCount === 1 ? '' : 's'}`
      : availability?.reason ?? 'unavailable'
    return `${profile.enabled ? '*' : '-'} ${profile.name} [${profile.id}] · ${profile.strategy} · ${state}`
  })
  return `Agent routing is ${dashboard.config.enabled ? 'on' : 'off'}:\n${routes.join('\n')}`
}

async function updateRoute(
  routeId: string,
  update: (profile: RoutingDashboard['config']['profiles'][number]) => RoutingDashboard['config']['profiles'][number],
): Promise<RoutingDashboard['config']> {
  const config = await routingService.getConfig()
  const index = config.profiles.findIndex(profile => profile.id === routeId)
  if (index < 0) throw new Error(`Route not found: ${routeId}`)
  const profiles = [...config.profiles]
  profiles[index] = update(profiles[index]!)
  return routingService.updateConfig({ ...config, profiles })
}

export async function executeRoutingCommand(
  args: string,
  sessionId = String(getSessionId()),
): Promise<RoutingCommandResult | null> {
  const trimmed = args.trim()
  if (!trimmed) return null
  const [actionRaw, routeIdRaw, ...rest] = trimmed.split(/\s+/)
  const action = actionRaw?.toLowerCase()
  const routeId = routeIdRaw?.trim()

  if (action === 'status' || action === 'list') {
    return { message: formatDashboard(await routingService.getDashboard()) }
  }

  if (action === 'on' || action === 'off') {
    const config = await routingService.getConfig()
    const enabled = action === 'on'
    await routingService.updateConfig({ ...config, enabled })
    return { message: `Agent routing is ${enabled ? 'on' : 'off'}.` }
  }

  if (action === 'use') {
    if (!routeId) return { message: ROUTING_USAGE }
    const runtime = await activateRouteForCli(routeId, sessionId)
    return {
      message: `Using agent route ${routeId} for this TUI session.`,
      runtimeModel: runtime.model,
    }
  }

  if (action === 'create') {
    if (!routeId) return { message: ROUTING_USAGE }
    const config = await routingService.getConfig()
    if (config.profiles.some(profile => profile.id === routeId)) {
      throw new Error(`Route already exists: ${routeId}`)
    }
    const name = rest.join(' ').trim() || routeId
    await routingService.updateConfig({
      ...config,
      profiles: [...config.profiles, {
        id: routeId,
        name,
        enabled: true,
        strategy: 'auto',
        strictFree: false,
        allowExperimental: false,
        maxAttempts: 3,
        targets: [],
      }],
    })
    return {
      message: `Created route ${name} [${routeId}] using all configured stable providers.`,
    }
  }

  if (action === 'enable' || action === 'disable') {
    if (!routeId) return { message: ROUTING_USAGE }
    const enabled = action === 'enable'
    await updateRoute(routeId, profile => ({ ...profile, enabled }))
    return { message: `Route ${routeId} is ${enabled ? 'enabled' : 'disabled'}.` }
  }

  if (action === 'strategy') {
    const strategy = rest[0] as RoutingStrategy | undefined
    if (!routeId || !strategy || !ROUTING_STRATEGIES.includes(strategy)) {
      return { message: ROUTING_USAGE }
    }
    await updateRoute(routeId, profile => ({ ...profile, strategy }))
    return { message: `Route ${routeId} now uses the ${strategy} strategy.` }
  }

  if (action === 'delete') {
    if (!routeId) return { message: ROUTING_USAGE }
    const config = await routingService.getConfig()
    if (!config.profiles.some(profile => profile.id === routeId)) {
      throw new Error(`Route not found: ${routeId}`)
    }
    await routingService.updateConfig({
      ...config,
      profiles: config.profiles.filter(profile => profile.id !== routeId),
    })
    return { message: `Deleted route ${routeId}.` }
  }

  if (action === 'reset-health') {
    routingService.resetHealth()
    return { message: 'Smart-route health history was reset.' }
  }

  return { message: ROUTING_USAGE }
}

function RoutingPicker({
  onActivate,
  onDone,
}: {
  onActivate: (routeId: string) => Promise<void>
  onDone: LocalJSXCommandOnDone
}): React.ReactNode {
  const [dashboard, setDashboard] = useState<RoutingDashboard | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    try {
      setDashboard(await routingService.getDashboard())
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const options = useMemo(() => {
    if (!dashboard) return []
    return [
      ...dashboard.config.profiles.map(profile => {
        const availability = dashboard.routeAvailability[profile.id]
        return {
          label: profile.name,
          value: `use:${profile.id}`,
          description: availability?.available
            ? `${profile.strategy} · ${availability.candidateCount} targets`
            : availability?.reason ?? 'Unavailable',
          disabled: !availability?.available,
        }
      }),
      {
        label: dashboard.config.enabled ? 'Turn agent routing off' : 'Turn agent routing on',
        value: 'toggle',
        description: 'Applies to every saved route',
      },
      {
        label: 'Reset route health',
        value: 'reset',
        description: 'Clear failures, cooldowns, and recent route events',
      },
      {
        label: 'Close',
        value: 'close',
      },
    ]
  }, [dashboard])

  const select = async (value: string) => {
    if (busy || !dashboard) return
    if (value === 'close') {
      onDone('Agent routing unchanged.', { display: 'system' })
      return
    }
    if (value.startsWith('use:')) {
      setBusy(true)
      try {
        await onActivate(value.slice(4))
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
        setBusy(false)
      }
      return
    }
    if (value === 'toggle') {
      setBusy(true)
      try {
        await routingService.updateConfig({
          ...dashboard.config,
          enabled: !dashboard.config.enabled,
        })
        await load()
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setBusy(false)
      }
      return
    }
    if (value === 'reset') {
      routingService.resetHealth()
      await load()
    }
  }

  return (
    <Dialog
      title="Agent routing"
      subtitle="Routes share the same provider and model catalog as CyberCode Desktop."
      color="permission"
      onCancel={() => onDone('Agent routing unchanged.', { display: 'system' })}
    >
      {!dashboard ? <Text dimColor>Loading routes...</Text> : null}
      {error ? <Text color="error">{error}</Text> : null}
      {busy ? <Text dimColor>Preparing route...</Text> : null}
      {dashboard && options.length > 0 ? (
        <Box flexDirection="column" gap={1}>
          {dashboard.config.profiles.length === 0 ? (
            <Text dimColor>No routes yet. Use /routing create &lt;route-id&gt; [name].</Text>
          ) : null}
          <Select
            options={options}
            visibleOptionCount={10}
            layout="compact-vertical"
            isDisabled={busy}
            onChange={value => void select(value)}
            onCancel={() => onDone('Agent routing unchanged.', { display: 'system' })}
          />
        </Box>
      ) : null}
    </Dialog>
  )
}

function applyRouteRuntime(
  context: LocalJSXCommandContext,
  runtimeModel: string,
): void {
  context.onChangeAPIKey()
  context.setMessages(stripSignatureBlocks)
  context.setAppState(previous => ({
    ...previous,
    mainLoopModel: runtimeModel,
    mainLoopModelForSession: null,
  }))
}

export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  try {
    const result = await executeRoutingCommand(args)
    if (result !== null) {
      if (result.runtimeModel) applyRouteRuntime(context, result.runtimeModel)
      onDone(result.message, { display: 'system' })
      return null
    }
  } catch (error) {
    onDone(
      `Routing command failed: ${error instanceof Error ? error.message : String(error)}`,
      { display: 'system' },
    )
    return null
  }

  return (
    <RoutingPicker
      onDone={onDone}
      onActivate={async routeId => {
        const result = await executeRoutingCommand(`use ${routeId}`)
        if (!result?.runtimeModel) throw new Error('Route activation did not return a model')
        applyRouteRuntime(context, result.runtimeModel)
        onDone(result.message, { display: 'system' })
      }}
    />
  )
}
