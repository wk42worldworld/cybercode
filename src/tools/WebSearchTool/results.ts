export type LinkedSearchResult = {
  content?: Array<{ url?: string }> | null
}

export function hasLinkedSearchResults(
  results: Array<LinkedSearchResult | string | null | undefined>,
): boolean {
  return results.some(
    result =>
      result != null &&
      typeof result !== 'string' &&
      result.content?.some(hit => typeof hit.url === 'string' && hit.url.length > 0),
  )
}
