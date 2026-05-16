import type { TranslationKey } from '../i18n'
import type { SessionListItem } from '../types/session'

type TranslateFn = (key: TranslationKey, params?: Record<string, string | number>) => string

const DEFAULT_SESSION_TITLE_MARKERS = new Set([
  'Untitled Session',
  'New Session',
  '未命名会话',
  '新会话',
])

export function isDefaultSessionTitle(title?: string | null): boolean {
  const trimmed = title?.trim()
  return !trimmed || DEFAULT_SESSION_TITLE_MARKERS.has(trimmed)
}

export function getDefaultSessionTitle(t: TranslateFn): string {
  return t('session.untitled')
}

export function getSessionTitleText(title: string | undefined | null, t: TranslateFn): string {
  const trimmed = title?.trim()
  return isDefaultSessionTitle(trimmed) ? getDefaultSessionTitle(t) : trimmed!
}

export function getSessionDisplayTitle(
  session: Pick<SessionListItem, 'title'>,
  t: TranslateFn,
): string {
  const title = session.title?.trim()
  return isDefaultSessionTitle(title) ? getDefaultSessionTitle(t) : title!
}
