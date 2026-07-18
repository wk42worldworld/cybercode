export type KnowledgeSourceKind = 'file' | 'folder'

export type KnowledgeSourceStatus =
  | 'pending'
  | 'indexing'
  | 'ready'
  | 'empty'
  | 'error'

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

export type KnowledgeDocumentIndexMode = 'text' | 'metadata'

export type KnowledgeDocument = {
  id: string
  sourceId: string
  path: string
  relativePath: string
  title: string
  extension: string
  indexMode: KnowledgeDocumentIndexMode
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
