import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useSettingsStore } from '../stores/settingsStore'
import { localeOptions, translate, useTranslation } from '.'

describe('useTranslation', () => {
  afterEach(() => {
    act(() => {
      useSettingsStore.getState().setLocale('zh')
    })
  })

  it('keeps the translation function stable until the locale changes', () => {
    act(() => {
      useSettingsStore.getState().setLocale('zh')
    })

    const { result, rerender } = renderHook(() => useTranslation())
    const initial = result.current

    rerender()
    expect(result.current).toBe(initial)

    act(() => {
      useSettingsStore.getState().setLocale('en')
    })
    expect(result.current).not.toBe(initial)
  })

  it('supports English, Chinese, Japanese, and Korean homepage locales', () => {
    expect(localeOptions.map((item) => item.value)).toEqual(['en', 'zh', 'ja', 'ko'])
    expect(translate('en', 'empty.title')).toBe('New session')
    expect(translate('zh', 'empty.title')).toBe('新建会话')
    expect(translate('ja', 'empty.title')).toBe('新しいセッション')
    expect(translate('ko', 'empty.title')).toBe('새 세션')
    expect(translate('en', 'common.close')).toBe('Close')
    expect(translate('zh', 'common.close')).toBe('关闭')
    expect(translate('ja', 'common.close')).toBe('閉じる')
    expect(translate('ko', 'common.close')).toBe('닫기')
    expect(translate('en', 'chat.rewindAction')).toBe('Rewind to here')
    expect(translate('zh', 'chat.rewindAction')).toBe('回滚到这里')
    expect(translate('ja', 'chat.rewindAction')).toBe('ここまで巻き戻す')
    expect(translate('ko', 'chat.rewindAction')).toBe('여기까지 되돌리기')
  })

  it('falls back to English when a partial locale is missing a key', () => {
    expect(translate('ja', 'settings.providers.title')).toBe('Providers')
    expect(translate('ko', 'settings.providers.title')).toBe('Providers')
  })
})
