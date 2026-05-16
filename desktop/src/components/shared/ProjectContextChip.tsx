import { Icon } from './Icon'
type Props = {
  workDir?: string | null
  repoName?: string | null
  branch?: string | null
}

export function ProjectContextChip({ workDir, repoName, branch }: Props) {
  const label = branch ? (repoName || workDir?.split('/').pop() || '') : (workDir?.split('/').pop() || repoName || '')

  if (!label) return null

  return (
    <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-accent-glow)] px-4 py-2 text-[13px] font-mono" style={{ fontFamily: 'var(--font-mono)' }}>
      {branch ? (
        <Icon name="account_tree" size={18} className="shrink-0 text-[var(--color-brand)]" />
      ) : (
        <Icon name="folder" size={18} className="text-[var(--color-brand)]" />
      )}
      <span className="truncate font-medium text-[var(--color-brand)]">{label}</span>
      {branch ? (
        <>
          <span className="text-[var(--color-text-tertiary)]">|</span>
          <span className="truncate text-[var(--color-text-secondary)]">{branch}</span>
        </>
      ) : null}
    </div>
  )
}
