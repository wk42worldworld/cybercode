import { api } from './client'

export type KnowledgeSourceStatus = 'pending' | 'indexing' | 'ready' | 'empty' | 'error'
export type KnowledgeSourceKind = 'file' | 'folder'

export type KnowledgeSource = {
  id: string
  path: string
  name: string
  kind: KnowledgeSourceKind
  status: KnowledgeSourceStatus
  error: string | null
  documentCount: number
  chunkCount: number
  sizeBytes: number
  createdAt: string
  updatedAt: string
  indexedAt: string | null
}

export type KnowledgeDocument = {
  id: string
  sourceId: string
  path: string
  relativePath: string
  title: string
  extension: string
  indexMode: 'text' | 'metadata'
  sizeBytes: number
  modifiedAt: string
  indexedAt: string
  error: string | null
}

export type KnowledgeSearchResult = {
  chunkId: number
  sourceId: string
  documentId: string
  sourceName: string
  title: string
  path: string
  excerpt: string
  score: number
}

export type KnowledgeStats = {
  sourceCount: number
  documentCount: number
  chunkCount: number
  sizeBytes: number
  indexingCount: number
}

export const knowledgeApi = {
  sources: () => api.get<KnowledgeSource[]>('/api/knowledge/sources'),

  addSources: (paths: string[]) =>
    api.post<KnowledgeSource[]>('/api/knowledge/sources', { paths }),

  removeSource: (sourceId: string) =>
    api.delete<{ removed: boolean }>(`/api/knowledge/sources/${encodeURIComponent(sourceId)}`),

  reindexSource: (sourceId: string) =>
    api.post<KnowledgeSource>(`/api/knowledge/sources/${encodeURIComponent(sourceId)}/reindex`, {}),

  documents: (sourceId?: string, limit = 500) => {
    const query = new URLSearchParams({ limit: String(limit) })
    if (sourceId) query.set('sourceId', sourceId)
    return api.get<KnowledgeDocument[]>(`/api/knowledge/documents?${query.toString()}`)
  },

  search: (queryText: string, sourceId?: string, limit = 30) => {
    const query = new URLSearchParams({ q: queryText, limit: String(limit) })
    if (sourceId) query.set('sourceId', sourceId)
    return api.get<KnowledgeSearchResult[]>(`/api/knowledge/search?${query.toString()}`)
  },

  stats: () => api.get<KnowledgeStats>('/api/knowledge/stats'),
}
