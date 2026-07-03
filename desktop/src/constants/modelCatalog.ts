import type { ModelInfo } from '../types/settings'

export const OFFICIAL_DEFAULT_MODEL_ID = 'claude-opus-4-8'

export const OFFICIAL_MODELS: ModelInfo[] = [
  {
    id: 'claude-opus-4-8',
    name: 'Opus 4.8',
    description: 'Most capable for ambitious work',
    context: '1m',
    contextWindow: 1_000_000,
  },
  {
    id: 'claude-sonnet-5',
    name: 'Sonnet 5',
    description: 'Most efficient for everyday tasks',
    context: '1m',
    contextWindow: 1_000_000,
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Haiku 4.5',
    description: 'Fastest for quick answers',
    context: '200k',
    contextWindow: 200_000,
  },
]
