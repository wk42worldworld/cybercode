import { beforeEach, describe, expect, test } from 'bun:test'
import {
  clearLocalWebSearchCache,
  filterSearchResultsByDomain,
  getGitHubTrendingPeriod,
  normalizeSearchResultUrl,
  parseBaiduSearchResults,
  parseBingSearchResults,
  parseBraveSearchResults,
  parseDuckDuckGoSearchResults,
  parseGitHubTrendingResults,
  searchLocalWeb,
  type LocalWebSearchHit,
} from './localWebSearch.js'

function hit(
  engine: LocalWebSearchHit['engine'],
  url: string,
  title = 'Result',
): LocalWebSearchHit {
  return {
    title,
    url,
    description: 'A useful result',
    source: new URL(url).hostname,
    engine,
  }
}

beforeEach(() => {
  clearLocalWebSearchCache()
})

describe('search result parsers', () => {
  test('parses Brave result cards', () => {
    const results = parseBraveSearchResults(
      `<main><div id="results"><div class="snippet"><div class="result-content">
        <a href="https://example.com/brave?utm_source=search">
          <span class="site-name-wrapper">example.com</span>
          <div class="search-snippet-title">Brave result</div>
        </a>
        <div class="generic-snippet">Brave description</div>
      </div></div></div></main>`,
      5,
    )

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      title: 'Brave result',
      url: 'https://example.com/brave',
      description: 'Brave description',
      engine: 'brave',
    })
  })

  test('parses and unwraps Bing redirect links', () => {
    const target = 'https://example.org/bing'
    const encoded = Buffer.from(target).toString('base64url')
    const results = parseBingSearchResults(
      `<ol id="b_results"><li class="b_algo">
        <h2><a href="https://www.bing.com/ck/a?u=a1${encoded}">Bing result</a></h2>
        <div class="b_caption"><p>Bing description</p></div>
      </li></ol>`,
      5,
    )

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      title: 'Bing result',
      url: target,
      description: 'Bing description',
      engine: 'bing',
    })
  })

  test('parses and unwraps DuckDuckGo result links', () => {
    const target = 'https://docs.example.dev/duck'
    const results = parseDuckDuckGoSearchResults(
      `<div class="result">
        <h2><a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(target)}">Duck result</a></h2>
        <div class="result__snippet">Duck description</div>
      </div>`,
      5,
    )

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      title: 'Duck result',
      url: target,
      description: 'Duck description',
      engine: 'duckduckgo',
    })
  })

  test('prefers Baidu landing URLs when present', () => {
    const results = parseBaiduSearchResults(
      `<div id="content_left"><div class="result c-container" mu="https://example.cn/baidu">
        <h3><a href="https://www.baidu.com/link?url=redirect">百度结果</a></h3>
        <div class="c-abstract">百度摘要</div>
      </div></div>`,
      5,
    )

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      title: '百度结果',
      url: 'https://example.cn/baidu',
      description: '百度摘要',
      engine: 'baidu',
    })
  })

  test('parses GitHub Trending cards in official rank order', () => {
    const results = parseGitHubTrendingResults(
      `<article class="Box-row">
        <h2><a href="/example/first">example / first</a></h2>
        <p>First repository</p>
        <span itemprop="programmingLanguage">TypeScript</span>
        <a href="/example/first/stargazers">12,345</a>
        <a href="/example/first/forks">678</a>
        <span class="float-sm-right">900 stars today</span>
      </article>
      <article class="Box-row">
        <h2><a href="/example/second">example / second</a></h2>
        <p>Second repository</p>
        <span class="float-sm-right">400 stars today</span>
      </article>`,
      10,
    )

    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({
      title: 'example/first',
      url: 'https://github.com/example/first',
      source: 'GitHub Trending',
      engine: 'github',
    })
    expect(results[0]?.description).toBe('First repository')
    expect(results[0]?.metadata).toEqual({
      rank: 1,
      language: 'TypeScript',
      totalStars: '12,345',
      forks: '678',
      trendingStars: '900',
      trendingPeriod: 'today',
    })
    expect(results[1]?.metadata).toMatchObject({
      rank: 2,
      trendingStars: '400',
      trendingPeriod: 'today',
    })
  })
})

