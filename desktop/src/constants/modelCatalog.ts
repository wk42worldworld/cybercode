import type { ModelInfo } from '../types/settings'

export const OFFICIAL_DEFAULT_MODEL_ID = 'claude-opus-4-7'

export const OFFICIAL_MODELS: ModelInfo[] = [
  {
    id: 'claude-opus-4-7',
    name: 'Opus 4.7',
    description: 'Most capable for ambitious work',
    context: '1m',
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Sonnet 4.6',
    description: 'Most efficient for everyday tasks',
    context: '200k',
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Haiku 4.5',
    description: 'Fastest for quick answers',
    context: '200k',
  },
]
