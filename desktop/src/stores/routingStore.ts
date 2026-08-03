import { create } from 'zustand'
import { routingApi } from '../api/routing'
import type {
  RouteGraph,
  RoutePreviewResult,
  RouteProfile,
  RoutingConfig,
  RoutingDashboard,
} from '../types/routing'
import { cloneRouteGraph } from '../utils/routeGraph'

type RoutingStore = {
  dashboard: RoutingDashboard | null
  previews: Record<string, RoutePreviewResult | undefined>
  isLoading: boolean
  isSaving: boolean
  isPreviewing: boolean
  isPublishing: boolean
  error: string | null
  fetchDashboard: (options?: { quiet?: boolean }) => Promise<void>
  updateConfig: (config: RoutingConfig) => Promise<void>
  updateProfile: (profile: RouteProfile) => Promise<void>
  updateProfileDraft: (
    routeId: string,
    graph: RouteGraph,
    options?: { name?: string },
  ) => Promise<void>
  previewProfile: (routeId: string, graph: RouteGraph) => Promise<RoutePreviewResult | null>
  publishProfile: (routeId: string, graph: RouteGraph, name: string) => Promise<boolean>
  rollbackProfile: (routeId: string) => Promise<boolean>
  resetHealth: () => Promise<void>
}

let dashboardRequestId = 0
let mutationVersion = 0
let pendingSaves = 0
let saveQueue: Promise<void> = Promise.resolve()
const draftRevisions = new Map<string, number>()

function enqueueRoutingMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const operation = saveQueue.then(mutation)
  saveQueue = operation.then(() => undefined, () => undefined)
  return operation
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function mergeConfigWithNewerDrafts(
  incoming: RoutingConfig,
  local?: RoutingConfig,
): RoutingConfig {
  if (!local) return incoming
  const localById = new Map(local.profiles.map((profile) => [profile.id, profile]))
  return {
    ...incoming,
    profiles: incoming.profiles.map((profile) => {
      const localProfile = localById.get(profile.id)
      if (!localProfile?.draftGraph) return profile
      const incomingRevision = profile.draftRevision ?? 0
      const localRevision = localProfile.draftRevision ?? 0
      if (localRevision <= incomingRevision) return profile
      return {
        ...profile,
        draftName: localProfile.draftName,
        draftGraph: cloneRouteGraph(localProfile.draftGraph),
        draftRevision: localRevision,
      }
    }),
  }
}

function replaceProfile(
  dashboard: RoutingDashboard,
  profile: RouteProfile,
): RoutingDashboard {
  const exists = dashboard.config.profiles.some((entry) => entry.id === profile.id)
  return {
    ...dashboard,
    config: {
      ...dashboard.config,
      profiles: exists
        ? dashboard.config.profiles.map((entry) => entry.id === profile.id ? profile : entry)
        : [...dashboard.config.profiles, profile],
    },
  }
}

