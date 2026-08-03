import { describe, expect, test } from 'bun:test'
import {
  buildRouteGraphTemplate,
  ROUTE_GRAPH_TEMPLATE_IDS,
} from '../../../desktop/src/utils/routeGraph.ts'
import { serializeRouteGraph } from '../../../desktop/src/api/routingWire.ts'
import { validateRouteGraph } from '../routing/graphService.js'
import { RouteGraphSchema } from '../routing/types.js'

const source = {
  id: 'provider-a',
  providerId: 'provider-a',
  presetId: 'custom',
  name: 'Provider A',
  configured: true,
  routable: true,
  cost: 'paid' as const,
  auth: 'api-key' as const,
  risk: 'stable' as const,
  models: [{ id: 'model-a' }, { id: 'model-b' }],
}

describe('desktop route graph wire contract', () => {
  test('every built-in desktop template parses and validates on the server', () => {
    for (const templateId of ROUTE_GRAPH_TEMPLATE_IDS) {
      const desktopGraph = buildRouteGraphTemplate(templateId, [source])
      const serverGraph = RouteGraphSchema.parse(serializeRouteGraph(desktopGraph))
      const validation = validateRouteGraph(serverGraph)

      expect(validation.issues, templateId).toEqual([])
      expect(validation.valid, templateId).toBe(true)
    }
  })
})
