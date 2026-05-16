import { useState, useEffect, useCallback } from 'react'
import { useAdapterStore } from '../stores/adapterStore'
import { useTranslation } from '../i18n'
import { Input } from '../components/shared/Input'
import { Button } from '../components/shared/Button'
import { DirectoryPicker } from '../components/shared/DirectoryPicker'
import { ConfirmDialog } from '../components/shared/ConfirmDialog'
import { SettingsPage, SettingsSection, SettingsRow, SegmentedControl, Switch } from '../components/settings/SettingsLayout'
import { Icon } from '../components/shared/Icon'

type ImTab = 'feishu' | 'telegram'

export function AdapterSettings() {
  const t = useTranslation()
  const { config, isLoading, fetchConfig, updateConfig, generatePairingCode, removePairedUser } = useAdapterStore()

  // Active IM tab —— Feishu 默认展示，在前
  const [activeIm, setActiveIm] = useState<ImTab>('feishu')

  // Server —— serverUrl 不再暴露在 UI 里（见下方 Server URL 注释），
  // 桌面端用 Tauri env var 注入动态端口。
  const [defaultProjectDir, setDefaultProjectDir] = useState('')

  // Telegram
  const [tgBotToken, setTgBotToken] = useState('')
  const [tgAllowedUsers, setTgAllowedUsers] = useState('')

  // Feishu
  const [fsAppId, setFsAppId] = useState('')
  const [fsAppSecret, setFsAppSecret] = useState('')
  const [fsEncryptKey, setFsEncryptKey] = useState('')
  const [fsVerificationToken, setFsVerificationToken] = useState('')
  const [fsAllowedUsers, setFsAllowedUsers] = useState('')
  const [fsStreamingCard, setFsStreamingCard] = useState(false)

  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState('')

  // Pairing
  const [pairingCode, setPairingCode] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [pendingUnbind, setPendingUnbind] = useState<{ platform: 'telegram' | 'feishu'; userId: string | number } | null>(null)
  const [isUnbinding, setIsUnbinding] = useState(false)

  useEffect(() => {
    fetchConfig()
  }, [])

  // Sync form state when config is loaded
  useEffect(() => {
    setDefaultProjectDir(config.defaultProjectDir ?? '')
    setTgBotToken(config.telegram?.botToken ?? '')
    setTgAllowedUsers(config.telegram?.allowedUsers?.join(', ') ?? '')
    setFsAppId(config.feishu?.appId ?? '')
    setFsAppSecret(config.feishu?.appSecret ?? '')
    setFsEncryptKey(config.feishu?.encryptKey ?? '')
    setFsVerificationToken(config.feishu?.verificationToken ?? '')
    setFsAllowedUsers(config.feishu?.allowedUsers?.join(', ') ?? '')
    setFsStreamingCard(config.feishu?.streamingCard ?? false)
  }, [config])

  async function handleSave() {
    setIsSaving(true)
    setSaveStatus('idle')
    setSaveError('')
    try {
      const patch: Record<string, unknown> = {}

      if (defaultProjectDir) patch.defaultProjectDir = defaultProjectDir

      const tgUsers = tgAllowedUsers
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number)
        .filter((n) => !isNaN(n))

      patch.telegram = {
        botToken: tgBotToken || undefined,
        allowedUsers: tgUsers.length ? tgUsers : [],
      }

      const fsUsers = fsAllowedUsers
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)

      patch.feishu = {
        appId: fsAppId || undefined,
        appSecret: fsAppSecret || undefined,
        encryptKey: fsEncryptKey || undefined,
        verificationToken: fsVerificationToken || undefined,
        allowedUsers: fsUsers.length ? fsUsers : [],
        streamingCard: fsStreamingCard,
      }

      await updateConfig(patch)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch (err) {
      setSaveStatus('error')
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setIsSaving(false)
    }
  }

  const handleGenerateCode = useCallback(async () => {
    setIsGenerating(true)
    try {
      const code = await generatePairingCode()
      setPairingCode(code)
    } catch (err) {
      console.error('Failed to generate pairing code:', err)
    } finally {
      setIsGenerating(false)
    }
  }, [generatePairingCode])

  const handleUnbind = useCallback(async (platform: 'telegram' | 'feishu', userId: string | number) => {
    setPendingUnbind({ platform, userId })
  }, [])

  const confirmUnbind = useCallback(async () => {
    if (!pendingUnbind) return
    setIsUnbinding(true)
    try {
      await removePairedUser(pendingUnbind.platform, pendingUnbind.userId)
      await fetchConfig()
      setPendingUnbind(null)
    } finally {
      setIsUnbinding(false)
    }
  }, [pendingUnbind, removePairedUser, fetchConfig])

  // Collect all paired users across platforms
  const allPairedUsers = [
    ...(config.telegram?.pairedUsers ?? []).map((u) => ({ ...u, platform: 'telegram' as const })),
    ...(config.feishu?.pairedUsers ?? []).map((u) => ({ ...u, platform: 'feishu' as const })),
  ]

  // Check pairing expiry
  const pairingExpiry = config.pairing?.expiresAt
  const isPairingActive = pairingExpiry ? Date.now() < pairingExpiry : false
  const minutesLeft = pairingExpiry ? Math.max(0, Math.ceil((pairingExpiry - Date.now()) / 60000)) : 0
  const imTabs: Array<{ value: ImTab; label: string }> = [
    { value: 'feishu', label: t('settings.adapters.feishu') },
    { value: 'telegram', label: t('settings.adapters.telegram') },
  ]

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-[var(--color-text-tertiary)]">
        <Icon name="progress_activity" size={18} className="animate-spin text-[20px] mr-2" />
        Loading...
      </div>
    )
  }

  return (
    <SettingsPage icon="chat" title={t('settings.tab.adapters')} description={t('settings.adapters.description')}>
      <div className="space-y-5">
        {/* Pairing */}
        <SettingsSection
          title={t('settings.adapters.pairing')}
          description={t('settings.adapters.pairingDesc')}
          action={(
            <Button variant="secondary" size="sm" onClick={handleGenerateCode} loading={isGenerating}>
              {pairingCode || isPairingActive
                ? t('settings.adapters.regenerateCode')
                : t('settings.adapters.generateCode')}
            </Button>
          )}
        >
          <div className="px-5 py-4 space-y-4">
            {(pairingCode || isPairingActive) && (
              <div className="flex flex-wrap items-center gap-2.5">
                {pairingCode && (
                  <span className="font-mono text-[24px] font-semibold tracking-[0.32em] text-[var(--color-text-primary)]">
                    {pairingCode}
                  </span>
                )}
                <span className="rounded-full border border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-text-tertiary)]">
                  {t('settings.adapters.codeExpiresIn')} {pairingCode ? 60 : minutesLeft} {t('settings.adapters.minutes')}
                </span>
              </div>
            )}
            {pairingCode && (
              <p className="text-[12px] leading-[1.6] text-[var(--color-text-tertiary)]">
                {t('settings.adapters.pairingCodeHint')}
              </p>
            )}

            <div>
              <h4 className="mb-2 text-[13px] font-semibold tracking-tight text-[var(--color-text-primary)]">
                {t('settings.adapters.pairedUsers')}
              </h4>
              {allPairedUsers.length === 0 ? (
                <p className="rounded-lg border border-dashed border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] px-4 py-5 text-center text-[13px] text-[var(--color-text-tertiary)]">
                  {t('settings.adapters.noPairedUsers')}
                </p>
              ) : (
                <div className="space-y-2">
                  {allPairedUsers.map((user) => (
                    <div
                      key={`${user.platform}-${user.userId}`}
                      className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] px-3 py-2.5"
                    >
                      <div className="min-w-0 flex items-center gap-2">
                        <span className="rounded bg-[var(--color-surface-container)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-text-secondary)]">
                          {t(`settings.adapters.platform.${user.platform}`)}
                        </span>
                        <span className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">{user.displayName}</span>
                        <span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">
                          {new Date(user.pairedAt).toLocaleDateString()}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleUnbind(user.platform, user.userId)}
                        className="shrink-0 rounded-md px-2 py-1 text-[12px] font-medium text-[var(--color-error)] transition-colors hover:bg-[var(--color-error)]/10"
                      >
                        {t('settings.adapters.unbind')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </SettingsSection>

      {/* Server URL —— 之前是个手填字段，但桌面端 Tauri 启动 adapter sidecar
          时已经把 server 的动态端口通过 ADAPTER_SERVER_URL env var 注进去了，
          loadConfig() 里 env 优先级高于这里的 file value，所以这个字段在桌面
          运行时完全不会被读到。用户也根本不知道该填什么端口（每次启动随机）。
          Standalone 模式（直接 bun run adapters/...）保留 file 字段兜底就够了。 */}

        {/* Default Project */}
        <SettingsSection>
          <SettingsRow
            label={t('settings.adapters.defaultProject')}
            hint={t('settings.adapters.defaultProjectHint')}
            align="start"
          >
            <div className="min-w-[220px]">
              <DirectoryPicker value={defaultProjectDir} onChange={setDefaultProjectDir} />
            </div>
          </SettingsRow>
        </SettingsSection>

        {/* IM Adapter Tabs —— Feishu 默认展示，在前 */}
        <SettingsSection
          title={activeIm === 'feishu' ? t('settings.adapters.feishu') : t('settings.adapters.telegram')}
          action={<SegmentedControl items={imTabs} value={activeIm} onChange={setActiveIm} />}
        >
          {activeIm === 'feishu' && (
            <div className="space-y-4 px-5 py-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  label={t('settings.adapters.appId')}
                  value={fsAppId}
                  onChange={(e) => setFsAppId(e.target.value)}
                  placeholder={t('settings.adapters.appIdPlaceholder')}
                />
                <Input
                  label={t('settings.adapters.appSecret')}
                  type="password"
                  value={fsAppSecret}
                  onChange={(e) => setFsAppSecret(e.target.value)}
                  placeholder={t('settings.adapters.appSecretPlaceholder')}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  label={t('settings.adapters.encryptKey')}
                  type="password"
                  value={fsEncryptKey}
                  onChange={(e) => setFsEncryptKey(e.target.value)}
                  placeholder={t('settings.adapters.encryptKeyPlaceholder')}
                />
                <Input
                  label={t('settings.adapters.verificationToken')}
                  type="password"
                  value={fsVerificationToken}
                  onChange={(e) => setFsVerificationToken(e.target.value)}
                  placeholder={t('settings.adapters.verificationTokenPlaceholder')}
                />
              </div>
              <Input
                label={t('settings.adapters.allowedUsers')}
                value={fsAllowedUsers}
                onChange={(e) => setFsAllowedUsers(e.target.value)}
                placeholder={t('settings.adapters.fsAllowedUsersPlaceholder')}
              />
              <p className="text-[12px] text-[var(--color-text-tertiary)]">{t('settings.adapters.allowedUsersHint')}</p>
              <SettingsRow
                label={t('settings.adapters.streamingCard')}
                hint={t('settings.adapters.streamingCardDesc')}
              >
                <Switch
                  checked={fsStreamingCard}
                  onChange={setFsStreamingCard}
                  ariaLabel={t('settings.adapters.streamingCard')}
                />
              </SettingsRow>
            </div>
          )}

          {activeIm === 'telegram' && (
            <div className="space-y-4 px-5 py-4">
              <Input
                label={t('settings.adapters.botToken')}
                type="password"
                value={tgBotToken}
                onChange={(e) => setTgBotToken(e.target.value)}
                placeholder={t('settings.adapters.botTokenPlaceholder')}
              />
              <Input
                label={t('settings.adapters.allowedUsers')}
                value={tgAllowedUsers}
                onChange={(e) => setTgAllowedUsers(e.target.value)}
                placeholder={t('settings.adapters.tgAllowedUsersPlaceholder')}
              />
              <p className="text-[12px] text-[var(--color-text-tertiary)]">{t('settings.adapters.allowedUsersHint')}</p>
            </div>
          )}
        </SettingsSection>

      {/* Save */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} loading={isSaving}>
          {saveStatus === 'saved' ? t('settings.adapters.saved') : t('settings.adapters.save')}
        </Button>
        {saveStatus === 'saved' && (
          <span className="text-[14px] text-[var(--color-success)]">
            <Icon name="check_circle" size={16} className="align-middle mr-1" />
            {t('settings.adapters.saved')}
          </span>
        )}
        {saveStatus === 'error' && (
          <span className="text-[14px] text-[var(--color-error)]">
            <Icon name="error" size={16} className="align-middle mr-1" />
            {saveError}
          </span>
        )}
      </div>

        <ConfirmDialog
          open={pendingUnbind !== null}
          onClose={() => {
            if (isUnbinding) return
            setPendingUnbind(null)
          }}
          onConfirm={confirmUnbind}
          title={t('settings.adapters.unbind')}
          body={t('settings.adapters.unbindConfirm')}
          confirmLabel={t('settings.adapters.unbind')}
          cancelLabel={t('common.cancel')}
          confirmVariant="danger"
          loading={isUnbinding}
        />
      </div>
    </SettingsPage>
  )
}
