import { useEffect, useMemo, useState } from 'react'
import { useSkillStore } from '../../stores/skillStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTranslation } from '../../i18n'
import type { SkillMeta, SkillSource } from '../../types/skill'
import { Icon } from '../shared/Icon'
import { Switch } from '../settings/SettingsLayout'

const SOURCE_ORDER: SkillSource[] = ['user', 'project', 'plugin', 'mcp', 'bundled']

const SOURCE_ICONS: Record<SkillSource, string> = {
  user: 'person',
  project: 'folder',
  plugin: 'extension',
  mcp: 'hub',
  bundled: 'inventory_2',
}

const SOURCE_ACCENT_CLASSES: Record<SkillSource, string> = {
  user: 'bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)]',
  project: 'bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)]',
  plugin: 'bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)]',
  mcp: 'bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)]',
  bundled: 'bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)]',
}

function estimateTokens(contentLength: number) {
  return Math.ceil(contentLength / 4)
}

export function SkillList() {
  const { skills, isLoading, error, fetchSkills, fetchSkillDetail, setSkillEnabled } =
    useSkillStore()
  const [pendingSkillKey, setPendingSkillKey] = useState<string | null>(null)
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const t = useTranslation()
  const activeSession = sessions.find((session) => session.id === activeSessionId)
  const currentWorkDir = activeSession?.workDir || undefined

  useEffect(() => {
    fetchSkills(currentWorkDir)
  }, [fetchSkills, currentWorkDir])

  const toggleSkill = async (skill: SkillMeta, enabled: boolean) => {
    const key = `${skill.source}:${skill.name}`
    if (pendingSkillKey === key) return

    setPendingSkillKey(key)
    try {
      await setSkillEnabled(skill.source, skill.name, enabled, currentWorkDir)
    } finally {
      setPendingSkillKey(null)
    }
  }

  const grouped = useMemo(() => {
    const result: Partial<Record<SkillSource, SkillMeta[]>> = {}
    for (const skill of skills) {
      const src = skill.source as SkillSource
      ;(result[src] ??= []).push(skill)
    }
    return result
  }, [skills])

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin w-5 h-5 border-2 border-[var(--color-brand)] border-t-transparent rounded-full" />
      </div>
    )
  }

  if (error) {
    return <div className="text-[14px] text-[var(--color-error)] py-4">{error}</div>
  }

  if (skills.length === 0) {
    return (
      <div className="text-center py-12 rounded-[12px] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-6">
        <Icon name="auto_awesome" size={40} className="text-[var(--color-text-tertiary)] mb-2 block" />
        <p className="text-[14px] text-[var(--color-text-tertiary)]">
          {t('settings.skills.empty')}
        </p>
        <p className="text-[12px] text-[var(--color-text-tertiary)] mt-1">
          {t('settings.skills.emptyHint')}
        </p>
      </div>
    )
  }

  return (
    <div className="min-w-0 overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="divide-y divide-[var(--color-border)]">
        {SOURCE_ORDER.map((source) => {
          const group = grouped[source]
          if (!group?.length) return null

          const sourceLabel = t(`settings.skills.source.${source}`)
          const sourceTokenCount = group.reduce(
            (sum, skill) => sum + estimateTokens(skill.contentLength),
            0,
          )

          return (
            <section
              key={source}
              className="min-w-0"
            >
              <div className="flex min-h-[56px] items-center justify-between gap-[16px] bg-[var(--color-surface-container-low)] px-[16px] py-[10px]">
                <div className="flex min-w-0 items-center gap-[8px]">
                  <span className={`inline-flex h-[28px] w-[28px] flex-shrink-0 items-center justify-center rounded-lg ${SOURCE_ACCENT_CLASSES[source]}`}>
                    <Icon name={SOURCE_ICONS[source]} size={14} />
                  </span>
                  <h4 className="truncate text-[13px] font-semibold text-[var(--color-text-primary)]">
                    {sourceLabel}
                  </h4>
                    <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-[8px] py-[2px] text-[10px] font-medium text-[var(--color-text-tertiary)]">
                    {group.length}
                  </span>
                </div>
                <div className="flex-shrink-0 text-[11px] text-[var(--color-text-tertiary)]">
                  {t('settings.skills.tokenEstimateShort', { count: String(sourceTokenCount) })}
                </div>
              </div>

              <div className="divide-y divide-[var(--color-border)]">
                {group.map((skill) => {
                  const skillKey = `${skill.source}:${skill.name}`
                  const isPending = pendingSkillKey === skillKey
                  const displayName = skill.displayName || skill.name
                  const isEnabled = skill.enabled !== false

                  return (
                    <div
                      key={`${skill.source}-${skill.name}`}
                      className={`group flex min-h-[76px] w-full items-stretch transition-colors hover:bg-[var(--color-surface-hover)] ${
                        isEnabled ? '' : 'bg-[var(--color-surface-container-low)]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          skill.hasDirectory &&
                          fetchSkillDetail(skill.source, skill.name, currentWorkDir, 'skills')
                        }
                        disabled={!skill.hasDirectory}
                        className="flex min-w-0 flex-1 items-start gap-[12px] px-[16px] py-[12px] text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-black/15 focus-visible:ring-inset disabled:cursor-default disabled:opacity-60 dark:focus-visible:ring-white/20"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                            <span
                              className={`break-all text-[14px] font-semibold ${
                                isEnabled
                                  ? 'text-[var(--color-text-primary)]'
                                  : 'text-[var(--color-text-tertiary)]'
                              }`}
                            >
                              {displayName}
                            </span>
                            {skill.version && (
                              <span className="rounded-full bg-[var(--color-surface-container-high)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-tertiary)]">
                                v{skill.version}
                              </span>
                            )}
                            {skill.userInvocable && (
                              <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-tertiary)]">
                                {t('settings.skills.slashCommand')}
                              </span>
                            )}
                          </div>
                          <p className="mt-[3px] line-clamp-1 text-[12px] leading-[18px] text-[var(--color-text-secondary)]">
                            {skill.description}
                          </p>
                          <div className="mt-[6px] flex flex-wrap items-center gap-x-[10px] gap-y-[4px] text-[11px] text-[var(--color-text-tertiary)]">
                            <span>{t('settings.skills.tokenEstimateShort', { count: String(estimateTokens(skill.contentLength)) })}</span>
                            <span>{skill.hasDirectory ? t('settings.skills.ready') : t('settings.skills.unavailable')}</span>
                          </div>
                        </div>
                        <Icon name="chevron_right" size={16} className="mt-2 flex-shrink-0 text-[var(--color-text-tertiary)] opacity-50 transition-transform group-hover:translate-x-0.5 group-hover:opacity-100" />
                      </button>
                      <div className={`flex flex-shrink-0 items-center gap-[8px] pr-[16px] ${isPending ? 'opacity-60' : ''}`}>
                        <span className="hidden text-[11px] font-medium text-[var(--color-text-tertiary)] sm:inline">
                          {isEnabled ? t('settings.skills.enabled') : t('settings.skills.disabled')}
                        </span>
                        <Switch
                          checked={isEnabled}
                          onChange={(next) => void toggleSkill(skill, next)}
                          ariaLabel={t(
                            isEnabled
                              ? 'settings.skills.toggleDisable'
                              : 'settings.skills.toggleEnable',
                            { name: displayName },
                          )}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
