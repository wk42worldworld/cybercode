import {
  compactLocalSystemPromptParts,
  compactLocalToolSchemas,
  isLocalInferenceProvider,
} from '../../utils/localModelPerformance.js'
import type { SavedProvider } from '../types/provider.js'
import type { AnthropicRequest } from './transform/types.js'

export function optimizeAnthropicRequestForLocalModel(
  body: AnthropicRequest,
): AnthropicRequest {
  const systemParts = typeof body.system === 'string'
    ? [body.system]
    : body.system?.map((block) => block.text) ?? []
  const compactedSystem = compactLocalSystemPromptParts(systemParts)

  return {
    ...body,
    ...(body.system !== undefined && {
      system: typeof body.system === 'string'
        ? compactedSystem.join('\n\n')
        : compactedSystem.map((text) => ({ type: 'text' as const, text })),
    }),
    ...(body.tools && { tools: compactLocalToolSchemas(body.tools) }),
  }
}

export function prepareAnthropicRequestForProvider(
  provider: Pick<SavedProvider, 'presetId' | 'baseUrl'>,
  body: AnthropicRequest,
): { body: AnthropicRequest; localModelPerformance: boolean } {
  const localModelPerformance = isLocalInferenceProvider(provider)
  return {
    body: localModelPerformance
      ? optimizeAnthropicRequestForLocalModel(body)
      : body,
    localModelPerformance,
  }
}
