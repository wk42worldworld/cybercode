import { useState } from 'react'
import {
  mockPermissionModes,
  mockModels,
  mockEffortLevels,
  mockSessions,
  mockStatusBar,
} from '../mocks/data'
import { Icon } from '../components/shared/Icon'

/* ────────────────────────────────────────────────────────────────────
   Icon helpers for the permission modes (matching HTML prototype exactly)
   ──────────────────────────────────────────────────────────────────── */
const permissionIcons: Record<string, { icon: string; color: string; selectedColor?: string }> = {
  ask:    { icon: 'verified_user', color: 'text-outline' },
  auto:   { icon: 'bolt',          color: 'text-outline' },
  plan:   { icon: 'architecture',  color: 'text-tertiary' },
  bypass: { icon: 'gavel',         color: 'text-error' },
}

const modelIcons: Record<string, string> = {
  opus:   'psychology',
  sonnet: 'smart_toy',
  haiku:  'auto_awesome',
}

/* ════════════════════════════════════════════════════════════════════
   SessionControls  —  full-page component (sidebar + header + chat +
   two open dropdown panels + composer + footer)
   ════════════════════════════════════════════════════════════════════ */
export default function SessionControls() {
  const [selectedPermission, setSelectedPermission] = useState('ask')
  const [selectedModel, setSelectedModel] = useState('sonnet')
  const [selectedEffort, setSelectedEffort] = useState('Medium')
  const [showPermissions, setShowPermissions] = useState(true)
  const [showModelConfig, setShowModelConfig] = useState(true)

  const activeModel = mockModels.find((m) => m.id === selectedModel)

  return (
    <div className="h-screen w-screen bg-background text-on-surface font-body selection:bg-primary-fixed overflow-hidden relative">
      {/* ─── TopAppBar ─────────────────────────────────────────── */}
      <header className="bg-[var(--color-surface)] font-headline font-semibold tracking-wide text-[14px] fixed top-0 left-0 right-0 flex justify-between items-center px-6 h-12 z-40">
        <div className="flex items-center gap-6">
          <span className="text-[14px] font-bold text-[var(--color-text-primary)] uppercase tracking-tighter">
            CyberCode
          </span>
          <nav className="hidden md:flex gap-4">
            <a className="text-[var(--color-text-primary)] border-b-2 border-[var(--color-primary)] pb-1 cursor-pointer active:opacity-70">
              Code
            </a>
            <a className="text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors cursor-pointer active:opacity-70">
              Terminal
            </a>
            <a className="text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors cursor-pointer active:opacity-70">
              History
            </a>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <Icon name="arrow_back_ios" size={18} className="text-[var(--color-text-secondary)] cursor-pointer" />
          <Icon name="arrow_forward_ios" size={18} className="text-[var(--color-text-secondary)] cursor-pointer" />
          <button className="btn-ghost ml-2 px-3 py-1 rounded text-[12px] font-medium text-[var(--color-text-secondary)]">
            Settings
          </button>
        </div>
      </header>

      {/* Separator line */}
      <div className="bg-[var(--color-surface-container-low)] h-[1px] w-full fixed top-12 z-40" />

      {/* ─── SideNavBar ────────────────────────────────────────── */}
      <aside className="bg-[var(--color-surface-container-low)] font-body text-[14px] font-medium fixed left-0 top-0 h-full w-[280px] hidden md:flex flex-col p-4 gap-2 pt-16 z-30">
        {/* Project header */}
        <div className="px-2 mb-4">
          <div className="flex items-center gap-3 mb-1">
            <img
              className="w-8 h-8 rounded-full"
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuCjFls9oDx5jX7Zv8P7BA9QbodBzvDJFhVNIiVjAhp_OhnXT6lmE-uYCDDZvNS4kWHssfxAYuiH05KsXLBWgLd4K-8prrjodVjSsKAG1LhvKWN90nyVzDBSrreWkpW7reNC1N_T4J_Pdr9mgAYVwYRS10nvUMZs_ajpTg2CoTtMkQRRGZGZXLk_gU94EoaeDEPNbvwaxOeeTeGgOxwnzcPIUn6EFzqc5Bjug00IDIrhRYiuwEaGNkTuz39mNFxJl2bKiHES5HxUM60"
              alt="project avatar"
            />
            <div>
              <h3 className="text-on-surface font-bold leading-none">All projects</h3>
              <p className="text-[10px] text-outline uppercase tracking-widest mt-1">
                Active Session
              </p>
            </div>
          </div>
        </div>

        {/* Nav items */}
        <button className="w-full text-left p-2.5 bg-[var(--color-surface)] text-[var(--color-text-primary)] rounded-lg relative before:content-[''] before:absolute before:left-[-8px] before:w-1 before:h-4 before:bg-[var(--color-primary)] before:rounded-full before:top-1/2 before:-translate-y-1/2 transition-all duration-200 ease-in-out flex items-center gap-3">
          <Icon name="add" size={18} className="text-[var(--color-primary)]" />
          <span>New session</span>
        </button>
        <button className="w-full text-left p-2.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] rounded-lg transition-all duration-200 ease-in-out flex items-center gap-3">
          <Icon name="calendar_today" size={18} />
          <span>Scheduled</span>
        </button>
        <button className="w-full text-left p-2.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] rounded-lg transition-all duration-200 ease-in-out flex items-center gap-3" data-count={mockSessions.today.length}>
          <Icon name="history" size={18} />
          <span>Today</span>
        </button>
        <button className="w-full text-left p-2.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] rounded-lg transition-all duration-200 ease-in-out flex items-center gap-3" data-count={mockSessions.previous7Days.length}>
          <Icon name="event_note" size={18} />
          <span>Previous 7 Days</span>
        </button>
        <button className="w-full text-left p-2.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] rounded-lg transition-all duration-200 ease-in-out flex items-center gap-3" data-count={mockSessions.older.length}>
          <Icon name="archive" size={18} />
          <span>Older</span>
        </button>

        {/* Bottom modes */}
        <div className="mt-auto pt-4 border-t border-outline/10 flex flex-col gap-1">
          <button className="flex items-center gap-3 p-2 text-outline hover:text-primary transition-colors">
            <Icon name="computer" size={12} />
            <span className="text-[12px]">Local Mode</span>
          </button>
          <button className="flex items-center gap-3 p-2 text-outline hover:text-primary transition-colors">
            <Icon name="cloud" size={12} />
            <span className="text-[12px]">Remote Mode</span>
          </button>
        </div>
      </aside>

      {/* ─── Main Content Area (blurred / dimmed behind overlays) ── */}
      <main className="md:ml-[280px] pt-12 pb-8 min-h-screen blur-[2px] opacity-60">
        <div className="max-w-4xl mx-auto px-8 py-12">
          <div className="grid grid-cols-12 gap-6">
            {/* Main Thread */}
            <div className="col-span-8 space-y-8">
              {/* AI message */}
              <div className="bg-surface-container-low rounded-md p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-on-primary font-bold text-[12px]">
                    AI
                  </div>
                  <span className="font-semibold text-[14px]">Claude 4.6 Sonnet</span>
                </div>
                <p className="text-on-surface-variant leading-relaxed">
                  I've analyzed the{' '}
                  <code className="bg-surface-dim px-1.5 py-0.5 rounded font-mono text-[14px]">
                    auth_provider.go
                  </code>{' '}
                  file. The race condition occurs during the token refresh cycle. I recommend
                  wrapping the session update in a mutex lock.
                </p>
              </div>

              {/* User message */}
              <div className="flex justify-end">
                <div className="bg-surface-container-highest rounded-md p-6 max-w-[80%]">
                  <p className="text-on-surface leading-relaxed">
                    Can you implement that? Also check if this affects the WebSocket connection
                    longevity.
                  </p>
                </div>
              </div>

              {/* Code Block Preview */}
              <div className="bg-surface-dim rounded-lg overflow-hidden font-mono text-[14px]">
                <div className="bg-surface-container-high px-4 py-2 flex justify-between items-center">
                  <span className="text-[12px] text-on-surface-variant">
                    internal/auth/provider.go
                  </span>
                  <Icon name="content_copy" size={14} className="text-outline cursor-pointer" />
                </div>
                <pre className="p-4 text-on-surface">
                  <code>{`func (p *Provider) RefreshToken(ctx context.Context) error {
    p.mu.Lock()
    defer p.mu.Unlock()

    // logic to refresh token...
    return nil
}`}</code>
                </pre>
              </div>
            </div>

            {/* Session Meta */}
            <div className="col-span-4 space-y-6">
              <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-md p-4">
                <h4 className="text-[12px] font-bold uppercase tracking-widest text-outline mb-4">
                  Context Files
                </h4>
                <ul className="space-y-3">
                  <li className="flex items-center gap-2 text-[14px] text-on-surface-variant">
                    <Icon name="description" size={14} />
                    auth_provider.go
                  </li>
                  <li className="flex items-center gap-2 text-[14px] text-on-surface-variant">
                    <Icon name="description" size={14} />
                    main.go
                  </li>
                  <li className="flex items-center gap-2 text-[14px] text-on-surface-variant">
                    <Icon name="description" size={14} />
                    session_test.go
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* ─── Overlay Layer (Active Selectors) ──────────────────── */}
      <div className="fixed inset-0 z-50 flex flex-col justify-end items-center pointer-events-none p-8">
        {/* Floating Dropdown Overlay Container */}
        <div className="w-full max-w-2xl flex gap-4 mb-4 pointer-events-auto items-end">
          {/* ── Permissions Dropdown ─────────────────────────────── */}
          {showPermissions && (
            <div
              className="w-80 rounded-md border border-[var(--color-border)] overflow-hidden flex flex-col"
              style={{
                background: 'var(--color-surface-container-lowest)',
                boxShadow: '0 16px 48px -8px rgba(0,0,0,0.15)',
              }}
            >
              <div className="px-4 py-3 bg-[var(--color-surface-container-low)] border-b border-[var(--color-border-separator)]">
                <span className="text-[10px] font-bold uppercase tracking-widest text-black/30 dark:text-white/30">
                  Execution Permissions
                </span>
              </div>
              <div className="p-2 space-y-1">
                {mockPermissionModes.map((mode) => {
                  const meta = permissionIcons[mode.id] || {
                    icon: mode.icon,
                    color: 'text-[var(--color-text-secondary)]',
                  }
                  const isSelected = selectedPermission === mode.id
                  const isPlan = mode.id === 'plan'
                  const isBypass = mode.id === 'bypass'

                  let hoverClass = 'hover:bg-[var(--color-surface-container-high)]'
                  if (isPlan) hoverClass = 'hover:bg-[var(--color-surface-hover)]'
                  if (isBypass) hoverClass = 'hover:bg-[var(--color-error)]/10'

                  let labelColor = ''
                  if (isPlan) labelColor = 'text-[var(--color-text-tertiary)]'
                  if (isBypass) labelColor = 'text-[var(--color-error)]'

                  return (
                    <button
                      key={mode.id}
                      onClick={() => setSelectedPermission(mode.id)}
                      className={`w-full text-left p-3 rounded-lg ${hoverClass} transition-colors flex gap-3 group`}
                    >
                      <Icon name={meta.icon} size={18} className={`${meta.color} mt-0.5`} />
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className={`text-[14px] font-semibold ${labelColor}`}>
                            {mode.label}
                          </span>
                          {isSelected && (
                            <Icon name="check_circle" size={14} className="text-[var(--color-brand)]" />
                          )}
                        </div>
                        <p className="text-[12px] text-on-surface-variant">{mode.description}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Model & Effort Dropdown ─────────────────────────── */}
          {showModelConfig && (
            <div
              className="w-64 rounded-md border border-[var(--color-border)] overflow-hidden flex flex-col"
              style={{
                background: 'var(--color-surface-container-lowest)',
                boxShadow: '0 16px 48px -8px rgba(0,0,0,0.15)',
              }}
            >
              <div className="px-4 py-3 bg-[var(--color-surface-container-low)] border-b border-[var(--color-border-separator)]">
                <span className="text-[10px] font-bold uppercase tracking-widest text-black/30 dark:text-white/30">
                  Model Configuration
                </span>
              </div>

              {/* Models */}
              <div className="p-2">
                {mockModels.map((model) => {
                  const isActive = selectedModel === model.id
                  const icon = modelIcons[model.id] || 'smart_toy'

                  return (
                    <button
                      key={model.id}
                      onClick={() => setSelectedModel(model.id)}
                      className={`w-full text-left p-2.5 rounded-lg flex items-center justify-between transition-colors ${
                        isActive
                          ? 'bg-[var(--color-brand)]/8 text-[var(--color-brand)]'
                          : 'hover:bg-[var(--color-surface-container-high)]'
                      }`}
                    >
                      <div
                        className={`flex items-center gap-2 ${
                          isActive ? 'font-semibold' : ''
                        }`}
                      >
                        <Icon
                          name={icon}
                          size={14}
                          className={isActive ? 'text-[var(--color-brand)]' : 'text-[var(--color-text-tertiary)]'}
                        />
                        <span className="text-[14px]">{model.name}</span>
                      </div>
                      {isActive && (
                        <Icon name="radio_button_checked" size={14} className="text-[var(--color-brand)]" />
                      )}
                    </button>
                  )
                })}
              </div>

              {/* Divider */}
              <div className="mx-4 h-[1px] bg-[var(--color-border)]" />

              {/* Effort levels */}
              <div className="p-2">
                <div className="px-2 mb-2">
                  <span className="text-[9px] font-bold text-[var(--color-text-tertiary)] uppercase tracking-tighter">
                    Thinking Effort
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {mockEffortLevels.map((level) => {
                    const isActive = selectedEffort === level
                    /* The HTML uses "Med" for the label display of "Medium" */
                    const displayLabel =
                      level === 'Medium' ? 'Med' : level

                    return (
                      <button
                        key={level}
                        onClick={() => setSelectedEffort(level)}
                        className={`text-[12px] py-2 px-3 rounded-md transition-all ${
                          isActive
                            ? 'bg-[var(--color-brand)] text-[var(--color-on-primary)]'
                            : 'border border-[var(--color-border)] hover:border-[var(--color-brand)]'
                        } ${level === 'Max' ? 'font-bold' : ''}`}
                      >
                        {displayLabel}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── The Composer (Anchor) ─────────────────────────────── */}
        <div
          className="w-full max-w-2xl p-4 rounded-md border border-[var(--color-border)] pointer-events-auto flex flex-col gap-3"
          style={{
            background: 'var(--color-surface-container-lowest)',
            boxShadow: '0 16px 48px -8px rgba(0,0,0,0.15)',
          }}
        >
          <textarea
            className="w-full bg-transparent border-none focus:ring-0 focus:outline-none resize-none font-body text-on-surface placeholder:text-outline"
            placeholder="Reply to Claude..."
            rows={2}
          />
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              {/* Permission pill */}
              <button
                onClick={() => setShowPermissions((v) => !v)}
                className="btn-ghost flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-all"
              >
                <Icon name={permissionIcons[selectedPermission]?.icon || 'verified_user'} size={16} />
                {mockPermissionModes.find((m) => m.id === selectedPermission)?.label ||
                  'Ask permissions'}
              </button>

              {/* Model pill */}
              <button
                onClick={() => setShowModelConfig((v) => !v)}
                className="btn-ghost flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-all"
              >
                <Icon name={modelIcons[selectedModel] || 'smart_toy'} size={16} />
                {activeModel?.name || 'Sonnet 4.6'}
              </button>

              {/* Attach file button */}
              <button className="btn-ghost p-1.5 rounded-lg text-[var(--color-text-tertiary)]">
                <Icon name="attach_file" size={18} />
              </button>
            </div>

            {/* Run button */}
            <button className="bg-[var(--color-btn-primary-bg)] text-[var(--color-btn-primary-fg)] px-4 py-1.5 rounded-lg font-semibold text-[14px] flex items-center gap-2 hover:bg-[var(--color-btn-primary-bg-hover)] transition-colors">
              Run
              <Icon name="arrow_upward" size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* ─── Footer / Status Bar ───────────────────────────────── */}
      <footer className="bg-[var(--color-surface)] font-body text-[12px] tracking-tight fixed bottom-0 left-0 w-full h-8 border-t border-[var(--color-text-secondary)]/20 flex items-center justify-between px-4 z-[60]">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded-full bg-primary-fixed flex items-center justify-center">
              <Icon name="person" size={10} className="text-on-primary-fixed" />
            </div>
            <span className="text-outline">
              {mockStatusBar.user} &bull; {mockStatusBar.username} &bull; {mockStatusBar.plan}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button className="text-primary font-bold hover:bg-[var(--color-surface-container-low)] transition-colors px-2 py-0.5 rounded">
            {mockStatusBar.branch}
          </button>
          <button className="text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container-low)] transition-colors px-2 py-0.5 rounded">
            {mockStatusBar.worktreeToggle}
          </button>
          <button className="text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container-low)] transition-colors px-2 py-0.5 rounded">
            {mockStatusBar.localSwitch}
          </button>
        </div>
      </footer>
    </div>
  )
}