describe('local web search orchestration', () => {
  test('recognizes current GitHub Trending requests but not historical dates', () => {
    expect(getGitHubTrendingPeriod('github 今天的趋势榜')).toBe('daily')
    expect(getGitHubTrendingPeriod('GitHub Trending weekly')).toBe('weekly')
    expect(getGitHubTrendingPeriod('GitHub Trending monthly')).toBe('monthly')
    expect(getGitHubTrendingPeriod('GitHub Trending 2020-01-01')).toBeNull()
  })

  test('uses the official GitHub Trending source before search engines', async () => {
    let searchEngineCalls = 0
    const response = await searchLocalWeb(
      { query: 'github 今天的趋势榜', maxResults: 10 },
      {
        githubTrending: async period => ({
          results: [
            hit('github', 'https://github.com/example/current', 'example/current'),
          ],
          url: `https://github.com/trending?since=${period}`,
          fetchedAt: '2026-07-10T14:30:00.000Z',
          date: '2026-07-10',
          period,
        }),
        engineWaves: [['brave']],
        engines: {
          brave: async () => {
            searchEngineCalls += 1
            return []
          },
        },
      },
    )

    expect(searchEngineCalls).toBe(0)
    expect(response.engines).toEqual(['github'])
    expect(response.results.map(result => result.title)).toEqual([
      'example/current',
    ])
    expect(response.liveSource).toMatchObject({
      type: 'github_trending',
      period: 'daily',
      date: '2026-07-10',
    })
  })

  test('filters allowed and blocked domains including subdomains', () => {
    const results = filterSearchResultsByDomain(
      [
        hit('bing', 'https://docs.example.com/guide'),
        hit('bing', 'https://example.com/private'),
        hit('bing', 'https://other.example.net/'),
      ],
      ['example.com'],
      ['example.com/private'],
    )

    expect(results.map(result => result.url)).toEqual([
      'https://docs.example.com/guide',
    ])
  })

  test('uses a second engine wave when the first has no allowed results', async () => {
    const calls: string[] = []
    const response = await searchLocalWeb(
      {
        query: 'current docs',
        maxResults: 3,
        allowedDomains: ['example.com'],
      },
      {
        engineWaves: [['brave'], ['bing']],
        engines: {
          brave: async query => {
            calls.push(`brave:${query}`)
            return [hit('brave', 'https://blocked.example.net/result')]
          },
          bing: async query => {
            calls.push(`bing:${query}`)
            return [hit('bing', 'https://docs.example.com/current')]
          },
        },
      },
    )

    expect(calls).toEqual([
      'brave:current docs (site:example.com)',
      'bing:current docs (site:example.com)',
    ])
    expect(response.results.map(result => result.url)).toEqual([
      'https://docs.example.com/current',
    ])
    expect(response.engines).toEqual(['brave', 'bing'])
  })

  test('records engine failures instead of fabricating results', async () => {
    const response = await searchLocalWeb(
      { query: 'anything' },
      {
        engineWaves: [['brave']],
        engines: {
          brave: async () => {
            throw new Error('captcha at https://search.example/path')
          },
        },
      },
    )

    expect(response.results).toEqual([])
    expect(response.failures).toEqual([
      {
        engine: 'brave',
        message: 'captcha at [search endpoint]',
      },
    ])
  })

  test('rejects search-engine navigation pages', () => {
    expect(
      normalizeSearchResultUrl('https://www.bing.com/search?q=internal'),
    ).toBe('')
    expect(normalizeSearchResultUrl('javascript:alert(1)')).toBe('')
  })
})
