import { PermissionModeSelector } from '../controls/PermissionModeSelector'
import { ModelSelector } from '../controls/ModelSelector'
import { DirectoryPicker } from '../shared/DirectoryPicker'
import { useTranslation } from '../../i18n'
import type { PermissionMode } from '../../types/settings'
import { Icon } from '../shared/Icon'

type Props = {
  value: string
  onChange: (value: string) => void
  placeholder?: string

  permissionMode: PermissionMode
  onPermissionModeChange: (mode: PermissionMode) => void

  modelId: string
  onModelChange: (modelId: string) => void

  folderPath: string
  onFolderPathChange: (path: string) => void

  useWorktree: boolean
  onUseWorktreeChange: (checked: boolean) => void
}

export function PromptEditor({
  value,
  onChange,
  placeholder,
  permissionMode,
  onPermissionModeChange,
  modelId,
  onModelChange,
  folderPath,
  onFolderPathChange,
  useWorktree: _useWorktree,
  onUseWorktreeChange: _onUseWorktreeChange,
}: Props) {
  const t = useTranslation()
  return (
    <div className="overflow-visible rounded-[12px] border border-[var(--color-border)] transition-colors focus-within:border-[var(--color-border-focus)] focus-within:shadow-[var(--shadow-focus-ring)]">
      {/* Prompt textarea */}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={4}
        className="w-full resize-y bg-transparent px-3 py-2.5 text-[13px] font-medium leading-relaxed text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
        style={{ minHeight: 120 }}
      />

      {/* Bottom toolbar */}
      <div className="flex flex-col gap-2 rounded-b-[12px] border-t border-[var(--color-border)]/40 bg-[var(--color-surface-container-low)] px-3 py-2">
        {/* Row 1: Permission + Model selectors */}
        <div className="flex items-center justify-between">
          <PermissionModeSelector value={permissionMode} onChange={onPermissionModeChange} workDir={folderPath || undefined} />
          <ModelSelector value={modelId} onChange={onModelChange} />
        </div>

        {/* Row 2: Folder picker */}
        <div className="flex items-center justify-between">
          <DirectoryPicker value={folderPath} onChange={onFolderPathChange} />
        </div>

        {/* Bypass + no folder warning */}
        {permissionMode === 'bypassPermissions' && (
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-[var(--color-error)]/8 text-[10px] text-[var(--color-error)]">
            <Icon name="warning" size={12} />
            {t('promptEditor.bypassWarning')}{folderPath ? ` ${t('promptEditor.within')} ${folderPath}` : ` ${t('promptEditor.selectFolder')}`}.
          </div>
        )}
      </div>
    </div>
  )
}
