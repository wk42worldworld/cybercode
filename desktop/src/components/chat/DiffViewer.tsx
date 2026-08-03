import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued'
import { Highlight, type PrismTheme } from 'prism-react-renderer'
import { useEffect, useMemo, useState } from 'react'
import {
  prepareLargeDiffPreviewAsync,
  shouldUseLargeDiffPreview,
  type DiffPreview,
} from '../../lib/heavyTextWorker'
import { CopyButton } from '../shared/CopyButton'

type Props = {
  filePath: string
  oldString: string
  newString: string
  additions?: number
  deletions?: number
  showHeader?: boolean
  maxHeightClassName?: string
}

function inferLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase()
  const langMap: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    py: 'python', rs: 'rust', go: 'go', rb: 'ruby',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
    md: 'markdown', css: 'css', html: 'markup', xml: 'markup',
    sql: 'sql', sh: 'bash', bash: 'bash', zsh: 'bash',
  }
  return langMap[ext ?? ''] || 'text'
}

/** Shared warm syntax theme — must stay in sync with CodeViewer */
const warmSyntaxTheme: PrismTheme = {
  plain: {
    color: 'var(--color-code-fg)',
    backgroundColor: 'transparent',
  },
  styles: [
    { types: ['comment', 'prolog', 'doctype', 'cdata'], style: { color: 'var(--color-code-comment)', fontStyle: 'italic' as const } },
    { types: ['string', 'attr-value', 'template-string'], style: { color: 'var(--color-code-string)' } },
    { types: ['keyword', 'selector', 'important', 'atrule'], style: { color: 'var(--color-code-keyword)' } },
    { types: ['function'], style: { color: 'var(--color-code-function)' } },
    { types: ['tag'], style: { color: 'var(--color-code-keyword)' } },
    { types: ['number', 'boolean'], style: { color: 'var(--color-code-number)' } },
    { types: ['operator'], style: { color: 'var(--color-code-fg)' } },
    { types: ['punctuation'], style: { color: 'var(--color-code-punctuation)' } },
    { types: ['variable', 'parameter'], style: { color: 'var(--color-code-fg)' } },
    { types: ['property', 'attr-name'], style: { color: 'var(--color-code-property)' } },
    { types: ['builtin', 'class-name', 'constant', 'symbol'], style: { color: 'var(--color-code-type)' } },
    { types: ['regex'], style: { color: 'var(--color-primary-container)' } },
    { types: ['inserted'], style: { color: 'var(--color-code-inserted)' } },
    { types: ['deleted'], style: { color: 'var(--color-code-deleted)' } },
  ],
}

function highlightSyntax(str: string, language: string) {
  return (
    <Highlight theme={warmSyntaxTheme} code={str} language={language}>
      {({ tokens, getTokenProps }) => (
        <>
          {tokens.map((line, i) => (
            <span key={i}>
              {line.map((token, key) => (
                <span key={key} {...getTokenProps({ token })} />
              ))}
            </span>
          ))}
        </>
      )}
    </Highlight>
  )
}

const diffStyles = {
  variables: {
    light: {
      diffViewerBackground: 'var(--color-code-bg)',
      diffViewerColor: 'var(--color-code-fg)',
      addedBackground: 'var(--color-diff-added-bg)',
      addedColor: 'var(--color-code-fg)',
      removedBackground: 'var(--color-diff-removed-bg)',
      removedColor: 'var(--color-code-fg)',
      wordAddedBackground: 'var(--color-diff-added-word)',
      wordRemovedBackground: 'var(--color-diff-removed-word)',
      addedGutterBackground: 'var(--color-diff-added-gutter)',
      removedGutterBackground: 'var(--color-diff-removed-gutter)',
      gutterBackground: 'var(--color-surface-container-low)',
      gutterBackgroundDark: 'var(--color-surface-container)',
      highlightBackground: 'var(--color-diff-highlight-bg)',
      highlightGutterBackground: 'var(--color-diff-highlight-gutter)',
      codeFoldGutterBackground: 'var(--color-surface-container-high)',
      codeFoldBackground: 'var(--color-surface-container-highest)',
      emptyLineBackground: 'var(--color-surface-container-low)',
      gutterColor: 'var(--color-text-tertiary)',
      addedGutterColor: 'var(--color-diff-added-text)',
      removedGutterColor: 'var(--color-diff-removed-text)',
      codeFoldContentColor: 'var(--color-text-tertiary)',
      diffViewerTitleBackground: 'var(--color-diff-title-bg)',
      diffViewerTitleColor: 'var(--color-diff-title-color)',
      diffViewerTitleBorderColor: 'var(--color-diff-title-border)',
    },
  },
  diffContainer: {
    borderRadius: '0',
    fontSize: '12px',
    lineHeight: '1.45',
    fontFamily: 'var(--font-mono)',
  },
  line: {
    padding: '1px 0',
    borderLeft: '2px solid transparent',
  },
  addedLine: {
    borderLeft: '2px solid var(--color-diff-added-text)',
  },
  removedLine: {
    borderLeft: '2px solid var(--color-diff-removed-text)',
  },
  gutter: {
    padding: '1px 8px',
    minWidth: '40px',
    fontSize: '11px',
    fontFamily: 'var(--font-mono)',
    color: 'var(--color-text-tertiary)',
  },
  wordDiff: {
    padding: '1px 2px',
    borderRadius: '2px',
  },
}

