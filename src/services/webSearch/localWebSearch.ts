/*
 * Search-engine adapters in this file are adapted from Open-WebSearch:
 * https://github.com/Aas-ee/open-webSearch
 * Copyright 2025 Open-WebSearch MCP Server Contributors, Apache-2.0.
 * See LICENSE-open-websearch.txt in this directory.
 */

import type { AxiosInstance } from 'axios'
import { Buffer } from 'node:buffer'
import * as cheerio from 'cheerio'
import { getLocalISODate } from '../../constants/common.js'
import { createAxiosInstance } from '../../utils/proxy.js'

export type LocalWebSearchEngine =
  | 'baidu'
  | 'bing'
  | 'brave'
  | 'duckduckgo'
  | 'github'

type GeneralWebSearchEngine = Exclude<LocalWebSearchEngine, 'github'>

export type LocalWebSearchHit = {
  title: string
  url: string
  description: string
  source: string
  engine: LocalWebSearchEngine
  metadata?: Record<string, string | number | boolean>
}

export type LocalWebSearchFailure = {
  engine: LocalWebSearchEngine
  message: string
}

export type LocalWebSearchResponse = {
  query: string
  engines: LocalWebSearchEngine[]
  results: LocalWebSearchHit[]
  failures: LocalWebSearchFailure[]
  liveSource?: {
    type: 'github_trending'
    url: string
    fetchedAt: string
    date: string
    period: GitHubTrendingPeriod
  }
}

export type LocalWebSearchOptions = {
  query: string
  maxResults?: number
  allowedDomains?: string[]
  blockedDomains?: string[]
  signal?: AbortSignal
}

type SearchEngineExecutor = (
  query: string,
  limit: number,
  signal?: AbortSignal,
) => Promise<LocalWebSearchHit[]>

export type GitHubTrendingPeriod = 'daily' | 'weekly' | 'monthly'

type GitHubTrendingFetchResult = {
  results: LocalWebSearchHit[]
  url: string
  fetchedAt: string
  date: string
  period: GitHubTrendingPeriod
}

type GitHubTrendingExecutor = (
  period: GitHubTrendingPeriod,
  limit: number,
  signal?: AbortSignal,
) => Promise<GitHubTrendingFetchResult>

export type LocalWebSearchDependencies = {
  engines?: Partial<Record<GeneralWebSearchEngine, SearchEngineExecutor>>
  engineWaves?: GeneralWebSearchEngine[][]
  githubTrending?: GitHubTrendingExecutor
}

const SEARCH_TIMEOUT_MS = 12_000
const SEARCH_PAGE_MAX_BYTES = 3 * 1024 * 1024
const CACHE_TTL_MS = 5 * 60 * 1000
const CACHE_MAX_ENTRIES = 100
const MAX_RESULTS = 10
const GITHUB_TRENDING_BASE_URL = 'https://github.com/trending'

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
}

const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'ref',
  'source',
])

const cache = new Map<
  string,
  { expiresAt: number; response: LocalWebSearchResponse }
>()

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function decodeBingRedirectTarget(url: URL): string {
  const encodedTarget = url.searchParams.get('u')?.trim()
  if (!encodedTarget) return ''

  const payload = encodedTarget.startsWith('a1')
    ? encodedTarget.slice(2)
    : encodedTarget
  try {
    const decoded = Buffer.from(payload, 'base64url').toString('utf8').trim()
    return /^https?:\/\//i.test(decoded) ? decoded : ''
  } catch {
    return ''
  }
}

function unwrapSearchRedirect(url: URL): string {
  const hostname = url.hostname.toLowerCase()

  if (
    (hostname === 'duckduckgo.com' ||
      hostname.endsWith('.duckduckgo.com')) &&
    url.pathname === '/l/'
  ) {
    return url.searchParams.get('uddg') ?? ''
  }

  if (
    (hostname === 'bing.com' || hostname.endsWith('.bing.com')) &&
    url.pathname.toLowerCase().startsWith('/ck/a')
  ) {
    return decodeBingRedirectTarget(url)
  }

  return ''
}

function isSearchEngineNavigation(url: URL): boolean {
  const hostname = url.hostname.toLowerCase()
  const path = url.pathname.toLowerCase()

  if (
    (hostname === 'bing.com' || hostname.endsWith('.bing.com')) &&
    (path.startsWith('/search') || path.startsWith('/newtabredir'))
  ) {
    return true
  }

  if (
    (hostname === 'duckduckgo.com' ||
      hostname.endsWith('.duckduckgo.com')) &&
    path !== '/l/'
  ) {
    return true
  }

  if (hostname === 'search.brave.com' && path.startsWith('/search')) {
    return true
  }

  if (
    (hostname === 'baidu.com' || hostname.endsWith('.baidu.com')) &&
    path === '/s'
  ) {
    return true
  }

  return false
}