export const useRoutingStore = create<RoutingStore>((set, get) => {
  const persistConfig = async (
    config: RoutingConfig,
    options: { preserveOptimisticOnError?: boolean } = {},
  ) => {
    const operationVersion = ++mutationVersion
    dashboardRequestId += 1
    const previous = get().dashboard
    pendingSaves += 1
    set({
      dashboard: previous ? { ...previous, config } : previous,
      isLoading: false,
      isSaving: true,
      error: null,
    })

    const operation = enqueueRoutingMutation(async () => {
      try {
        const result = await routingApi.updateConfig(config)
        if (operationVersion !== mutationVersion) return
        const localConfig = get().dashboard?.config
        const mergedConfig = mergeConfigWithNewerDrafts(result.config, localConfig)
        try {
          const dashboard = await routingApi.dashboard()
          if (operationVersion !== mutationVersion) return
          set({
            dashboard: {
              ...dashboard,
              config: mergeConfigWithNewerDrafts(dashboard.config, get().dashboard?.config),
            },
            error: null,
          })
        } catch (error) {
          if (operationVersion !== mutationVersion) return
          const current = get().dashboard
          set({
            dashboard: current ? { ...current, config: mergedConfig } : current,
            error: errorMessage(error),
          })
        }
      } catch (error) {
        if (operationVersion !== mutationVersion) return
        set({
          dashboard: options.preserveOptimisticOnError ? get().dashboard : previous,
          error: errorMessage(error),
        })
      } finally {
        pendingSaves = Math.max(0, pendingSaves - 1)
        set({ isSaving: pendingSaves > 0 })
      }
    })
    await operation
  }

  return {
    dashboard: null,
    previews: {},
    isLoading: false,
    isSaving: false,
    isPreviewing: false,
    isPublishing: false,
    error: null,

    fetchDashboard: async (options) => {
      if (get().isSaving) return
      const requestId = ++dashboardRequestId
      const requestMutationVersion = mutationVersion
      if (!options?.quiet) set({ isLoading: true, error: null })
      try {
        const dashboard = await routingApi.dashboard()
        if (
          requestId !== dashboardRequestId ||
          requestMutationVersion !== mutationVersion ||
          get().isSaving
        ) return
        set({
          dashboard: {
            ...dashboard,
            config: mergeConfigWithNewerDrafts(dashboard.config, get().dashboard?.config),
          },
          isLoading: false,
          error: null,
        })
      } catch (error) {
        if (
          requestId !== dashboardRequestId ||
          requestMutationVersion !== mutationVersion ||
          get().isSaving
        ) return
        set({ isLoading: false, error: errorMessage(error) })
      }
    },

    updateConfig: async (config) => {
      await persistConfig(config)
    },

    updateProfile: async (profile) => {
      const config = get().dashboard?.config
      if (!config) return
      await persistConfig({
        ...config,
        profiles: config.profiles.map((entry) => entry.id === profile.id ? profile : entry),
      })
    },

    updateProfileDraft: async (routeId, graph, options) => {
      const config = get().dashboard?.config
      const existing = config?.profiles.find((profile) => profile.id === routeId)
      if (!config || !existing) return
      const revision = Math.max(
        draftRevisions.get(routeId) ?? 0,
        existing.draftRevision ?? 0,
      ) + 1
      draftRevisions.set(routeId, revision)
      const profile: RouteProfile = {
        ...existing,
        draftName: options?.name ?? existing.draftName ?? existing.name,
        draftGraph: cloneRouteGraph(graph),
        draftRevision: revision,
      }
      await persistConfig({
        ...config,
        profiles: config.profiles.map((entry) => entry.id === routeId ? profile : entry),
      }, { preserveOptimisticOnError: true })
    },

    previewProfile: async (routeId, graph) => {
      set({ isPreviewing: true, error: null })
      try {
        const preview = await routingApi.preview(routeId, graph)
        set((state) => ({
          previews: { ...state.previews, [routeId]: preview },
          isPreviewing: false,
          error: null,
        }))
        return preview
      } catch (error) {
        set({ isPreviewing: false, error: errorMessage(error) })
        return null
      }
    },

    publishProfile: async (routeId, graph, name) => {
      set({ isPublishing: true, error: null })
      try {
        const result = await enqueueRoutingMutation(
          () => routingApi.publish(routeId, graph, name),
        )
        if (!result.validation.valid) {
          set((state) => ({
            previews: {
              ...state.previews,
              [routeId]: {
                validation: result.validation,
                path: [],
              },
            },
            isPublishing: false,
          }))
          return false
        }
        const current = get().dashboard
        if (current) set({ dashboard: replaceProfile(current, result.profile) })
        draftRevisions.delete(routeId)
        set({ isPublishing: false, error: null })
        return true
      } catch (error) {
        set({ isPublishing: false, error: errorMessage(error) })
        return false
      }
    },

    rollbackProfile: async (routeId) => {
      set({ isPublishing: true, error: null })
      try {
        const result = await enqueueRoutingMutation(() => routingApi.rollback(routeId))
        const current = get().dashboard
        if (current) set({ dashboard: replaceProfile(current, result.profile) })
        set({ isPublishing: false, error: null })
        return true
      } catch (error) {
        set({ isPublishing: false, error: errorMessage(error) })
        return false
      }
    },

    resetHealth: async () => {
      if (get().isSaving) return
      mutationVersion += 1
      dashboardRequestId += 1
      const previous = get().dashboard
      if (previous) {
        set({
          dashboard: { ...previous, health: [], events: [] },
          isLoading: false,
          isSaving: true,
          error: null,
        })
      } else {
        set({ isLoading: false, isSaving: true, error: null })
      }
      try {
        await routingApi.resetHealth()
        try {
          const dashboard = await routingApi.dashboard()
          set({ dashboard, isSaving: false, error: null })
        } catch (error) {
          set({ isSaving: false, error: errorMessage(error) })
        }
      } catch (error) {
        set({ dashboard: previous, isSaving: false, error: errorMessage(error) })
      }
    },
  }
})
