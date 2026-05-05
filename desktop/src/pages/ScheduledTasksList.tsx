import { useTranslation } from '../i18n'
import { mockScheduledTasks, mockStatusBar } from '../mocks/data'
import { Icon } from '../components/shared/Icon'

export function ScheduledTasksList() {
  const t = useTranslation()
  const { stats, tasks } = mockScheduledTasks
  const task0 = tasks[0]!
  const task1 = tasks[1]!
  const task2 = tasks[2]!

  return (
    <div className="bg-[var(--color-surface)] text-[var(--color-text-primary)] flex min-h-screen overflow-hidden font-[var(--font-body)]">
      {/* SideNavBar */}
      <aside className="fixed left-0 top-0 h-full w-[280px] bg-[var(--color-surface-container-low)] flex flex-col p-4 gap-2 z-40">
        <div className="mb-6 px-2 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[var(--color-primary-container)] flex items-center justify-center">
            <span
              className="material-symbols-outlined text-white"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              folder_managed
            </span>
          </div>
          <div>
            <h2 className="font-[var(--font-headline)] text-[14px] font-bold text-[var(--color-text-primary)] uppercase tracking-tighter">{t('sidebar.allProjects')}</h2>
            <p className="text-[12px] text-[var(--color-text-secondary)] font-medium">{t('scheduledPage.activeSession')}</p>
          </div>
        </div>

        <button className="flex items-center gap-3 px-3 py-2 w-full text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-all rounded-lg font-medium text-[14px] duration-200 ease-in-out">
          <Icon name="add" size={18} />
          {t('sidebar.newSession')}
        </button>
        <button className="flex items-center gap-3 px-3 py-2 w-full bg-[var(--color-surface)] text-[var(--color-text-primary)] rounded-lg relative before:content-[''] before:absolute before:left-[-8px] before:w-1 before:h-4 before:bg-[var(--color-primary)] before:rounded-full font-medium text-[14px] duration-200 ease-in-out">
          <span
            className="material-symbols-outlined"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            calendar_today
          </span>
          {t('sidebar.scheduled')}
        </button>
        <button className="flex items-center gap-3 px-3 py-2 w-full text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-all rounded-lg font-medium text-[14px] duration-200 ease-in-out">
          <Icon name="history" size={18} />
          {t('sidebar.timeGroup.today')}
        </button>
        <button className="flex items-center gap-3 px-3 py-2 w-full text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-all rounded-lg font-medium text-[14px] duration-200 ease-in-out">
          <Icon name="event_note" size={18} />
          {t('sidebar.timeGroup.last7days')}
        </button>
        <button className="flex items-center gap-3 px-3 py-2 w-full text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-all rounded-lg font-medium text-[14px] duration-200 ease-in-out">
          <Icon name="archive" size={18} />
          {t('sidebar.timeGroup.older')}
        </button>

        <div className="mt-auto pt-4 flex flex-col gap-2">
          <div className="px-2 py-4">
            <button className="w-full bg-[var(--color-surface-container-high)] text-[var(--color-text-primary)] font-[var(--font-headline)] text-[12px] font-bold py-2 rounded-lg flex items-center justify-center gap-2 hover:bg-[var(--color-surface-container-high)] transition-colors">
              <span className="material-symbols-outlined text-[16px]">search</span>
              {t('sidebar.searchPlaceholder')}
            </button>
          </div>
          <div className="h-[1px] bg-[var(--color-border)]/20 mx-2 mb-2"></div>
          <button className="flex items-center gap-3 px-3 py-2 w-full text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-all rounded-lg font-medium text-[14px] duration-200 ease-in-out">
            <Icon name="computer" size={18} />
            {t('scheduledPage.localMode')}
          </button>
          <button className="flex items-center gap-3 px-3 py-2 w-full text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-all rounded-lg font-medium text-[14px] duration-200 ease-in-out">
            <Icon name="cloud" size={18} />
            {t('scheduledPage.remoteMode')}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col ml-[280px] min-w-0 h-screen">
        {/* TopAppBar */}
        <header className="bg-[var(--color-surface)] h-12 w-full flex justify-between items-center px-6 z-30">
          <div className="flex items-center gap-8">
            <div className="font-[var(--font-headline)] font-bold text-[var(--color-text-primary)] uppercase tracking-tighter text-[14px]">CyberCode</div>
            <nav className="flex items-center gap-6 font-[var(--font-headline)] font-semibold tracking-wide text-[14px]">
              <a className="text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors" href="#">{t('titlebar.code')}</a>
              <a className="text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors" href="#">{t('titlebar.terminal')}</a>
              <a className="text-[var(--color-text-primary)] border-b-2 border-[var(--color-primary)] pb-1" href="#">{t('titlebar.history')}</a>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <button className="p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors cursor-pointer active:opacity-70">
                <span className="material-symbols-outlined text-[16px]">arrow_back_ios</span>
              </button>
              <button className="p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors cursor-pointer active:opacity-70">
                <span className="material-symbols-outlined text-[16px]">arrow_forward_ios</span>
              </button>
            </div>
            <button className="font-[var(--font-headline)] font-semibold tracking-wide text-[14px] text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors cursor-pointer active:opacity-70 flex items-center gap-1">
              <span className="material-symbols-outlined text-[18px]">settings</span>
              {t('sidebar.settings')}
            </button>
          </div>
        </header>

        {/* Separation Line */}
        <div className="bg-[var(--color-surface-container-low)] h-[1px] w-full"></div>

        {/* Scrollable Content */}
        <section className="flex-1 overflow-y-auto p-12 bg-[var(--color-surface)]">
          <div className="max-w-5xl mx-auto">
            {/* Page Header */}
            <div className="flex justify-between items-end mb-12">
              <div className="space-y-1">
                <h1 className="font-[var(--font-headline)] text-3xl font-bold tracking-tight text-[var(--color-text-primary)]">{t('scheduledPage.title')}</h1>
                <p className="text-[var(--color-text-secondary)] text-[14px]">{t('scheduledPage.subtitle')}</p>
              </div>
              <button className="bg-[var(--color-primary)] hover:bg-[var(--color-primary-container)] text-[var(--color-on-primary)] px-5 py-2.5 rounded-lg flex items-center gap-2 transition-all shadow-sm font-medium text-[14px]">
                <span className="material-symbols-outlined text-[18px]">add_task</span>
                {t('tasks.createNew')}
              </button>
            </div>

            {/* Bento-style Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
              {/* Total Tasks */}
              <div className="bg-[var(--color-surface-container-low)] p-6 rounded-md border-2 border-[var(--color-border)]/10">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[12px] font-bold uppercase tracking-widest text-[var(--color-text-secondary)]">{t('tasks.totalTasks')}</span>
                  <span className="material-symbols-outlined text-[var(--color-primary)]">analytics</span>
                </div>
                <div className="text-4xl font-[var(--font-headline)] font-extrabold text-[var(--color-text-primary)]">{stats.totalTasks}</div>
                <div className="mt-2 flex items-center gap-1 text-[10px] text-[#4F6237] font-bold bg-[#677B4E]/20 px-2 py-0.5 rounded-full w-fit">
                  <Icon name="trending_up" size={10} />
                  {t('scheduledPage.thisMonth', { count: '+2' })}
                </div>
              </div>

              {/* Next Run */}
              <div className="bg-[var(--color-surface-container-low)] p-6 rounded-md border-2 border-[var(--color-border)]/10">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[12px] font-bold uppercase tracking-widest text-[var(--color-text-secondary)]">{t('scheduledPage.nextRun')}</span>
                  <span className="material-symbols-outlined text-[#2D628F]">schedule</span>
                </div>
                <div className="text-xl font-[var(--font-headline)] font-bold text-[var(--color-text-primary)]">{stats.nextRun.name}</div>
                <p className="text-[14px] font-[JetBrains_Mono,monospace] text-[#2D628F] mt-1">{stats.nextRun.time}</p>
              </div>

              {/* System Health */}
              <div className="bg-[var(--color-surface-container-low)] p-6 rounded-md border-2 border-[var(--color-border)]/10">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[12px] font-bold uppercase tracking-widest text-[var(--color-text-secondary)]">{t('scheduledPage.systemHealth')}</span>
                  <span className="material-symbols-outlined text-[#4F6237]">check_circle</span>
                </div>
                <div className="text-4xl font-[var(--font-headline)] font-extrabold text-[var(--color-text-primary)]">{stats.systemHealth}%</div>
                <p className="text-[12px] text-[var(--color-text-secondary)] mt-2 font-medium">{stats.healthPeriod}</p>
              </div>
            </div>

            {/* Operational Tasks Table */}
            <div className="bg-white rounded-md overflow-hidden border-2 border-[var(--color-border)]/20 shadow-[0_4px_20px_rgba(27,28,26,0.04)]">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[var(--color-surface-container-low)]/50">
                    <th className="px-6 py-4 text-[12px] font-bold uppercase tracking-widest text-[var(--color-border)] border-b border-[var(--color-border)]/10">{t('scheduledPage.colTaskName')}</th>
                    <th className="px-6 py-4 text-[12px] font-bold uppercase tracking-widest text-[var(--color-border)] border-b border-[var(--color-border)]/10">{t('scheduledPage.colFrequency')}</th>
                    <th className="px-6 py-4 text-[12px] font-bold uppercase tracking-widest text-[var(--color-border)] border-b border-[var(--color-border)]/10">{t('scheduledPage.colLastResult')}</th>
                    <th className="px-6 py-4 text-[12px] font-bold uppercase tracking-widest text-[var(--color-border)] border-b border-[var(--color-border)]/10">{t('scheduledPage.colNextExecution')}</th>
                    <th className="px-6 py-4 text-[12px] font-bold uppercase tracking-widest text-[var(--color-border)] border-b border-[var(--color-border)]/10 text-right">{t('scheduledPage.colActions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]/5">
                  {/* Task Row 1 - Nightly linting */}
                  <tr className="group hover:bg-[var(--color-surface-container-low)]/30 transition-colors">
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-[var(--color-primary-fixed)] text-[var(--color-primary)] rounded-lg">
                          <span className="material-symbols-outlined text-[1.2rem]">code_blocks</span>
                        </div>
                        <div>
                          <div className="font-[var(--font-headline)] font-bold text-[var(--color-text-primary)] text-[14px]">{task0.name}</div>
                          <div className="text-[12px] text-[var(--color-text-secondary)] font-medium">Root: /projects/companion/src</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <span className="px-2.5 py-1 bg-[var(--color-surface-container-high)] rounded-full text-[12px] font-semibold text-[var(--color-text-secondary)]">{task0.frequency}</span>
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-1.5 text-[#4F6237] text-[12px] font-bold">
                        <span
                          className="material-symbols-outlined text-[16px]"
                          style={{ fontVariationSettings: "'FILL' 1" }}
                        >
                          check_circle
                        </span>
                        {task0.lastResult}
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <div className="font-[JetBrains_Mono,monospace] text-[14px] font-medium text-[#2D628F]">{task0.nextExecution}</div>
                    </td>
                    <td className="px-6 py-5 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button className="p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors">
                          <span className="material-symbols-outlined text-[18px]">edit</span>
                        </button>
                        <button className="p-2 text-[var(--color-text-secondary)] hover:text-[#BA1A1A] transition-colors">
                          <span className="material-symbols-outlined text-[18px]">delete</span>
                        </button>
                        <button className="p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors">
                          <span className="material-symbols-outlined text-[18px]">more_vert</span>
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* Task Row 2 - Clean up temp files */}
                  <tr className="group hover:bg-[var(--color-surface-container-low)]/30 transition-colors">
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-[#CFE5FF] text-[#094A76] rounded-lg">
                          <span className="material-symbols-outlined text-[1.2rem]">cleaning_services</span>
                        </div>
                        <div>
                          <div className="font-[var(--font-headline)] font-bold text-[var(--color-text-primary)] text-[14px]">{task1.name}</div>
                          <div className="text-[12px] text-[var(--color-text-secondary)] font-medium">{task1.description}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <span className="px-2.5 py-1 bg-[var(--color-surface-container-high)] rounded-full text-[12px] font-semibold text-[var(--color-text-secondary)]">{task1.frequency}</span>
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-1.5 text-[#4F6237] text-[12px] font-bold">
                        <span
                          className="material-symbols-outlined text-[16px]"
                          style={{ fontVariationSettings: "'FILL' 1" }}
                        >
                          check_circle
                        </span>
                        {task1.lastResult}
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <div className="font-[JetBrains_Mono,monospace] text-[14px] font-medium text-[#2D628F]">{task1.nextExecution}</div>
                    </td>
                    <td className="px-6 py-5 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button className="p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors">
                          <span className="material-symbols-outlined text-[18px]">edit</span>
                        </button>
                        <button className="p-2 text-[var(--color-text-secondary)] hover:text-[#BA1A1A] transition-colors">
                          <span className="material-symbols-outlined text-[18px]">delete</span>
                        </button>
                        <button className="p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors">
                          <span className="material-symbols-outlined text-[18px]">more_vert</span>
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* Task Row 3 - Database Vacuum */}
                  <tr className="group hover:bg-[var(--color-surface-container-low)]/30 transition-colors">
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-[#D4EAB4] text-[#3B4C24] rounded-lg">
                          <span className="material-symbols-outlined text-[1.2rem]">database</span>
                        </div>
                        <div>
                          <div className="font-[var(--font-headline)] font-bold text-[var(--color-text-primary)] text-[14px]">{task2.name}</div>
                          <div className="text-[12px] text-[var(--color-text-secondary)] font-medium">{task2.description}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <span className="px-2.5 py-1 bg-[var(--color-surface-container-high)] rounded-full text-[12px] font-semibold text-[var(--color-text-secondary)]">Monthly</span>
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-1.5 text-[#BA1A1A] text-[12px] font-bold">
                        <span
                          className="material-symbols-outlined text-[16px]"
                          style={{ fontVariationSettings: "'FILL' 1" }}
                        >
                          error
                        </span>
                        {task2.lastResult}
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <div className="font-[JetBrains_Mono,monospace] text-[14px] font-medium text-[#2D628F]">{task2.nextExecution}</div>
                    </td>
                    <td className="px-6 py-5 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button className="p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors">
                          <span className="material-symbols-outlined text-[18px]">edit</span>
                        </button>
                        <button className="p-2 text-[var(--color-text-secondary)] hover:text-[#BA1A1A] transition-colors">
                          <span className="material-symbols-outlined text-[18px]">delete</span>
                        </button>
                        <button className="p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors">
                          <span className="material-symbols-outlined text-[18px]">more_vert</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* End of list placeholder */}
              <div className="p-12 text-center border-t border-[var(--color-border)]/10">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[var(--color-surface-container-low)] mb-4">
                  <span className="material-symbols-outlined text-[var(--color-text-secondary)]">history_toggle_off</span>
                </div>
                <h3 className="font-[var(--font-headline)] font-bold text-[var(--color-text-primary)] text-[16px]">{t('scheduledPage.endOfList')}</h3>
                <p className="text-[14px] text-[var(--color-text-secondary)] max-w-xs mx-auto mt-1">{t('scheduledPage.pausedTasks')}</p>
              </div>
            </div>

            {/* System Logs / Details Panel */}
            <div className="mt-12 flex flex-col md:flex-row gap-8 items-start">
              {/* Recent Output Logs */}
              <div className="flex-1 space-y-6">
                <h2 className="font-[var(--font-headline)] text-[18px] font-bold text-[var(--color-text-primary)]">{t('scheduledPage.recentLogs')}</h2>
                <div className="bg-[var(--color-surface-dim)] rounded-md p-6 font-[JetBrains_Mono,monospace] text-[13px] leading-relaxed text-[var(--color-text-secondary)] overflow-x-auto shadow-inner">
                  <div className="flex gap-4 opacity-50 mb-1">
                    <span className="w-32 shrink-0">2023-11-10 23:01</span>
                    <span className="text-[#4F6237]">[INFO]</span>
                    <span>Nightly linting started for repository: companion-main</span>
                  </div>
                  <div className="flex gap-4 mb-1">
                    <span className="w-32 shrink-0">2023-11-10 23:04</span>
                    <span className="text-[#4F6237]">[INFO]</span>
                    <span>Processed 1,422 files. No critical issues found.</span>
                  </div>
                  <div className="flex gap-4 mb-1">
                    <span className="w-32 shrink-0">2023-11-10 23:04</span>
                    <span className="text-[#094A76]">[WARN]</span>
                    <span className="italic">Found 12 deprecated calls in /legacy/utils.js</span>
                  </div>
                  <div className="flex gap-4 mb-1">
                    <span className="w-32 shrink-0">2023-11-10 23:05</span>
                    <span className="text-[#4F6237]">[INFO]</span>
                    <span>Task completed successfully in 242.4s.</span>
                  </div>
                  <div className="mt-4 pt-4 border-t border-[var(--color-border)]/20 flex items-center justify-between">
                    <span className="text-[11px] uppercase tracking-tighter opacity-50">Log stream: active</span>
                    <button className="text-[var(--color-primary)] font-bold text-[12px] hover:underline">{t('scheduledPage.viewArtifacts')}</button>
                  </div>
                </div>
              </div>

              {/* Resource Allocation Panel */}
              <div className="w-full md:w-80 shrink-0">
                <div className="bg-[var(--color-primary-container)]/10 p-6 rounded-md border border-[var(--color-primary)]/10">
                  <h3 className="font-[var(--font-headline)] font-bold text-[var(--color-primary)] text-[14px] mb-3">{t('scheduledPage.resourceAllocation')}</h3>
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider">
                        <span>{t('scheduledPage.cpuCapacity')}</span>
                        <span>42%</span>
                      </div>
                      <div className="w-full h-1 bg-[var(--color-border)]/30 rounded-full overflow-hidden">
                        <div className="h-full bg-[var(--color-primary)]" style={{ width: '42%' }}></div>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider">
                        <span>{t('scheduledPage.memoryLoad')}</span>
                        <span>68%</span>
                      </div>
                      <div className="w-full h-1 bg-[var(--color-border)]/30 rounded-full overflow-hidden">
                        <div className="h-full bg-[#2D628F]" style={{ width: '68%' }}></div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-6">
                    <div className="w-full h-24 rounded-lg bg-gradient-to-br from-[var(--color-primary-fixed)] via-[var(--color-primary-fixed-dim)]/40 to-[var(--color-border)]/20"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="bg-[var(--color-surface)] border-t border-[var(--color-text-secondary)]/20 fixed bottom-0 left-0 w-full h-8 flex items-center justify-between px-4 z-50">
          <div className="flex items-center gap-4">
            <span className="font-[var(--font-body)] text-[12px] tracking-tight text-[var(--color-text-secondary)]">{mockStatusBar.user} &bull; {mockStatusBar.username} &bull; {mockStatusBar.plan}</span>
            <div className="h-3 w-[1px] bg-[var(--color-text-secondary)]/30"></div>
            <div className="flex items-center gap-2">
              <span
                className="material-symbols-outlined text-[10px] text-[#4F6237]"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                fiber_manual_record
              </span>
              <span className="font-[var(--font-body)] text-[12px] tracking-tight text-[var(--color-text-primary)]">{t('scheduledPage.connectedLocal')}</span>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <button className="font-[var(--font-body)] text-[12px] tracking-tight text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container-low)] px-2 py-0.5 rounded transition-colors flex items-center gap-1">
              <Icon name="account_tree" size={12} />
              {mockStatusBar.branch}
            </button>
            <button className="font-[var(--font-body)] text-[12px] tracking-tight text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container-low)] px-2 py-0.5 rounded transition-colors flex items-center gap-1">
              <Icon name="layers" size={12} />
              {mockStatusBar.worktreeToggle}
            </button>
            <button className="font-[var(--font-body)] text-[12px] tracking-tight text-[var(--color-primary)] font-bold hover:bg-[var(--color-surface-container-low)] px-2 py-0.5 rounded transition-colors flex items-center gap-1">
              <Icon name="toggle_on" size={12} />
              {mockStatusBar.localSwitch}
            </button>
          </div>
        </footer>
      </main>
    </div>
  )
}