export function normalizeSearchResultUrl(
  rawUrl: string | undefined,
  baseUrl?: string,
): string {
  if (!rawUrl?.trim()) return ''

  try {
    let parsed = new URL(rawUrl.trim(), baseUrl)
    const redirectTarget = unwrapSearchRedirect(parsed)
    if (redirectTarget) parsed = new URL(redirectTarget)

    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.username ||
      parsed.password ||
      isSearchEngineNavigation(parsed)
    ) {
      return ''
    }

    parsed.hash = ''
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_') || TRACKING_PARAMS.has(key)) {
        parsed.searchParams.delete(key)
      }
    }

    return parsed.toString()
  } catch {
    return ''
  }
}

function sourceFromUrl(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

function makeHit(
  engine: LocalWebSearchEngine,
  rawUrl: string | undefined,
  title: string,
  description: string,
  source: string,
  baseUrl?: string,
): LocalWebSearchHit | null {
  const url = normalizeSearchResultUrl(rawUrl, baseUrl)
  const normalizedTitle = normalizeWhitespace(title).slice(0, 300)
  if (!url || !normalizedTitle) return null

  return {
    title: normalizedTitle,
    url,
    description: normalizeWhitespace(description).slice(0, 1_000),
    source: normalizeWhitespace(source).slice(0, 300) || sourceFromUrl(url),
    engine,
  }
}

export function parseBraveSearchResults(
  html: string,
  limit: number,
): LocalWebSearchHit[] {
  const $ = cheerio.load(html)
  const results: LocalWebSearchHit[] = []

  $('#results .snippet, #results .result, main .snippet').each((_, node) => {
    if (results.length >= limit) return false

    const card = $(node)
    const content = card.find('.result-content').first().length
      ? card.find('.result-content').first()
      : card
    const link = content
      .find('> a[href], a[href] .search-snippet-title')
      .first()
    const anchor = link.is('a') ? link : link.closest('a')
    const hit = makeHit(
      'brave',
      anchor.attr('href'),
      anchor.find('.search-snippet-title').text() ||
        content.find('.search-snippet-title').first().text() ||
        anchor.text(),
      content.find('.generic-snippet, .snippet-description').first().text(),
      anchor.find('.site-name-wrapper').first().text(),
      'https://search.brave.com/',
    )
    if (hit) results.push(hit)
  })

  return results
}

export function parseBingSearchResults(
  html: string,
  limit: number,
): LocalWebSearchHit[] {
  const $ = cheerio.load(html)
  const results: LocalWebSearchHit[] = []
  const seen = new Set<string>()

  $('#b_results > li.b_algo, #b_results .b_algo, #b_topw .b_algo').each(
    (_, node) => {
      if (results.length >= limit) return false

      const card = $(node)
      if (card.hasClass('b_ad') || card.closest('.b_ad').length) return
      const link = card.find('h2 a[href], a.tilk[href], .b_title a[href]').first()
      const hit = makeHit(
        'bing',
        link.attr('href') || link.attr('data-h'),
        link.text() || card.find('h2, .tptt').first().text(),
        card.find('.b_caption p, .b_snippet').first().text(),
        card.find('cite, .b_attribution, .b_tpcn').first().text(),
        'https://www.bing.com/',
      )
      if (!hit || seen.has(hit.url)) return
      seen.add(hit.url)
      results.push(hit)
    },
  )

  return results
}

export function parseDuckDuckGoSearchResults(
  html: string,
  limit: number,
): LocalWebSearchHit[] {
  const $ = cheerio.load(html)
  const results: LocalWebSearchHit[] = []

  $('div.result, .web-result').each((_, node) => {
    if (results.length >= limit) return false

    const card = $(node)
    if (card.hasClass('result--ad')) return
    const link = card.find('a.result__a[href], h2 a[href]').first()
    const hit = makeHit(
      'duckduckgo',
      link.attr('href'),
      link.text(),
      card.find('.result__snippet').first().text(),
      card.find('.result__url').first().text(),
      'https://html.duckduckgo.com/',
    )
    if (hit) results.push(hit)
  })

  return results
}

export function parseBaiduSearchResults(
  html: string,
  limit: number,
): LocalWebSearchHit[] {
  const $ = cheerio.load(html)
  const results: LocalWebSearchHit[] = []
  const seen = new Set<string>()

  $('#content_left .result, #content_left .c-container, #content_left > div').each(
    (_, node) => {
      if (results.length >= limit) return false

      const card = $(node)
      const link = card.find('h3 a[href], h2 a[href]').first()
      const hit = makeHit(
        'baidu',
        card.attr('mu') || link.attr('data-landurl') || link.attr('href'),
        link.text() || card.find('h3, h2').first().text(),
        card
          .find('.c-abstract, .content-right_8Zs40, .cos-row, [class*="abstract"]')
          .first()
          .text(),
        card.find('.c-showurl, .cosc-source, .c-color-gray').first().text(),
        'https://www.baidu.com/',
      )
      if (!hit || seen.has(hit.url)) return
      seen.add(hit.url)
      results.push(hit)
    },
  )

  return results
}

export function parseGitHubTrendingResults(
  html: string,
  limit: number,
): LocalWebSearchHit[] {
  const $ = cheerio.load(html)
  const results: LocalWebSearchHit[] = []

  $('article.Box-row').each((_, node) => {
    if (results.length >= limit) return false

    const card = $(node)
    const link = card.find('h2 a[href]').first()
    const path = link.attr('href')?.trim() ?? ''
    const pathParts = path.split('/').filter(Boolean)
    if (pathParts.length !== 2) return

    const repository = `${pathParts[0]}/${pathParts[1]}`
    const url = normalizeSearchResultUrl(path, 'https://github.com/')
    if (!url) return

    const description = normalizeWhitespace(card.find('p').first().text())
    const language = normalizeWhitespace(
      card.find('[itemprop="programmingLanguage"]').first().text(),
    )
    const totalStars = normalizeWhitespace(
      card.find('a[href$="/stargazers"]').first().text(),
    )
    const forks = normalizeWhitespace(
      card.find('a[href$="/forks"]').first().text(),
    )
    const periodStars = normalizeWhitespace(
      card.find('.float-sm-right').first().text(),
    )
    const trendingStars = periodStars.match(/[\d,]+/)?.[0] ?? ''
    const trendingPeriod = /this month/i.test(periodStars)
      ? 'month'
      : /this week/i.test(periodStars)
        ? 'week'
        : 'today'

    results.push({
      title: repository,
      url,
      description: description.slice(0, 1_000),
      source: 'GitHub Trending',
      engine: 'github',
      metadata: {
        rank: results.length + 1,
        ...(language ? { language } : {}),
        ...(totalStars ? { totalStars } : {}),
        ...(forks ? { forks } : {}),
        ...(trendingStars ? { trendingStars } : {}),
        trendingPeriod,
      },
    })
  })

  return results
}

function requestConfig(signal?: AbortSignal) {
  return {
    headers: BROWSER_HEADERS,
    maxContentLength: SEARCH_PAGE_MAX_BYTES,
    maxRedirects: 4,
    responseType: 'text' as const,
    signal,
    timeout: SEARCH_TIMEOUT_MS,
  }
}

function githubTrendingUrl(period: GitHubTrendingPeriod): string {
  return `${GITHUB_TRENDING_BASE_URL}?since=${period}`
}

async function fetchGitHubTrending(
  http: AxiosInstance,
  period: GitHubTrendingPeriod,
  limit: number,
  signal?: AbortSignal,
): Promise<GitHubTrendingFetchResult> {
  const url = githubTrendingUrl(period)
  const response = await http.get(url, requestConfig(signal))
  const results = parseGitHubTrendingResults(String(response.data ?? ''), limit)
  if (results.length === 0) {
    throw new Error('GitHub Trending returned no repository entries')
  }

  return {
    results,
    url,
    fetchedAt: new Date().toISOString(),
    date: getLocalISODate(),
    period,
  }
}

async function searchBrave(
  http: AxiosInstance,
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<LocalWebSearchHit[]> {
  const response = await http.get('https://search.brave.com/search', {
    ...requestConfig(signal),
    params: { q: query, source: 'web' },
  })
  return parseBraveSearchResults(String(response.data ?? ''), limit)
}

async function searchBing(
  http: AxiosInstance,
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<LocalWebSearchHit[]> {
  const response = await http.get('https://cn.bing.com/search', {
    ...requestConfig(signal),
    params: {
      count: Math.max(10, limit),
      ensearch: '0',
      q: query,
      setlang: 'zh-CN',
    },
  })
  return parseBingSearchResults(String(response.data ?? ''), limit)
}

async function searchDuckDuckGo(
  http: AxiosInstance,
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<LocalWebSearchHit[]> {
  const response = await http.post(
    'https://html.duckduckgo.com/html/',
    new URLSearchParams({ q: query }).toString(),
    {
      ...requestConfig(signal),
      headers: {
        ...BROWSER_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'https://html.duckduckgo.com',
        Referer: 'https://html.duckduckgo.com/',
      },
    },
  )
  return parseDuckDuckGoSearchResults(String(response.data ?? ''), limit)
}

async function searchBaidu(
  http: AxiosInstance,
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<LocalWebSearchHit[]> {
  const response = await http.get('https://www.baidu.com/s', {
    ...requestConfig(signal),
    params: { ie: 'utf-8', wd: query },
  })
  return parseBaiduSearchResults(String(response.data ?? ''), limit)
}

function createDefaultEngines(
  http: AxiosInstance = createAxiosInstance(),
): Record<
  GeneralWebSearchEngine,
  SearchEngineExecutor
> {
  return {
    baidu: (query, limit, signal) => searchBaidu(http, query, limit, signal),
    bing: (query, limit, signal) => searchBing(http, query, limit, signal),
    brave: (query, limit, signal) => searchBrave(http, query, limit, signal),
    duckduckgo: (query, limit, signal) =>
      searchDuckDuckGo(http, query, limit, signal),
  }
}

type DomainRule = {
  hostname: string
  path: string
}

function parseDomainRule(value: string): DomainRule | null {
  try {
    const parsed = new URL(
      value.includes('://') ? value : `https://${value.replace(/^\.+/, '')}`,
    )
    return {
      hostname: parsed.hostname.toLowerCase(),
      path: parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, ''),
    }
  } catch {
    return null
  }
}

function matchesDomainRule(url: URL, rule: DomainRule): boolean {
  const hostname = url.hostname.toLowerCase()
  const hostMatches =
    hostname === rule.hostname || hostname.endsWith(`.${rule.hostname}`)
  return hostMatches && (!rule.path || url.pathname.startsWith(rule.path))
}

export function filterSearchResultsByDomain(
  results: LocalWebSearchHit[],
  allowedDomains: string[] = [],
  blockedDomains: string[] = [],
): LocalWebSearchHit[] {
  const allowed = allowedDomains
    .map(parseDomainRule)
    .filter((rule): rule is DomainRule => rule !== null)
  const blocked = blockedDomains
    .map(parseDomainRule)
    .filter((rule): rule is DomainRule => rule !== null)

  return results.filter(result => {
    try {
      const url = new URL(result.url)
      if (blocked.some(rule => matchesDomainRule(url, rule))) return false
      return allowed.length === 0 || allowed.some(rule => matchesDomainRule(url, rule))
    } catch {
      return false
    }
  })
}

function dedupeResults(results: LocalWebSearchHit[]): LocalWebSearchHit[] {
  const seen = new Set<string>()
  return results.filter(result => {
    const key = result.url.replace(/\/$/, '')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function hasCjkText(value: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff]/u.test(value)
}

function defaultEngineWaves(query: string): GeneralWebSearchEngine[][] {
  return hasCjkText(query)
    ? [
        ['bing', 'baidu'],
        ['brave', 'duckduckgo'],
      ]
    : [
        ['brave', 'bing'],
        ['duckduckgo', 'baidu'],
      ]
}

export function getGitHubTrendingPeriod(
  query: string,
): GitHubTrendingPeriod | null {
  if (!/(?:\bgithub\b|github\.com)/iu.test(query)) return null
  if (!/(?:\btrending\b|\btrends?\b|趋势|热榜|热门(?:仓库|项目))/iu.test(query)) {
    return null
  }

  const today = getLocalISODate()
  const explicitDates = [...query.matchAll(
    /(\d{4})\s*(?:-|\/|年)\s*(\d{1,2})\s*(?:-|\/|月)\s*(\d{1,2})\s*日?/gu,
  )].map(match =>
    `${match[1]}-${match[2]!.padStart(2, '0')}-${match[3]!.padStart(2, '0')}`,
  )
  if (explicitDates.some(date => date !== today)) return null

  if (/(?:\bweekly\b|\bthis week\b|周榜|本周|一周)/iu.test(query)) {
    return 'weekly'
  }
  if (/(?:\bmonthly\b|\bthis month\b|月榜|本月)/iu.test(query)) {
    return 'monthly'
  }
  return 'daily'
}

function buildEffectiveQuery(query: string, allowedDomains: string[]): string {
  const sites = allowedDomains
    .map(parseDomainRule)
    .filter((rule): rule is DomainRule => rule !== null)
    .slice(0, 5)
    .map(rule => `site:${rule.hostname}${rule.path}`)

  return sites.length > 0 ? `${query} (${sites.join(' OR ')})` : query
}

function cacheKey(options: Required<Pick<LocalWebSearchOptions, 'query' | 'maxResults'>> & {
  allowedDomains: string[]
  blockedDomains: string[]
}): string {
  return JSON.stringify({
    query: options.query,
    maxResults: options.maxResults,
    allowedDomains: [...options.allowedDomains].sort(),
    blockedDomains: [...options.blockedDomains].sort(),
  })
}

function getCached(key: string): LocalWebSearchResponse | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key)
    return null
  }
  return entry.response
}

function setCached(key: string, response: LocalWebSearchResponse): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, response })
}

function safeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'Unknown search error'
  return error.message.replace(/https?:\/\/[^\s]+/g, '[search endpoint]').slice(0, 300)
}

export function clearLocalWebSearchCache(): void {
  cache.clear()
}

export async function searchLocalWeb(
  options: LocalWebSearchOptions,
  dependencies: LocalWebSearchDependencies = {},
): Promise<LocalWebSearchResponse> {
  const query = options.query.trim()
  if (!query) throw new Error('Web search query cannot be empty')

  const maxResults = Math.min(
    MAX_RESULTS,
    Math.max(1, Math.floor(options.maxResults ?? 8)),
  )
  const allowedDomains = options.allowedDomains ?? []
  const blockedDomains = options.blockedDomains ?? []
  const key = cacheKey({ query, maxResults, allowedDomains, blockedDomains })
  const cached = getCached(key)
  if (cached) return cached

  const failures: LocalWebSearchFailure[] = []
  const attemptedEngines: LocalWebSearchEngine[] = []
  const http = createAxiosInstance()
  const trendingPeriod = getGitHubTrendingPeriod(query)

  if (trendingPeriod) {
    attemptedEngines.push('github')
    const executor = dependencies.githubTrending ?? ((period, limit, signal) =>
      fetchGitHubTrending(http, period, limit, signal))

    try {
      const direct = await executor(trendingPeriod, maxResults, options.signal)
      const directResults = filterSearchResultsByDomain(
        dedupeResults(direct.results),
        allowedDomains,
        blockedDomains,
      ).slice(0, maxResults)

      if (directResults.length > 0) {
        const response: LocalWebSearchResponse = {
          query,
          engines: attemptedEngines,
          results: directResults,
          failures,
          liveSource: {
            type: 'github_trending',
            url: direct.url,
            fetchedAt: direct.fetchedAt,
            date: direct.date,
            period: direct.period,
          },
        }
        setCached(key, response)
        return response
      }
    } catch (error) {
      if (options.signal?.aborted) {
        throw options.signal.reason ?? new Error('Web search aborted')
      }
      failures.push({ engine: 'github', message: safeErrorMessage(error) })
    }
  }

  const engines = {
    ...createDefaultEngines(http),
    ...(dependencies.engines ?? {}),
  }
  const waves = dependencies.engineWaves ?? defaultEngineWaves(query)
  const effectiveQuery = buildEffectiveQuery(query, allowedDomains)
  let results: LocalWebSearchHit[] = []

  for (const wave of waves) {
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new Error('Web search aborted')
    }

    const settled = await Promise.allSettled(
      wave.map(async engine => {
        attemptedEngines.push(engine)
        const executor = engines[engine]
        if (!executor) throw new Error(`Search engine ${engine} is unavailable`)
        return { engine, hits: await executor(effectiveQuery, maxResults, options.signal) }
      }),
    )

    for (let index = 0; index < settled.length; index += 1) {
      const outcome = settled[index]!
      const engine = wave[index]!
      if (outcome.status === 'rejected') {
        if (options.signal?.aborted) {
          throw options.signal.reason ?? new Error('Web search aborted')
        }
        failures.push({ engine, message: safeErrorMessage(outcome.reason) })
        continue
      }
      results.push(...outcome.value.hits)
    }

    results = filterSearchResultsByDomain(
      dedupeResults(results),
      allowedDomains,
      blockedDomains,
    )
    if (results.length >= Math.min(maxResults, 5)) break
  }

  const response: LocalWebSearchResponse = {
    query,
    engines: attemptedEngines,
    results: results.slice(0, maxResults),
    failures,
  }
  if (response.results.length > 0) setCached(key, response)
  return response
}
