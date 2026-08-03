import { gatewayApi } from '../api/gateway'
import { mediaProvidersApi } from '../api/mediaProviders'
import { providerOAuthApi } from '../api/providerOAuth'
import { webSessionProvidersApi } from '../api/webSessionProviders'
import { useCybercodeOAuthStore } from '../stores/cybercodeOAuthStore'
import { useProviderStore } from '../stores/providerStore'
import { useRoutingStore } from '../stores/routingStore'

let preloadPromise: Promise<void> | null = null

export function preloadProviderWorkspace(): Promise<void> {
  if (preloadPromise) return preloadPromise

  const providerStore = useProviderStore.getState()
  const request = Promise.allSettled([
    providerStore.fetchProviders({ quiet: true }),
    providerStore.fetchPresets({ quiet: true }),
    useCybercodeOAuthStore.getState().fetchStatus(),
    providerOAuthApi.catalog(),
    webSessionProvidersApi.catalog(),
    mediaProvidersApi.catalog(),
    gatewayApi.status(),
    useRoutingStore.getState().fetchDashboard({ quiet: true }),
    // Warm the lazily-loaded route graph editor chunk so the routing tab
    // opens without a Suspense fallback flash.
    import('../components/providers/route-graph/RouteGraphEditor'),
  ]).then(() => {})

  preloadPromise = request
  void request.finally(() => {
    if (preloadPromise === request) preloadPromise = null
  })
  return request
}
