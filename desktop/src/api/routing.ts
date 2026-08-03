import { api } from './client'
import type {
  RouteGraph,
  RoutePreviewResult,
  RoutingConfig,
  RoutingDashboard,
} from '../types/routing'
import {
  deserializeRouteProfile,
  deserializeRoutingConfig,
  deserializeRoutingDashboard,
  normalizePreviewTrace,
  serializeRouteGraph,
  serializeRoutingConfig,
  type WireRoutePreviewTrace,
  type WireRoutingConfig,
  type WireRoutingDashboard,
} from './routingWire'

export const routingApi = {
  async dashboard(): Promise<RoutingDashboard> {
    const dashboard = await api.get<WireRoutingDashboard>('/api/routing')
    return deserializeRoutingDashboard(dashboard)
  },

  async updateConfig(config: RoutingConfig): Promise<{ config: RoutingConfig }> {
    const result = await api.put<{ config: WireRoutingConfig }>(
      '/api/routing/config',
      serializeRoutingConfig(config),
    )
    return { config: deserializeRoutingConfig(result.config) }
  },

  async preview(routeId: string, graph: RouteGraph): Promise<RoutePreviewResult> {
    const result = await api.post<{ trace: WireRoutePreviewTrace }>(
      '/api/routing/preview',
      { profileId: routeId, graph: serializeRouteGraph(graph) },
    )
    return normalizePreviewTrace(result.trace)
  },

  async publish(routeId: string, graph: RouteGraph, name: string) {
    const result = await api.post<{
      profile: Parameters<typeof deserializeRouteProfile>[0]
      validation: WireRoutePreviewTrace['validation']
    }>('/api/routing/publish', {
      profileId: routeId,
      graph: serializeRouteGraph(graph),
      name,
    })
    return {
      profile: deserializeRouteProfile(result.profile),
      validation: {
        valid: result.validation.valid,
        issues: result.validation.issues.map((issue) => ({
          ...issue,
          messageKey: `settings.routing.graph.validation.${issue.code}`,
        })),
      },
    }
  },

  async rollback(routeId: string) {
    const result = await api.post<{
      profile: Parameters<typeof deserializeRouteProfile>[0]
    }>('/api/routing/rollback', { profileId: routeId })
    return { profile: deserializeRouteProfile(result.profile) }
  },

  resetHealth() {
    return api.post<{ ok: true }>('/api/routing/reset-health')
  },
}
