import { describe, expect, it } from 'vitest'
import gatewayNodeRaw from '../components/providers/GatewayNodePanel.tsx?raw'
import mediaCatalogRaw from '../components/providers/MediaProviderCatalog.tsx?raw'
import oauthCatalogRaw from '../components/providers/OAuthProviderCatalog.tsx?raw'
import filterBarRaw from '../components/providers/ProviderCatalogFilterBar.tsx?raw'
import routingPanelsRaw from '../components/providers/RoutingPanels.tsx?raw'
import webSessionCatalogRaw from '../components/providers/WebSessionProviderCatalog.tsx?raw'
import settingsRaw from '../pages/Settings.tsx?raw'
import desktopStylesRaw from '../theme/globals.css?raw'

describe('provider workspace responsive layout', () => {
  it('uses the settings drawer as the responsive container', () => {
    expect(desktopStylesRaw).toContain('container-name: settings-content')
    expect(desktopStylesRaw).toContain('@container settings-content (min-width: 960px)')
    expect(desktopStylesRaw).toContain('@container settings-content (max-width: 520px)')
    expect(settingsRaw).not.toContain('lg:grid-cols-[200px_minmax(0,1fr)]')
    expect(settingsRaw).not.toContain('lg:flex lg:flex-col')
    expect(desktopStylesRaw).not.toMatch(
      /\.provider-settings-nav\s*\{[^}]*overflow-x:\s*auto/s,
    )
  })

  it('keeps navigation and catalogs fluid without viewport grid breakpoints', () => {
    expect(desktopStylesRaw).toContain(
      'grid-template-columns: repeat(auto-fit, minmax(min(230px, 100%), 1fr))',
    )
    expect(desktopStylesRaw).toContain(
      '@container settings-content (min-width: 760px) {\n  .provider-catalog-grid {\n    grid-template-columns: repeat(4, minmax(0, 1fr));',
    )
    expect(desktopStylesRaw).toContain(
      '.provider-settings-nav {\n    grid-template-columns: repeat(2, minmax(0, 1fr));',
    )

    for (const source of [
      settingsRaw,
      oauthCatalogRaw,
      webSessionCatalogRaw,
      mediaCatalogRaw,
    ]) {
      expect(source).toContain('provider-catalog-grid')
      expect(source).not.toContain(
        'grid-cols-1 gap-[9px] sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4',
      )
    }
  })

  it('wraps the catalog toolbar using its available width', () => {
    expect(filterBarRaw).toContain('provider-catalog-toolbar')
    expect(filterBarRaw).toContain('provider-catalog-toolbar-search')
    expect(filterBarRaw).toContain('provider-catalog-toolbar-actions')
    expect(filterBarRaw).toContain('provider-catalog-filter-popover')
    expect(desktopStylesRaw).toContain('.provider-catalog-filter-popover {\n    width: 100%;')
    expect(desktopStylesRaw).toContain('max-height: min(440px, calc(100dvh - 280px))')
    expect(filterBarRaw).not.toContain('lg:grid-cols-[1fr_minmax(320px,56%)_1fr]')
  })

  it('switches routing and node tables at panel-level breakpoints', () => {
    expect(routingPanelsRaw).toContain('routing-route-layout')
    expect(routingPanelsRaw).toContain('routing-metrics-grid')
    expect(gatewayNodeRaw).toContain('gateway-key-table-row')
    expect(gatewayNodeRaw).toContain('gateway-target-policy-primary')
    expect(gatewayNodeRaw).toContain('gateway-connection-builder-controls')
    expect(desktopStylesRaw).toContain('@container settings-content (min-width: 700px)')
    expect(desktopStylesRaw).toContain('@container settings-content (min-width: 740px)')
  })
})
