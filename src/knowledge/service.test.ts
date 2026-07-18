import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { KnowledgeService } from './service.js'

const cleanupPaths: string[] = []
const services: KnowledgeService[] = []

afterEach(async () => {
  for (const service of services.splice(0)) service.close()
  await Promise.all(cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('KnowledgeService', () => {
  test('indexes text incrementally and searches Chinese content', async () => {
    const fixture = await createFixture()
    const project = join(fixture, 'project')
    await mkdir(project)
    await writeFile(join(project, 'README.md'), '# 架构设计\n\n订单服务通过事件总线处理付款。')
    await writeFile(join(project, 'worker.ts'), 'export function settlePayment() { return "paid" }')

    const service = createService(fixture)
    const [source] = await service.addSources([project], { waitForIndex: true })

    expect(source?.status).toBe('ready')
    expect(source?.documentCount).toBe(2)
    expect(service.search('事件总线')[0]?.title).toBe('README.md')
    expect(service.search('settlePayment')[0]?.title).toBe('worker.ts')

    await service.reindexSource(source!.id, { waitForIndex: true })
    expect(service.listDocuments({ sourceId: source!.id })).toHaveLength(2)
    expect(service.getStats().chunkCount).toBeGreaterThanOrEqual(2)
  })

  test('keeps binary files as metadata without reading their content', async () => {
    const fixture = await createFixture()
    const audioPath = join(fixture, 'meeting.wav')
    await writeFile(audioPath, new Uint8Array([0, 1, 2, 3, 4]))

    const service = createService(fixture)
    const [source] = await service.addSources([audioPath], { waitForIndex: true })
    const [document] = service.listDocuments({ sourceId: source!.id })

    expect(document?.indexMode).toBe('metadata')
    expect(document?.error).toContain('filename and path')
    expect(service.search('meeting')[0]?.title).toBe('meeting.wav')
  })

  test('removing a source deletes only the index', async () => {
    const fixture = await createFixture()
    const notePath = join(fixture, 'notes.txt')
    await writeFile(notePath, 'Persistent source file')

    const service = createService(fixture)
    const [source] = await service.addSources([notePath], { waitForIndex: true })
    expect(service.removeSource(source!.id)).toBe(true)

    expect(service.listSources()).toHaveLength(0)
    expect(await readFile(notePath, 'utf8')).toBe('Persistent source file')
  })

  test('supports a file and its containing folder as separate sources', async () => {
    const fixture = await createFixture()
    const project = join(fixture, 'project')
    const notePath = join(project, 'notes.md')
    await mkdir(project)
    await writeFile(notePath, 'Shared source content')

    const service = createService(fixture)
    const [fileSource] = await service.addSources([notePath], { waitForIndex: true })
    const [folderSource] = await service.addSources([project], { waitForIndex: true })

    expect(service.listDocuments({ sourceId: fileSource!.id })).toHaveLength(1)
    expect(service.listDocuments({ sourceId: folderSource!.id })).toHaveLength(1)
    expect(service.search('Shared source content')).toHaveLength(2)
  })
})

async function createFixture(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'cybercode-knowledge-'))
  cleanupPaths.push(path)
  return path
}

function createService(fixture: string): KnowledgeService {
  const service = new KnowledgeService(join(fixture, 'knowledge.db'))
  services.push(service)
  return service
}