export function DiffViewer({
  filePath,
  oldString,
  newString,
  additions: additionsProp,
  deletions: deletionsProp,
  showHeader = true,
  maxHeightClassName = 'max-h-[400px]',
}: Props) {
  const language = inferLanguage(filePath)
  const usesPerformancePreview = shouldUseLargeDiffPreview(oldString, newString)
  const [workerPreview, setWorkerPreview] = useState<{
    oldString: string
    newString: string
    preview: DiffPreview
  } | null>(null)
  const preview = usesPerformancePreview
    && workerPreview?.oldString === oldString
    && workerPreview.newString === newString
    ? workerPreview.preview
    : null
  const smallStats = useMemo(() => {
    if (usesPerformancePreview) return null
    const oldLines = oldString.split('\n')
    const newLines = newString.split('\n')
    return {
      additions: newLines.filter((line, index) => line !== (oldLines[index] ?? null)).length,
      deletions: oldLines.filter((line, index) => line !== (newLines[index] ?? null)).length,
    }
  }, [newString, oldString, usesPerformancePreview])
  const additions = additionsProp
    ?? smallStats?.additions
  const deletions = deletionsProp
    ?? smallStats?.deletions

  useEffect(() => {
    if (!usesPerformancePreview) return
    const controller = new AbortController()
    prepareLargeDiffPreviewAsync(oldString, newString, { signal: controller.signal })
      .then((nextPreview) => {
        if (!controller.signal.aborted) {
          setWorkerPreview({ oldString, newString, preview: nextPreview })
        }
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [newString, oldString, usesPerformancePreview])

  const renderedOld = preview?.oldValue ?? oldString
  const renderedNew = preview?.newValue ?? newString

  return (
    <div className={`overflow-hidden bg-[var(--color-surface-container)] ${showHeader ? 'rounded-[var(--radius-lg)]' : ''}`}>
      {/* Header */}
      {showHeader && (
        <div className="flex items-center justify-between border-b border-[var(--color-border-separator)] bg-[var(--color-surface-container)] px-3 py-1.5">
          <div className="min-w-0">
            <div className="truncate font-[var(--font-mono)] text-[11px] text-[var(--color-text-tertiary)]">
              {filePath}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="label-micro text-[var(--color-diff-added-text)]">+{additions ?? '?'}</span>
              <span className="label-micro text-[var(--color-diff-removed-text)]">-{deletions ?? '?'}</span>
            </div>
          </div>
          <CopyButton
            text={`--- ${filePath}\n+++ ${filePath}`}
            label="Copy path"
            className="btn-ghost px-2 py-1 text-[11px] text-[var(--color-text-tertiary)] hover:text-[var(--color-brand)]"
          />
        </div>
      )}

      {/* Diff area */}
      <div className={`${maxHeightClassName} overflow-auto bg-[var(--color-code-bg)]`}>
        {usesPerformancePreview && !preview ? (
          <div aria-busy="true" className="h-[96px] p-3">
            <div className="h-2 w-2/3 animate-pulse rounded-full bg-[var(--color-surface-container-highest)]" />
            <div className="mt-2 h-2 w-1/2 animate-pulse rounded-full bg-[var(--color-surface-container-highest)]" />
          </div>
        ) : (
          <>
            {preview?.truncated && (
              <div className="border-b border-[var(--color-border-separator)] px-3 py-1 font-[var(--font-mono)] text-[10px] text-[var(--color-text-tertiary)]">
                [...] [-] {preview.oldShownLineCount}/{preview.oldLineCount} [+] {preview.newShownLineCount}/{preview.newLineCount}
              </div>
            )}
            <ReactDiffViewer
              oldValue={renderedOld}
              newValue={renderedNew}
              splitView={false}
              compareMethod={usesPerformancePreview ? DiffMethod.LINES : DiffMethod.WORDS}
              renderContent={usesPerformancePreview ? undefined : (str) => highlightSyntax(str, language)}
              hideLineNumbers={false}
              styles={diffStyles}
              useDarkTheme={typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark'}
            />
          </>
        )}
      </div>
    </div>
  )
}
