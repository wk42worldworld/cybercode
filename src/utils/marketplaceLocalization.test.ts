import { describe, expect, test } from 'bun:test'

import { readLocalizedMarketplaceDescriptions } from './marketplaceLocalization.js'

describe('marketplace localization metadata', () => {
  test('reads direct, mapped, and nested locale descriptions with source priority', () => {
    expect(readLocalizedMarketplaceDescriptions(
      {
        description_zh: '中文简介',
        localizedDescriptions: { ja: '日本語の説明' },
        i18n: { ko: { description: '한국어 설명' } },
      },
      {
        descriptions: {
          en: 'English description',
          zh: 'lower priority Chinese description',
        },
      },
    )).toEqual({
      en: 'English description',
      zh: '中文简介',
      ja: '日本語の説明',
      ko: '한국어 설명',
    })
  })

  test('accepts common regional locale aliases', () => {
    expect(readLocalizedMarketplaceDescriptions({
      locales: {
        'zh-CN': '简体中文',
        'ja-JP': { shortDescription: '短い説明' },
        'ko-KR': '간단한 설명',
      },
    })).toEqual({
      zh: '简体中文',
      ja: '短い説明',
      ko: '간단한 설명',
    })
  })
})
