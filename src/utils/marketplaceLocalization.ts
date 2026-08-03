export type MarketplaceLocale = 'en' | 'zh' | 'ja' | 'ko'

export type MarketplaceLocalizedDescriptions = Partial<Record<MarketplaceLocale, string>>

const LOCALE_ALIASES: Record<MarketplaceLocale, string[]> = {
  en: ['en', 'enus', 'english'],
  zh: ['zh', 'zhcn', 'zhhans', 'chinese', 'simplifiedchinese'],
  ja: ['ja', 'jp', 'jajp', 'japanese'],
  ko: ['ko', 'kr', 'kokr', 'korean'],
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

function normalizedKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, '')
}

function localeForKey(value: string): MarketplaceLocale | undefined {
  const key = normalizedKey(value)
  return (Object.entries(LOCALE_ALIASES) as Array<[MarketplaceLocale, string[]]>)
    .find(([, aliases]) => aliases.includes(key))?.[0]
}

function localizedValue(value: unknown): string | undefined {
  return stringValue(value)
    ?? stringValue(recordValue(value)?.description)
    ?? stringValue(recordValue(value)?.shortDescription)
}

function applyLocaleContainer(
  output: MarketplaceLocalizedDescriptions,
  value: unknown,
): void {
  const container = recordValue(value)
  if (!container) return
  for (const [key, entry] of Object.entries(container)) {
    const locale = localeForKey(key)
    const description = localizedValue(entry)
    if (locale && description && !output[locale]) output[locale] = description
  }
}

export function readLocalizedMarketplaceDescriptions(
  ...values: unknown[]
): MarketplaceLocalizedDescriptions | undefined {
  const output: MarketplaceLocalizedDescriptions = {}

  for (const value of values) {
    const record = recordValue(value)
    if (!record) continue

    for (const key of [
      'localizedDescriptions',
      'descriptions',
      'descriptionI18n',
      'description',
    ]) applyLocaleContainer(output, record[key])

    for (const key of ['i18n', 'locales', 'translations']) {
      applyLocaleContainer(output, record[key])
    }

    for (const [key, entry] of Object.entries(record)) {
      const normalized = normalizedKey(key)
      for (const [locale, aliases] of Object.entries(LOCALE_ALIASES) as Array<[
        MarketplaceLocale,
        string[],
      ]>) {
        if (
          aliases.some((alias) => (
            normalized === `description${alias}`
            || normalized === `shortdescription${alias}`
          ))
        ) {
          const description = localizedValue(entry)
          if (description && !output[locale]) output[locale] = description
        }
      }
    }
  }

  return Object.keys(output).length > 0 ? output : undefined
}
