import type {
  RouteConditionKind,
  RouteConditionOperator,
  RouteDistributionMode,
  RouteResultMode,
} from '../../../types/routing'

export const CONDITION_KINDS: RouteConditionKind[] = [
  'task',
  'modality',
  'context',
  'cost',
  'health',
  'quota',
]

export const CONDITION_OPERATORS: RouteConditionOperator[] = [
  'is',
  'is-not',
  'gte',
  'lte',
  'known',
  'unknown',
]

export const CONDITION_VALUE_OPTIONS: Partial<Record<RouteConditionKind, readonly string[]>> = {
  task: ['vision', 'coding', 'reasoning', 'audio', 'general'],
  modality: ['image', 'text', 'audio'],
}

export const DISTRIBUTION_MODES: RouteDistributionMode[] = [
  'round-robin',
  'quota',
  'weighted',
  'cost',
  'latency',
  'reliability',
]

export const RESULT_MODES: RouteResultMode[] = [
  'first-success',
  'collect',
  'judge',
]

export function uiConditionOperator(
  operator: RouteConditionOperator,
): RouteConditionOperator {
  if (operator === 'equals' || operator === 'contains') return 'is'
  if (operator === 'not-equals') return 'is-not'
  return operator
}

export function conditionValueOptions(condition: RouteConditionKind): readonly string[] {
  return CONDITION_VALUE_OPTIONS[condition] ?? []
}

export function normalizeConditionValue(
  condition: RouteConditionKind,
  value: string | number | boolean | undefined,
): string | number | boolean | undefined {
  const options = conditionValueOptions(condition)
  if (options.length === 0) return value
  const normalized = String(value ?? '')
  return options.includes(normalized) ? normalized : options[0]
}
