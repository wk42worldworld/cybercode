/**
 * Unified icon component — ByteDance IconPark (@icon-park/react).
 * Maps Material Symbol names → IconPark components.
 */
import type { ComponentType } from 'react'
import {
  AddOne, Close, CloseOne, Down, Up, Right, Left,
  Return, ArrowRight, LinkRight, EfferentThree,
  Config, Terminal, Time, Calendar, HamburgerButton,
  CheckOne, CheckCorrect, Caution, Info, Help, Loading,
  Square, Play, Pause,
  Undo, Redo, Rotate,
  FileEditingOne, FileAdditionOne, FileTextOne, FileSearchOne,
  Search, Robot, Brain, Asterisk,
  Shield, Flashlight, Lock, Unlock, Logout, Gavel, HammerAndAnvil,
  FolderOpen, Folder, CategoryManagement,
  SixPoints, LayoutOne, More, Filter, Pound, AtSign,
  Comment, Connect, Plug, PlugOne, Mouse, Send, LinkThree,
  Browser, Wifi,
  Data, Bug, Code, History,
  Copy, Edit, Delete,
  Eyes, Tips, PersonalCollection,
  Monitor, PictureOne, Power, ListCheckbox, Like,
  Download, Upload, Refresh,
  FullScreenOne, OffScreenOne, PageTemplate,
} from '@icon-park/react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IP = ComponentType<any>

const MAP: Record<string, IP> = {
  add: AddOne,
  close: Close,
  close_one: CloseOne,
  expand_more: Down,
  expand_less: Up,
  chevron_right: Right,
  chevron_left: Left,
  arrow_back: Return,
  arrow_forward: ArrowRight,
  arrow_outward: LinkRight,

  settings: Config,
  tune: Config,
  terminal: Terminal,
  schedule: Time,
  calendar_month: Calendar,
  menu: HamburgerButton,

  check_circle: CheckOne,
  task_alt: CheckOne,
  radio_button_unchecked: Close,
  error: Caution,
  error_outline: Caution,
  warning: Caution,
  info: Info,
  help: Help,
  help_outline: Help,
  pending: Loading,
  check: CheckCorrect,
  refresh: Refresh,
  sync: Refresh,
  loading: Loading,
  restart_alt: Rotate,
  replay: Rotate,
  rotate_left: Rotate,

  stop: Square,
  stop_circle: Square,
  play_arrow: Play,
  pause: Pause,

  undo: Undo,
  redo: Redo,
  build: HammerAndAnvil,
  edit_note: FileEditingOne,
  edit_document: FileAdditionOne,
  description: FileTextOne,
  article: FileTextOne,
  note: FileTextOne,
  file_upload: Upload,
  file_present: FileTextOne,
  code: Code,
  code_blocks: Code,
  save: FileEditingOne,
  content_cut: Delete,
  mop: Refresh,
  cleaning_services: Refresh,

  search: Search,
  find_in_page: FileSearchOne,
  manage_search: Search,

  smart_toy: Robot,
  psychology: Brain,
  auto_awesome: Asterisk,

  verified_user: Shield,
  gavel: Gavel,
  bolt: Flashlight,
  shield: Shield,
  lock: Lock,
  lock_open: Unlock,
  logout: Logout,

  attach_file: LinkThree,
  folder_open: FolderOpen,
  folder: Folder,
  folder_lock: Folder,
  inventory_2: CategoryManagement,
  archive: CategoryManagement,
  package: CategoryManagement,

  architecture: SixPoints,
  layers: SixPoints,
  layout: LayoutOne,
  view_sidebar: PageTemplate,
  view_column: PageTemplate,
  fullscreen: FullScreenOne,
  fullscreen_exit: OffScreenOne,
  more_horiz: More,
  filter_alt: Filter,
  hash: Pound,
  alternate_email: AtSign,

  chat: Comment,
  hub: Connect,
  send: Send,
  feedback: Comment,
  link: LinkThree,
  open_in_new: EfferentThree,
  travel_explore: Browser,
  cloud_download: Download,
  wifi: Wifi,
  dns: Connect,
  extension: Plug,
  mouse: Mouse,
  tips_and_updates: Tips,

  person: PersonalCollection,
  manage_accounts: PersonalCollection,

  database: Data,
  storage: Data,
  memory: Data,

  bug_report: Bug,
  source: Code,
  history: History,

  content_copy: Copy,
  copy_all: Copy,
  edit: Edit,
  delete: Delete,
  star: Like,
  bookmarks: FileTextOne,
  tag: Pound,
  label: Pound,
  monitor: Monitor,
  desktop_windows: Monitor,
  image: PictureOne,
  image_search: PictureOne,
  photo: PictureOne,
  power_settings_new: Power,

  checklist: ListCheckbox,
  visibility: Eyes,
  visibility_off: Close,
}

type IconProps = {
  name: string
  size?: number
  theme?: 'outline' | 'filled' | 'two-tone' | 'multi-color'
  strokeWidth?: number
  className?: string
  style?: React.CSSProperties
}

export function Icon({ name, size = 18, theme = 'outline', strokeWidth = 4, className, style }: IconProps) {
  const Component = MAP[name] as IP | undefined
  if (Component) {
    return (
      <Component
        size={size}
        theme={theme}
        strokeWidth={strokeWidth}
        className={className}
        style={style}
      />
    )
  }
  return (
    <span
      className={`inline-flex items-center justify-center ${className ?? ''}`}
      style={{ width: size, height: size, ...style }}
      aria-hidden="true"
    />
  )
}
