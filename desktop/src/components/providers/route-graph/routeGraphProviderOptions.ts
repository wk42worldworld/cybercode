import type { TranslationKey } from '../../../i18n/locales/en'
import type { RoutingSource } from '../../../types/routing'
import { WEB_SESSION_PRESET_PREFIX } from '../../../../../src/shared/webSessionProviders'
import {
  aggregatorGatewayProviderIds,
  apiKeyProviderIds,
  inferProviderPresetId,
  noAuthProviderIds,
} from '../providerCatalog'
import type { RouteGraphSelectOption } from './RouteGraphSelect'

export type RouteGraphProviderType =
  | 'apiKey'
  | 'aggregator'
  | 'oauth'
  | 'webSession'
  | 'local'
  | 'custom'
  | 'noAuth'

const API_KEY_PROVIDER_SET = new Set<string>(apiKeyProviderIds)
const AGGREGATOR_PROVIDER_SET = new Set<string>(aggregatorGatewayProviderIds)
const KNOWN_PROVIDER_PRESET_IDS = new Set<string>([
  ...apiKeyProviderIds,
  ...aggregatorGatewayProviderIds,
  ...noAuthProviderIds,
  'custom',
  'official',
  'lmstudio',
  'ollama',
])

function effectiveProviderPresetId(source: RoutingSource): string {
  return inferProviderPresetId({
    providerId: source.presetId,
    name: source.name,
  }, KNOWN_PROVIDER_PRESET_IDS) ?? source.presetId
}

export function routeGraphProviderType(source: RoutingSource): RouteGraphProviderType {
  if (source.presetId.startsWith(WEB_SESSION_PRESET_PREFIX)) return 'webSession'
  if (source.auth === 'oauth') return 'oauth'
  if (source.auth === 'local') return 'local'
  if (source.auth === 'none') return 'noAuth'
  const presetId = effectiveProviderPresetId(source)
  if (AGGREGATOR_PROVIDER_SET.has(presetId)) return 'aggregator'
  if (API_KEY_PROVIDER_SET.has(presetId)) return 'apiKey'
  return 'custom'
}

export function routeGraphProviderTypeKey(
  source: RoutingSource,
): `settings.routing.graph.providerType.${RouteGraphProviderType}` {
  return `settings.routing.graph.providerType.${routeGraphProviderType(source)}`
}

export function routeGraphProviderOption(
  source: RoutingSource,
  translate: (key: TranslationKey) => string,
): RouteGraphSelectOption {
  return {
    value: source.providerId ?? '',
    label: source.name,
    badge: translate(routeGraphProviderTypeKey(source)),
  }
}
