// desktop/src/components/settings/ClaudeOfficialLogin.tsx
//
// 显示当前 Claude Official OAuth 登录状态,提供 Login / Logout 按钮。
// 点击 Login 调 Tauri shell.open 打开浏览器走 OAuth flow;浏览器回 callback
// 到 cybercode server 后,store 的 polling 自动刷新 UI 展示"已登录"。

import { useEffect } from 'react'
import { open as shellOpen } from '@tauri-apps/plugin-shell'
import { useCybercodeOAuthStore } from '../../stores/cybercodeOAuthStore'
import { useTranslation } from '../../i18n'
import { Button } from '../shared/Button'

export function ClaudeOfficialLogin() {
  const t = useTranslation()
  const {
    status,
    isLoading,
    error,
    fetchStatus,
    login,
    logout,
    startPolling,
    stopPolling,
  } = useCybercodeOAuthStore()

  useEffect(() => {
    fetchStatus()
    return () => stopPolling()
  }, [fetchStatus, stopPolling])

  const handleLogin = async () => {
    try {
      const { authorizeUrl } = await login()
      try {
        await shellOpen(authorizeUrl)
        startPolling()
      } catch (err) {
        console.error('[ClaudeOfficialLogin] shellOpen failed:', err)
        useCybercodeOAuthStore.setState({
          error: t('settings.claudeOfficialLogin.openBrowserFailed'),
        })
      }
    } catch {
      // store.login() errors are already captured into store.error
    }
  }

  if (status === null) {
    if (error) {
      return (
        <div className="text-[12px] text-[var(--color-error)]">
          {t('settings.claudeOfficialLogin.errorPrefix')}{error}
        </div>
      )
    }
    return (
      <div className="text-[12px] text-[var(--color-text-tertiary)]">
        {t('common.loading')}
      </div>
    )
  }

  if (status.loggedIn) {
    const subTypeLabel = status.subscriptionType
      ? status.subscriptionType.toUpperCase()
      : t('settings.claudeOfficialLogin.subTypeUnknown')
    return (
      <div className="flex items-center gap-3 text-[14px]">
        <span className="text-[var(--color-brand)] flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[var(--color-brand)] animate-pulse-dot" />
          {t('settings.claudeOfficialLogin.loggedInPrefix')} {subTypeLabel})
        </span>
        <Button type="button" variant="secondary" size="sm" onClick={logout} disabled={isLoading}>
          {isLoading
            ? t('settings.claudeOfficialLogin.logoutProcessing')
            : t('settings.claudeOfficialLogin.logoutButton')}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[14px] text-[var(--color-text-secondary)]">
        {t('settings.claudeOfficialLogin.intro')}
      </div>
      <Button
        type="button"
        onClick={handleLogin}
        disabled={isLoading}
        className="self-start"
      >
        {isLoading
          ? t('settings.claudeOfficialLogin.loginStarting')
          : t('settings.claudeOfficialLogin.loginButton')}
      </Button>
      {error && (
        <div className="text-[12px] text-[var(--color-error)]">
          {t('settings.claudeOfficialLogin.errorPrefix')}{error}
        </div>
      )}
    </div>
  )
}
