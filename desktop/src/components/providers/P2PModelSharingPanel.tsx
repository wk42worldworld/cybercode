import { useEffect, useState } from 'react'
import {
  Check,
  Copy,
  Link2,
  LoaderCircle,
  Unplug,
  UserPlus,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { useTranslation } from '../../i18n'
import { copyTextToClipboard } from '../chat/clipboard'
import { p2pApi, isValidP2PPairingCode, type P2PTransportStatus } from '../../api/p2p'
import { useProviderStore } from '../../stores/providerStore'
import { Button } from '../shared/Button'
import { Input } from '../shared/Input'
import { SettingsSection, Switch } from '../settings/SettingsLayout'

type FeedbackTone = 'warning' | 'success'

const EMPTY_STATUS: P2PTransportStatus = {
  state: 'unavailable',
  reason: 'signal-not-configured',
  peerCount: 0,
  peers: [],
}

function deviceName(): string {
  if (typeof navigator === 'undefined' || !navigator.platform) return 'CyberCode device'
  return `CyberCode · ${navigator.platform}`.slice(0, 80)
}

export function P2PModelSharingPanel() {
  const t = useTranslation()
  const [transport, setTransport] = useState<P2PTransportStatus>(EMPTY_STATUS)
  const [sharingEnabled, setSharingEnabled] = useState(false)
  const [copied, setCopied] = useState(false)
  const [remoteCode, setRemoteCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ tone: FeedbackTone; message: string } | null>(null)

  const applyStatus = (status: P2PTransportStatus) => {
    setTransport(status)
    setSharingEnabled(status.state === 'connecting' || status.state === 'connected')
  }

  useEffect(() => {
    let active = true
    void p2pApi.status().then((status) => {
      if (active) applyStatus(status)
    }).catch((error) => {
      if (active) setFeedback({ tone: 'warning', message: error instanceof Error ? error.message : String(error) })
    })
    const timer = window.setInterval(() => {
      void p2pApi.status().then((status) => {
        if (active) applyStatus(status)
      }).catch(() => {})
    }, 3_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])

  const toggleSharing = async (enabled: boolean) => {
    setBusy(true)
    setFeedback(null)
    try {
      const status = enabled ? await p2pApi.startSharing() : await p2pApi.stopSharing()
      applyStatus(status)
      if (enabled) setFeedback({ tone: 'success', message: t('settings.p2p.shareReady') })
    } catch (error) {
      setSharingEnabled(false)
      setFeedback({ tone: 'warning', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  const copyCode = async () => {
    if (!transport.pairingCode || !await copyTextToClipboard(transport.pairingCode)) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1_500)
  }

  const connectWithCode = async () => {
    const normalizedCode = remoteCode.trim().toUpperCase()
    setRemoteCode(normalizedCode)
    if (!isValidP2PPairingCode(normalizedCode)) {
      setFeedback({ tone: 'warning', message: t('settings.p2p.invalidCode') })
      return
    }
    setBusy(true)
    setFeedback(null)
    try {
      const joined = await p2pApi.join({
        code: normalizedCode,
        deviceName: deviceName(),
      })
      const primaryModel = joined.models[0]
      if (!primaryModel) throw new Error(t('settings.p2p.noSharedModels'))
      const store = useProviderStore.getState()
      const existing = store.providers.find((provider) => provider.notes?.includes(`P2P session: ${joined.sessionId}`))
      const providerInput = {
        presetId: 'custom',
        name: `P2P · ${joined.nodeName}`,
        apiKey: joined.apiKey,
        baseUrl: joined.baseUrl,
        apiFormat: 'openai_chat' as const,
        models: { main: primaryModel, haiku: primaryModel, sonnet: primaryModel, opus: primaryModel },
        modelCatalog: joined.models.map((id) => ({ id })),
        notes: `P2P session: ${joined.sessionId}`,
      }
      const provider = existing
        ? await store.updateProvider(existing.id, providerInput)
        : await store.createProvider(providerInput)
      await store.activateProvider(provider.id)
      setFeedback({ tone: 'success', message: t('settings.p2p.joinedAndAdded', { name: joined.nodeName }) })
    } catch (error) {
      setFeedback({ tone: 'warning', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  const revokePeer = async (peerId: string) => {
    setBusy(true)
    try {
      applyStatus(await p2pApi.revokePeer(peerId))
      setFeedback({ tone: 'success', message: t('settings.p2p.deviceRevoked') })
    } catch (error) {
      setFeedback({ tone: 'warning', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  const statusLabel = transport.state === 'connected'
    ? t('settings.p2p.connected')
    : transport.state === 'connecting'
      ? t('settings.p2p.connecting')
      : t('settings.p2p.notConnected')
  const statusIcon = transport.state === 'connected'
    ? <Wifi size={11} />
    : transport.state === 'connecting'
      ? <LoaderCircle size={11} className="animate-spin" />
      : <WifiOff size={11} />

  return (
    <div className="flex max-w-[920px] flex-col gap-[16px]">
      <section className="border-b border-[var(--color-border-separator)] pb-[18px]">
        <div className="flex min-w-0 items-start gap-[11px]">
          <div className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-[8px] bg-[#1473e6]/[0.09] text-[#1473e6] dark:bg-[#64a8ff]/[0.12] dark:text-[#9bc8ff]">
            <Link2 size={19} strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-[8px]">
              <h2 className="text-[16px] font-bold text-[var(--color-text-primary)]">{t('settings.p2p.title')}</h2>
              <span className={`inline-flex h-[20px] items-center gap-[5px] rounded-full px-[8px] text-[10px] font-semibold ${transport.state === 'connected' ? 'bg-[var(--color-success)]/10 text-[var(--color-success)]' : 'bg-[var(--color-warning)]/10 text-[var(--color-warning)]'}`}>
                {statusIcon}
                {statusLabel}
              </span>
            </div>
            <p className="mt-[3px] max-w-[640px] text-[12px] leading-[18px] text-[var(--color-text-secondary)]">
              {t('settings.p2p.description')}
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-[12px] lg:grid-cols-2">
        <section className="flex min-w-0 flex-col gap-[14px] rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container)] p-[16px]">
          <div className="flex items-start justify-between gap-[12px]">
            <div className="flex min-w-0 items-start gap-[10px]">
              <div className="mt-[1px] flex size-[30px] shrink-0 items-center justify-center rounded-[7px] bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)]">
                <Users size={15} />
              </div>
              <div className="min-w-0">
                <h3 className="text-[13px] font-bold text-[var(--color-text-primary)]">{t('settings.p2p.shareTitle')}</h3>
                <p className="mt-[3px] text-[11px] leading-[17px] text-[var(--color-text-tertiary)]">{t('settings.p2p.shareHint')}</p>
              </div>
            </div>
            <Switch
              checked={sharingEnabled}
              disabled={busy}
              accent
              ariaLabel={t('settings.p2p.shareTitle')}
              onChange={(enabled) => void toggleSharing(enabled)}
            />
          </div>

          <div className="mt-auto rounded-[8px] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-[14px] py-[13px]">
            <div className="flex items-center justify-between gap-[12px]">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-tertiary)]">{t('settings.p2p.pairingCode')}</div>
                <div className={`mt-[5px] truncate font-mono text-[22px] font-bold tracking-[0.16em] ${transport.pairingCode ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)]'}`}>
                  {transport.pairingCode ?? '········'}
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                icon={copied ? <Check size={14} /> : <Copy size={14} />}
                disabled={!transport.pairingCode}
                onClick={() => void copyCode()}
                aria-label={t(copied ? 'settings.p2p.copied' : 'settings.p2p.copyCode')}
              >
                {t(copied ? 'settings.p2p.copied' : 'settings.p2p.copyCode')}
              </Button>
            </div>
          </div>
        </section>

        <section className="flex min-w-0 flex-col rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container)] p-[16px]">
          <div className="flex items-start gap-[10px]">
            <div className="mt-[1px] flex size-[30px] shrink-0 items-center justify-center rounded-[7px] bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)]">
              <UserPlus size={15} />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-[13px] font-bold text-[var(--color-text-primary)]">{t('settings.p2p.joinTitle')}</h3>
              <p className="mt-[3px] text-[11px] leading-[17px] text-[var(--color-text-tertiary)]">{t('settings.p2p.joinHint')}</p>
            </div>
          </div>
          <div className="mt-auto grid gap-[8px] pt-[14px] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <Input
              label={t('settings.p2p.remoteCode')}
              placeholder="ABCD27KM"
              value={remoteCode}
              maxLength={8}
              autoCapitalize="characters"
              onChange={(event) => setRemoteCode(event.target.value.toUpperCase().replace(/[^A-HJ-KM-NP-Z2-9]/g, ''))}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !busy) void connectWithCode()
              }}
            />
            <Button
              size="sm"
              icon={<Link2 size={14} />}
              loading={busy}
              disabled={!remoteCode.trim()}
              onClick={() => void connectWithCode()}
            >
              {t('settings.p2p.connect')}
            </Button>
          </div>
        </section>
      </div>

      {feedback && (
        <div className={`rounded-[7px] px-[10px] py-[8px] text-[11px] leading-[16px] ${feedback.tone === 'warning' ? 'bg-[var(--color-warning)]/10 text-[var(--color-warning)]' : 'bg-[var(--color-success)]/10 text-[var(--color-success)]'}`} role="status" aria-live="polite">
          {feedback.message}
        </div>
      )}

      <SettingsSection title={t('settings.p2p.connectedDevices')}>
        {transport.peers.length === 0 ? (
          <div className="flex min-h-[84px] flex-col items-center justify-center gap-[7px] px-[16px] py-[18px] text-center">
            <WifiOff size={18} className="text-[var(--color-text-tertiary)]" />
            <div className="text-[12px] font-semibold text-[var(--color-text-secondary)]">{t('settings.p2p.noDevices')}</div>
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-border-separator)]">
            {transport.peers.map((peer) => (
              <div key={peer.id} className="flex flex-wrap items-center justify-between gap-[10px] px-[16px] py-[12px]">
                <div className="min-w-0">
                  <div className="flex items-center gap-[7px]">
                    <div className="truncate text-[12px] font-semibold text-[var(--color-text-primary)]">{peer.name}</div>
                    <span className="shrink-0 text-[10px] text-[var(--color-text-tertiary)]">
                      {t(peer.state === 'connected' ? 'settings.p2p.connected' : 'settings.p2p.connecting')}
                    </span>
                  </div>
                  <div className="mt-[3px] text-[10px] text-[var(--color-text-tertiary)]">{t('settings.p2p.connectedAt', { time: new Date(peer.connectedAt).toLocaleString() })}</div>
                </div>
                <Button variant="ghost" size="sm" icon={<Unplug size={14} />} loading={busy} onClick={() => void revokePeer(peer.id)}>
                  {t('settings.p2p.revoke')}
                </Button>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>
    </div>
  )
}
