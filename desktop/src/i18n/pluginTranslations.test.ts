import { describe, expect, it } from 'vitest'
import { en } from './locales/en'
import { ja } from './locales/ja'
import { ko } from './locales/ko'
import { zh } from './locales/zh'

const pluginKeys = (locale: Record<string, string>) =>
  Object.keys(locale)
    .filter((key) => key.startsWith('settings.plugins.'))
    .sort()

const expectedPluginKeys = pluginKeys(en)

describe('plugin translations', () => {
  it.each([
    ['English', en],
    ['Chinese', zh],
    ['Japanese', ja],
    ['Korean', ko],
  ])('%s includes every settings.plugins.* key', (_name, locale) => {
    expect(pluginKeys(locale)).toEqual(expectedPluginKeys)
  })
})
