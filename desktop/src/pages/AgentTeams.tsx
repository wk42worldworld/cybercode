import { useState } from 'react'
import { mockTeam, mockTeamMessages } from '../mocks/data'
import { Icon } from '../components/shared/Icon'

// ─── Inline keyframes for pulse-subtle animation ─────────────────
const pulseSubtleStyle = `
@keyframes pulse-subtle {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; transform: scale(0.98); }
}
.animate-pulse-subtle {
  animation: pulse-subtle 2s ease-in-out infinite;
}
`

export function AgentTeams() {
  const [inputValue, setInputValue] = useState('')

  return (
    <>
      <style>{pulseSubtleStyle}</style>

      <div className="flex-1 flex flex-col relative overflow-hidden bg-[var(--color-surface)] text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-body)' }}>
        {/* Code Content Area */}
        <div className="flex-1 overflow-y-auto p-6 md:p-10 max-w-5xl mx-auto w-full">
          <div className="space-y-8">
            {/* ─── Message Thread ─── */}
            <div className="space-y-6">
              {/* USER message */}
              <div className="flex gap-4 group">
                <div className="w-8 h-8 rounded-full bg-[var(--color-surface-container-high)] flex-shrink-0 flex items-center justify-center text-[var(--color-text-primary)] font-bold text-[12px] border border-[var(--color-brand)]/30">
                  U
                </div>
                <div className="space-y-2">
                  <p className="text-[12px] font-semibold text-[var(--color-text-tertiary)] uppercase tracking-widest">
                    User
                  </p>
                  <p className="text-[var(--color-text-primary)] leading-relaxed">
                    {mockTeamMessages.userMessage}
                  </p>
                </div>
              </div>

              {/* CyberCode response */}
              <div className="flex gap-4 group">
                <div className="w-8 h-8 rounded-full bg-[var(--color-surface-container-high)] flex-shrink-0 flex items-center justify-center text-[var(--color-brand)] border border-[var(--color-brand)]/30">
                  <Icon name="smart_toy" size={14} />
                </div>
                <div className="space-y-4 flex-1">
                  <p className="text-[12px] font-semibold text-[var(--color-text-tertiary)] uppercase tracking-widest">
                    CyberCode
                  </p>
                  <div className="rounded-xl border border-[var(--color-border-separator)] bg-[var(--color-background)] p-5 shadow-[var(--shadow-dropdown)]">
                    <p className="mb-4 text-[var(--color-text-primary)]">
                      {mockTeamMessages.assistantMessage}
                    </p>
                    <div className="rounded-lg bg-[var(--color-surface-container-lowest)] p-4 font-[var(--font-mono)] text-[13px] text-[var(--color-text-secondary)] overflow-x-auto border border-[var(--color-border)]/10">
                      <span className="text-[var(--color-brand)]">info:</span> spawning child_processes for parallel development
                      <br />
                      <span className="text-[var(--color-text-secondary)]">active:</span> session-dev cluster initiated
                      <br />
                      <span className="text-[var(--color-text-tertiary)]">ready:</span> 4 agents assigned
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ─── TEAM STRIP ─── */}
            <div className="relative py-8">
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px bg-[var(--color-border-separator)]" />

              <div className="relative rounded-xl border border-[var(--color-border-separator)] bg-[var(--color-background)] p-4 flex flex-col md:flex-row md:items-center gap-4 overflow-hidden shadow-[var(--shadow-dropdown)]">
                {/* Team label */}
                <div className="flex items-center gap-3 pr-4 md:border-r border-[var(--color-border-separator)]">
                  <div className="p-2 bg-[var(--color-brand)]/10 rounded-lg border border-[var(--color-brand)]/20">
                    <Icon name="groups" size={20} className="text-[var(--color-brand)]" />
                  </div>
                  <div>
                    <h3 className="text-[14px] font-bold text-[var(--color-text-primary)]">
                      Team: {mockTeam.name}
                    </h3>
                    <p className="text-[11px] font-medium text-[var(--color-text-tertiary)] uppercase tracking-tighter">
                      {mockTeam.memberCount} members
                    </p>
                  </div>
                </div>

                {/* Agent Chips — accent border on avatars, colored status dots */}
                <div className="flex flex-wrap gap-2 items-center flex-1">
                  {mockTeam.members.map((member) => {
                    if (member.status === 'completed') {
                      return (
                        <div
                          key={member.id}
                          className="flex items-center gap-2 px-3 py-1.5 bg-[var(--color-surface-container-high)] rounded-full border border-[var(--color-success)]/30 group hover:border-[var(--color-success)]/60 transition-all cursor-pointer"
                        >
                          <div className="w-2 h-2 rounded-full bg-[var(--color-success)]" style={{ boxShadow: '0 0 6px var(--color-success)' }} />
                          <span className="text-[12px] font-semibold text-[var(--color-text-primary)]">
                            {member.role}
                          </span>
                          <Icon name="check_circle" size={14} className="text-[var(--color-success)]" />
                        </div>
                      )
                    }

                    if (member.status === 'running') {
                      return (
                        <div
                          key={member.id}
                          className="flex items-center gap-2 px-3 py-1.5 bg-[var(--color-surface-container-high)] rounded-full border border-[var(--color-brand)]/30 animate-pulse-subtle group hover:border-[var(--color-brand)]/60 transition-all cursor-pointer"
                        >
                          <div className="w-2 h-2 rounded-full bg-[var(--color-brand)] animate-pulse-dot" style={{ boxShadow: '0 0 6px var(--color-brand)' }} />
                          <span className="text-[12px] font-semibold text-[var(--color-text-primary)]">
                            {member.role}
                          </span>
                          <Icon name="sync" size={14} className="text-[var(--color-brand)]" />
                        </div>
                      )
                    }

                    return (
                      <div
                        key={member.id}
                        className="flex items-center gap-2 px-3 py-1.5 bg-[var(--color-surface-container-low)] rounded-full border border-[var(--color-border)] group hover:border-[var(--color-brand)]/40 transition-all cursor-pointer"
                      >
                        <div className="w-2 h-2 rounded-full bg-[var(--color-text-tertiary)]" />
                        <span className="text-[12px] font-semibold text-[var(--color-text-tertiary)] group-hover:text-[var(--color-text-primary)]">
                          {member.role}
                        </span>
                        <Icon name={member.role === 'Tester' ? 'schedule' : 'pause_circle'} size={14} className="text-[var(--color-text-tertiary)]" />
                      </div>
                    )
                  })}
                </div>

                {/* Expand button — ghost style */}
                <button className="btn-ghost ml-auto p-2 rounded-full text-[var(--color-text-tertiary)]">
                  <Icon name="expand_more" size={14} />
                </button>
              </div>
            </div>

            {/* ─── Chat Composer ─── */}
            <div className="max-w-3xl mx-auto w-full mt-auto">
              <div className="relative rounded-xl border border-[var(--color-border-separator)] bg-[var(--color-background)] p-1.5 flex items-center gap-2 transition-all shadow-[var(--shadow-dropdown)]">
                <div className="p-2 text-[var(--color-text-secondary)]">
                  <Icon name="attach_file" size={18} />
                </div>
                <input
                  className="flex-1 bg-transparent border-none focus:ring-0 focus:outline-none text-[14px] text-[var(--color-text-primary)] py-2"
                  placeholder="Type a command or ask CyberCode..."
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                />
                <button className="bg-[var(--color-btn-primary-bg)] text-[var(--color-btn-primary-fg)] w-9 h-9 rounded-lg flex items-center justify-center transition-all hover:bg-[var(--color-btn-primary-bg-hover)] active:scale-95">
                  <Icon name="arrow_upward" size={18} />
                </button>
              </div>
              <div className="mt-3 flex justify-center gap-4">
                <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-tertiary)] font-semibold uppercase tracking-widest">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)]" />
                  Auto-run enabled
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-tertiary)] font-semibold uppercase tracking-widest">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-brand)]" />
                  Local LLM
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
