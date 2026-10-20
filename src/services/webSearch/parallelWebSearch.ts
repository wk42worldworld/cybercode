import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { z } from 'zod/v4'
import { getProxyFetchOptions } from '../../utils/proxy.js'
import { filterSearchResultsByDomain } from './localWebSearch.js'

const SEARCH_URL = 'https://search.parallel.ai/mcp'
const SEARCH_TIMEOUT_MS = 15_000
const responseSchema = z.object({
  results: z.array(z.object({
    url: z.string(),
    title: z.string().nullish(),
    excerpts: z.array(z.string()),
  })),
})

export async function searchParallelWeb(options: {
  query: string
  sessionId: string
  allowedDomains?: string[]
  blockedDomains?: string[]
  signal: AbortSignal
}) {
  const signal = AbortSignal.any([
    options.signal,
    AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  ])
  signal.throwIfAborted()
  const client = new Client({ name: 'cybercode', version: MACRO.VERSION })
  const transport = new StreamableHTTPClientTransport(new URL(SEARCH_URL), {
    requestInit: {
      ...getProxyFetchOptions(),
      headers: {
        'User-Agent': `CyberCode/${MACRO.VERSION} (+https://github.com/wk42worldworld/cybercode)`,
      },
    },
    // Bind the entire operation, including discovery, to cancellation/timeout.
    fetch: (url, init) => fetch(url, {
      ...init,
      signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]),
    }),
  })
  const query = options.allowedDomains?.length
    ? `${options.query} (${options.allowedDomains.map(domain => `site:${domain}`).join(' OR ')})`
    : options.query

  try {
    await client.connect(transport, { signal })
    const result = await client.callTool({
      name: 'web_search',
      arguments: {
        objective: options.query,
        search_queries: [query],
        session_id: options.sessionId,
      },
    }, undefined, { signal })
    const text = result.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n')
    if (result.isError) {
      throw new Error(`Parallel web search failed: ${text.slice(0, 1000)}`)
    }
    const response = responseSchema.parse(result.structuredContent ?? JSON.parse(text))
    const seen = new Set<string>()
    const hits = response.results.flatMap(result => {
      try {
        const url = new URL(result.url)
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return []
        if (seen.has(url.href)) return []
        seen.add(url.href)
        return [{
          title: result.title || url.hostname,
          url: url.href,
          description: result.excerpts.join('\n'),
          source: url.hostname,
          engine: 'parallel' as const,
        }]
      } catch {
        return []
      }
    })
    return filterSearchResultsByDomain(
      hits,
      options.allowedDomains,
      options.blockedDomains,
    ).slice(0, 10)
  } finally {
    await client.close()
  }
}
