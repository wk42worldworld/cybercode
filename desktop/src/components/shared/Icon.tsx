/**
 * Single icon entrypoint for desktop UI.
 *
 * The app uses VS Code Codicons exclusively so chrome, settings, chat, and task
 * surfaces share the same visual language.
 */
import '@vscode/codicons/dist/codicon.css'

export const ICONS = {
  account_tree: 'git-branch',
  add: 'add',
  add_task: 'checklist',
  alternate_email: 'mention',
  analytics: 'graph-line',
  architecture: 'type-hierarchy',
  archive: 'archive',
  arrow_back: 'arrow-left',
  arrow_back_ios: 'chevron-left',
  arrow_forward: 'arrow-right',
  arrow_forward_ios: 'chevron-right',
  arrow_outward: 'link-external',
  arrow_upward: 'arrow-up',
  article: 'file-text',
  attach_file: 'attach',
  auto_awesome: 'sparkle',
  bolt: 'run',
  bookmarks: 'bookmark',
  bug_report: 'bug',
  build: 'tools',
  calendar_month: 'calendar',
  calendar_today: 'calendar',
  cancel: 'error',
  chat: 'comment',
  check: 'check',
  check_circle: 'pass-filled',
  checklist: 'checklist',
  chevron_left: 'chevron-left',
  chevron_right: 'chevron-right',
  clean: 'clear-all',
  cleaning_services: 'clear-all',
  close: 'chrome-close',
  close_one: 'close',
  cloud: 'cloud',
  cloud_download: 'cloud-download',
  code: 'file-code',
  code_blocks: 'file-code',
  commit: 'git-commit',
  computer: 'device-desktop',
  content_copy: 'copy',
  content_cut: 'screen-cut',
  copy_all: 'copy',
  create_new_folder: 'new-folder',
  database: 'database',
  delete: 'trash',
  description: 'file-text',
  desktop_windows: 'device-desktop',
  dns: 'server',
  download: 'cloud-download',
  edit: 'edit',
  edit_document: 'new-file',
  edit_note: 'edit',
  error: 'error',
  error_outline: 'error',
  event_note: 'calendar',
  expand_less: 'chevron-up',
  expand_more: 'chevron-down',
  extension: 'extensions',
  extension_off: 'extensions',
  feedback: 'comment-discussion',
  fiber_manual_record: 'circle-filled',
  file_present: 'file',
  file_upload: 'cloud-upload',
  filter: 'filter',
  filter_alt: 'filter',
  filter_list: 'list-filter',
  find_in_page: 'search',
  folder: 'folder',
  folder_lock: 'folder',
  folder_managed: 'folder',
  folder_open: 'folder-opened',
  forum: 'comment-discussion',
  fullscreen: 'screen-full',
  fullscreen_exit: 'screen-normal',
  gavel: 'law',
  github: 'github',
  groups: 'organization',
  hash: 'symbol-key',
  help: 'question',
  help_outline: 'question',
  history: 'history',
  history_toggle_off: 'history',
  hub: 'remote',
  hourglass_empty: 'watch',
  image: 'file-media',
  image_search: 'file-media',
  info: 'info',
  inventory_2: 'archive',
  keyboard_double_arrow_right: 'chevron-right',
  label: 'tag',
  layers: 'layers',
  layout: 'layout',
  link: 'link',
  loading: 'loading',
  lock: 'lock',
  lock_open: 'unlock',
  logout: 'sign-out',
  manage_accounts: 'account',
  manage_search: 'search',
  memory: 'chip',
  menu: 'menu',
  monitor: 'device-desktop',
  mop: 'clear-all',
  more_horiz: 'ellipsis',
  more_vert: 'kebab-vertical',
  mouse: 'device-desktop',
  note: 'file-text',
  open_in_new: 'link-external',
  package: 'archive',
  pause: 'debug-pause',
  pause_circle: 'debug-pause',
  pending: 'loading',
  person: 'account',
  photo: 'file-media',
  play_arrow: 'run',
  play_circle: 'run',
  plug_one: 'plug',
  power_off: 'debug-disconnect',
  power_settings_new: 'debug-disconnect',
  progress_activity: 'loading',
  psychology: 'hubot',
  radio_button_checked: 'circle-large-filled',
  radio_button_unchecked: 'circle-large-outline',
  receipt_long: 'file-text',
  redo: 'redo',
  refresh: 'sync',
  remove: 'trash',
  replay: 'debug-restart',
  restart_alt: 'debug-restart',
  rotate_left: 'debug-restart',
  route: 'remote-explorer',
  save: 'save',
  schedule: 'clockface',
  science: 'beaker',
  search: 'search',
  send: 'arrow-up',
  settings: 'gear',
  shield: 'shield',
  smart_toy: 'robot',
  source: 'file-code',
  star: 'star-full',
  stop: 'debug-stop',
  stop_circle: 'debug-stop',
  storage: 'database',
  sync: 'sync',
  tag: 'tag',
  task_alt: 'pass-filled',
  terminal: 'terminal',
  timer_off: 'watch',
  tips_and_updates: 'lightbulb',
  toggle_on: 'circle-large-filled',
  trending_up: 'graph-line',
  travel_explore: 'globe',
  tune: 'settings-gear',
  undo: 'discard',
  unfold_more: 'chevron-down',
  verified: 'verified',
  verified_user: 'verified',
  visibility: 'eye',
  visibility_off: 'eye-closed',
  view_column: 'layout-panel',
  view_sidebar: 'layout-sidebar-left',
  view_sidebar_off: 'layout-sidebar-left-off',
  warning: 'warning',
  wifi: 'broadcast',
  window_maximize: 'chrome-maximize',
  window_minimize: 'chrome-minimize',
  window_restore: 'chrome-restore',
  workspaces: 'project',
} as const

export type IconName = keyof typeof ICONS

export function getCodiconName(name: string): string | undefined {
  return ICONS[name.trim() as IconName]
}

type IconProps = {
  name: IconName | (string & {})
  size?: number
  className?: string
  style?: React.CSSProperties
}

const warnedMissingIcons = new Set<string>()

export function Icon({ name, size = 18, className, style }: IconProps) {
  const codicon = getCodiconName(name)
  if (!codicon) {
    if (import.meta.env.DEV && !warnedMissingIcons.has(name)) {
      warnedMissingIcons.add(name)
      console.warn(`[Icon] Unknown icon name: ${name}`)
    }

    return (
      <span
        className={`inline-flex items-center justify-center ${className ?? ''}`}
        style={{ width: size, height: size, ...style }}
        aria-hidden="true"
      />
    )
  }

  const shouldSpin = codicon === 'loading' || className?.includes('animate-spin')
  return (
    <span
      className={`codicon codicon-${codicon}${shouldSpin ? ' codicon-modifier-spin' : ''} ${className ?? ''}`}
      style={{
        fontSize: size,
        width: size,
        height: size,
        lineHeight: `${size}px`,
        ...style,
      }}
      aria-hidden="true"
    />
  )
}
