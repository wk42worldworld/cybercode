import { describe, expect, test } from 'bun:test'
import {
  buildPathRequiredAttachmentMessage,
  getInlineFileAttachmentsWithoutPath,
} from './attachmentPolicy.js'

describe('chat attachment policy', () => {
  test('rejects regular file attachments that carry inline data without a path', () => {
    const blocked = getInlineFileAttachmentsWithoutPath([
      { type: 'file', name: 'report.pdf', data: 'data:application/pdf;base64,AAAA' },
      { type: 'file', name: 'archive.zip', path: '/tmp/archive.zip', data: 'ignored' },
      { type: 'image', name: 'diagram.png', data: 'data:image/png;base64,AAAA' },
    ])

    expect(blocked).toEqual([
      { type: 'file', name: 'report.pdf', data: 'data:application/pdf;base64,AAAA' },
    ])
  })

  test('builds a clear path-required message', () => {
    expect(buildPathRequiredAttachmentMessage([
      { type: 'file', name: 'report.pdf', data: 'AAAA' },
    ])).toContain('report.pdf')

    expect(buildPathRequiredAttachmentMessage([
      { type: 'file', name: 'report.pdf', data: 'AAAA' },
      { type: 'file', name: 'data.csv', data: 'BBBB' },
    ])).toContain('2 files')
  })
})
