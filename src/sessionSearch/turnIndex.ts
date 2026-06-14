import type { REPLHookContext } from '../utils/hooks/postSamplingHooks.js'
import { getSessionId } from '../bootstrap/state.js'
import { isAutoMemoryEnabled } from '../memdir/paths.js'
import { errorMessage } from '../utils/errors.js'
import { logForDebugging } from '../utils/debug.js'
import { getTranscriptPath } from '../utils/sessionStorage.js'
import { indexSessionSearchTranscript } from './indexer.js'

const inFlightRefreshes = new Set<Promise<void>>()

async function executeSessionSearchIndexRefreshImpl(
  context: REPLHookContext,
): Promise<void> {
  try {
    if (!isAutoMemoryEnabled()) return
    if (context.toolUseContext.agentId) return

    await indexSessionSearchTranscript(getTranscriptPath(), {
      sessionId: getSessionId(),
    })
  } catch (error) {
    logForDebugging(
      `[session-search] turn-end index refresh failed: ${errorMessage(error)}`,
      { level: 'debug' },
    )
  }
}

export async function executeSessionSearchIndexRefresh(
  context: REPLHookContext,
): Promise<void> {
  const refresh = executeSessionSearchIndexRefreshImpl(context)
  inFlightRefreshes.add(refresh)
  try {
    await refresh
  } finally {
    inFlightRefreshes.delete(refresh)
  }
}

export async function drainPendingSessionSearchIndexRefresh(
  timeoutMs = 10_000,
): Promise<void> {
  if (inFlightRefreshes.size === 0) return
  await Promise.race([
    Promise.all(inFlightRefreshes).catch(() => {}),
    // eslint-disable-next-line no-restricted-syntax -- sleep() has no .unref(); timer must not block exit
    new Promise<void>(resolve => setTimeout(resolve, timeoutMs).unref()),
  ])
}

export function resetSessionSearchTurnIndexForTesting(): void {
  inFlightRefreshes.clear()
}
