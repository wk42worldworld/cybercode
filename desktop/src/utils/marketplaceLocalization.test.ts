import { describe, expect, it } from 'vitest'

import {
  marketplaceCategoryKey,
  marketplaceCategoryLabel,
  marketplaceDescription,
  marketplaceFeatureLabel,
  marketplaceSourceLabel,
  sortMarketplaceItems,
} from './marketplaceLocalization'

const item = {
  displayName: 'React Best Practices',
  description: 'Guidelines for building fast React applications.',
  sourceName: 'Vercel Agent Skills',
}

describe('marketplace localization', () => {
  it('keeps the original description in its matching language', () => {
    expect(marketplaceDescription(item, 'en', 'skill')).toBe(item.description)
    expect(marketplaceDescription({
      ...item,
      description: 'React 应用性能优化指南。',
    }, 'zh', 'skill')).toBe('React 应用性能优化指南。')
  })

  it('prefers exact marketplace translations', () => {
    expect(marketplaceDescription({
      ...item,
      localizedDescriptions: { ja: '高速な React アプリを構築するためのガイドです。' },
    }, 'ja', 'skill')).toBe('高速な React アプリを構築するためのガイドです。')
  })

  it('uses a localized functional summary instead of leaking English', () => {
    const description = marketplaceDescription(item, 'zh', 'skill')
    expect(description).toContain('用于处理')
    expect(description).toContain('React Best Practices')
    expect(description).not.toContain(item.description)

    expect(marketplaceDescription(item, 'ko', 'plugin', ['skills', 'mcpServers']))
      .toContain('스킬, MCP 서버')
    expect(marketplaceFeatureLabel('commands', 'ja')).toBe('コマンド')
  })

  it('keeps empty and mixed-language descriptions in the selected locale', () => {
    expect(marketplaceDescription({ ...item, description: '' }, 'en', 'skill'))
      .toContain('A skill for tasks related to')
    expect(marketplaceDescription({
      ...item,
      description: 'Tools for 中文 projects and React applications.',
    }, 'zh', 'skill')).toContain('用于处理')
  })

  it('localizes marketplace categories and official source labels', () => {
    expect(marketplaceCategoryLabel('Developer Tools', 'zh')).toBe('开发工具')
    expect(marketplaceCategoryLabel('security', 'ja')).toBe('セキュリティ')
    expect(marketplaceCategoryLabel('Productivity', 'ko')).toBe('생산성')
    expect(marketplaceCategoryLabel('web-development / research', 'zh'))
      .toBe('Web 开发 / 研究')
    expect(marketplaceCategoryLabel('autonomous-ai-agents', 'zh')).toBe('自主智能体')
    expect(marketplaceCategoryLabel('software-development', 'zh')).toBe('软件开发')
    expect(marketplaceCategoryLabel('mlops / inference', 'zh')).toBe('MLOps / 推理')
    expect(marketplaceCategoryKey('  Developer   Tools ')).toBe('developer tools')
    expect(marketplaceCategoryLabel('future-category', 'zh')).toBe('Future Category')
    expect(marketplaceSourceLabel('Anthropic Official', 'zh')).toBe('Anthropic 官方')
    expect(marketplaceSourceLabel('Codex Official', 'ja')).toBe('Codex 公式')
  })

  it('sorts by real market signals and keeps a stable fallback order', () => {
    const items = [
      { displayName: 'Stable', version: '1.0.0', popularity: 10, updatedAt: '2026-01-01' },
      { displayName: 'Newest', version: '2.0.0', popularity: 2, updatedAt: '2026-07-01' },
      { displayName: 'Popular', version: '1.5.0', popularity: 50, updatedAt: '2026-03-01' },
    ]

    expect(sortMarketplaceItems(items, 'newest', 'en').map((entry) => entry.displayName))
      .toEqual(['Newest', 'Popular', 'Stable'])
    expect(sortMarketplaceItems(items, 'popular', 'en').map((entry) => entry.displayName))
      .toEqual(['Popular', 'Stable', 'Newest'])
    expect(sortMarketplaceItems(items, 'recommended', 'en')).toEqual(items)
  })
})
