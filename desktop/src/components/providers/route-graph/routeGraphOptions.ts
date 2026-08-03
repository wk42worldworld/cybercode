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
