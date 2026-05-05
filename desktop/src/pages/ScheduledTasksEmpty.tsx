import { useTranslation } from '../i18n'
import { mockStatusBar } from '../mocks/data'
import { Icon } from '../components/shared/Icon'

export function ScheduledTasksEmpty() {
  const t = useTranslation()
  return (
    <div className="bg-[var(--color-surface)] text-[var(--color-text-primary)] flex min-h-screen font-[var(--font-body)]">
      {/* SideNavBar */}
      <aside className="fixed left-0 top-0 h-full w-[280px] bg-[var(--color-surface-container-low)] flex flex-col p-4 gap-2 text-[14px] font-medium z-40">
        <div className="flex items-center gap-3 px-2 mb-6 mt-12">
          <div className="w-8 h-8 rounded bg-[var(--color-surface-container-high)] flex items-center justify-center">
            <span className="material-symbols-outlined text-[var(--color-text-secondary)]">filter_list</span>
          </div>
          <div>
            <div className="text-[var(--color-text-primary)] font-bold">{t('sidebar.allProjects')}</div>
            <div className="text-[10px] text-[var(--color-text-secondary)] uppercase tracking-widest">{t('scheduledPage.activeSession')}</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1">
          <div className="px-3 py-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-all rounded-lg cursor-pointer duration-200 ease-in-out flex items-center gap-3">
            <Icon name="add" size={18} />
            <span>{t('sidebar.newSession')}</span>
          </div>
          {/* Active State: Scheduled */}
          <div className="px-3 py-2 bg-[var(--color-surface)] text-[var(--color-text-primary)] rounded-lg relative before:content-[''] before:absolute before:left-[-8px] before:w-1 before:h-4 before:bg-[var(--color-primary)] before:rounded-full cursor-pointer duration-200 ease-in-out flex items-center gap-3">
            <Icon name="calendar_today" size={18} />
            <span>{t('sidebar.scheduled')}</span>
          </div>
          <div className="px-3 py-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-all rounded-lg cursor-pointer duration-200 ease-in-out flex items-center gap-3">
            <Icon name="history" size={18} />
            <span>{t('sidebar.timeGroup.today')}</span>
          </div>
          <div className="px-3 py-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-all rounded-lg cursor-pointer duration-200 ease-in-out flex items-center gap-3">
            <Icon name="event_note" size={18} />
            <span>{t('sidebar.timeGroup.last7days')}</span>
          </div>
          <div className="px-3 py-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-all rounded-lg cursor-pointer duration-200 ease-in-out flex items-center gap-3">
            <Icon name="archive" size={18} />
            <span>{t('sidebar.timeGroup.older')}</span>
          </div>
        </nav>

        <div className="mt-auto pt-4 border-t border-[var(--color-text-secondary)]/10">
          <div className="text-[10px] text-[var(--color-text-secondary)] uppercase tracking-widest px-3 mb-2">{t('scheduledPage.executionMode')}</div>
          <div className="px-3 py-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-all rounded-lg cursor-pointer duration-200 ease-in-out flex items-center gap-3">
            <Icon name="computer" size={18} />
            <span>{t('scheduledPage.localMode')}</span>
          </div>
          <div className="px-3 py-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-all rounded-lg cursor-pointer duration-200 ease-in-out flex items-center gap-3">
            <Icon name="cloud" size={18} />
            <span>{t('scheduledPage.remoteMode')}</span>
          </div>
        </div>
      </aside>

      {/* Main Canvas */}
      <main className="flex-1 ml-[280px] flex flex-col min-h-screen">
        {/* TopAppBar */}
        <header className="fixed top-0 right-0 left-[280px] z-30 bg-[var(--color-surface)] flex justify-between items-center px-6 h-12 w-full border-b border-[var(--color-surface-container-low)]">
          <div className="flex items-center gap-6 h-full">
            <div className="text-[14px] font-bold text-[var(--color-text-primary)] uppercase tracking-tighter font-[var(--font-headline)]">CyberCode</div>
            <nav className="flex items-center gap-4 h-full font-[var(--font-headline)] font-semibold tracking-wide text-[14px]">
              <span className="text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors cursor-pointer active:opacity-70 h-full flex items-center">{t('titlebar.code')}</span>
              <span className="text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors cursor-pointer active:opacity-70 h-full flex items-center">{t('titlebar.terminal')}</span>
              <span className="text-[var(--color-text-primary)] border-b-2 border-[var(--color-primary)] pb-1 h-full flex items-center pt-1">{t('titlebar.history')}</span>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <span className="material-symbols-outlined text-[var(--color-text-secondary)] text-[14px] cursor-pointer">arrow_back_ios</span>
              <span className="material-symbols-outlined text-[var(--color-text-secondary)] text-[14px] cursor-pointer">arrow_forward_ios</span>
            </div>
            <div className="h-4 w-[1px] bg-[var(--color-text-secondary)]/20"></div>
            <div className="text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors cursor-pointer text-[12px] font-semibold uppercase tracking-wider">{t('sidebar.settings')}</div>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 mt-12 mb-8 flex flex-col items-center justify-center p-8 bg-[var(--color-surface)]">
          <div className="max-w-2xl w-full text-center">
            <h1 className="text-3xl font-[var(--font-headline)] font-extrabold text-[var(--color-text-primary)] tracking-tight mb-16">{t('scheduledPage.title')}</h1>

            {/* Empty State Illustration/Card */}
            <div className="relative group">
              {/* Architectural Background Detail */}
              <div className="absolute -inset-4 bg-[var(--color-surface-container-low)] rounded-[13px] -z-10 transition-all"></div>
              <div className="flex flex-col items-center py-20 px-8">
                <div className="w-32 h-32 rounded-full bg-[var(--color-surface-container-high)] flex items-center justify-center mb-10 shadow-sm">
                  <div className="w-20 h-20 rounded-full bg-white flex items-center justify-center border-2 border-[var(--color-border)]/10">
                    <span
                      className="material-symbols-outlined text-[var(--color-primary)] text-5xl"
                      style={{ fontVariationSettings: "'wght' 300" }}
                    >
                      schedule
                    </span>
                  </div>
                </div>
                <p className="text-[var(--color-text-secondary)] font-[var(--font-body)] text-[18px] max-w-sm mx-auto leading-relaxed mb-12">
                  {t('tasks.emptyTitle')} {t('tasks.emptyDesc')}
                </p>
                <button className="group relative px-8 py-4 bg-[var(--color-primary)] text-[var(--color-on-primary)] rounded-md font-[var(--font-headline)] font-bold text-[14px] tracking-wide shadow-lg hover:shadow-[var(--color-primary)]/20 transition-all flex items-center gap-3 overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent opacity-30"></div>
                  <span className="material-symbols-outlined text-[18px]">add_task</span>
                  <span>{t('tasks.newTask')}</span>
                </button>
              </div>
            </div>

            {/* Subtle Decorative Bento Elements */}
            <div className="grid grid-cols-3 gap-4 mt-20 opacity-40">
              <div className="h-24 bg-[var(--color-surface-container-low)] rounded-md border-2 border-[var(--color-border)]/10 flex flex-col items-center justify-center p-4">
                <span className="material-symbols-outlined text-[var(--color-text-secondary)] mb-2">commit</span>
                <div className="w-12 h-1 bg-[var(--color-border)]/30 rounded-full"></div>
              </div>
              <div className="h-24 bg-[var(--color-surface-container-low)] rounded-md border-2 border-[var(--color-border)]/10 flex flex-col items-center justify-center p-4">
                <span className="material-symbols-outlined text-[var(--color-text-secondary)] mb-2">terminal</span>
                <div className="w-8 h-1 bg-[var(--color-border)]/30 rounded-full"></div>
              </div>
              <div className="h-24 bg-[var(--color-surface-container-low)] rounded-md border-2 border-[var(--color-border)]/10 flex flex-col items-center justify-center p-4">
                <span className="material-symbols-outlined text-[var(--color-text-secondary)] mb-2">code_blocks</span>
                <div className="w-10 h-1 bg-[var(--color-border)]/30 rounded-full"></div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="fixed bottom-0 left-0 w-full h-8 bg-[var(--color-surface)] flex items-center justify-between px-4 z-50 border-t border-[var(--color-text-secondary)]/20 font-[var(--font-body)] text-[12px] tracking-tight">
          <div className="flex items-center gap-3 text-[var(--color-text-secondary)]">
            <div className="w-2 h-2 rounded-full bg-[#677B4E]"></div>
            <span>{mockStatusBar.user} &bull; {mockStatusBar.username} &bull; {mockStatusBar.plan}</span>
          </div>
          <div className="flex items-center gap-6">
            <span className="text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container-low)] px-2 py-0.5 rounded transition-colors cursor-pointer flex items-center gap-1">
              <Icon name="account_tree" size={14} />
              {mockStatusBar.branch}
            </span>
            <span className="text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container-low)] px-2 py-0.5 rounded transition-colors cursor-pointer flex items-center gap-1">
              <Icon name="workspaces" size={14} />
              {mockStatusBar.worktreeToggle}
            </span>
            <span className="text-[var(--color-primary)] font-bold hover:bg-[var(--color-surface-container-low)] px-2 py-0.5 rounded transition-colors cursor-pointer flex items-center gap-1">
              <Icon name="toggle_on" size={14} />
              {mockStatusBar.localSwitch}
            </span>
          </div>
        </footer>
      </main>
    </div>
  )
}

