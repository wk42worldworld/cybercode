import { createHash } from 'crypto'

export const PROMPT_MEMORY_INSIGHT_CATEGORIES = [
  'identity',
  'communication',
  'collaboration',
  'workflow',
  'quality',
  'boundaries',
  'expertise',
  'meta-method',
  'environment',
  'lesson',
  'other',
] as const

export type PromptMemoryInsightCategory =
  (typeof PROMPT_MEMORY_INSIGHT_CATEGORIES)[number]

export type PromptMemoryInsightSource = 'explicit' | 'observed' | 'manual'

export type PromptMemoryInsight = {
  id: string
  target: 'user' | 'brief'
  category: PromptMemoryInsightCategory
  content: string
  raw: string
  source: PromptMemoryInsightSource
  updatedAt?: string
}

export type PromptMemoryInsights = {
  insights: PromptMemoryInsight[]
  stats: {
    total: number
    user: number
    methods: number
    dimensions: number
    automaticUpdates: number
  }
}

type InsightFile = { entries: string[] }

type InsightLog = {
  timestamp: string
  trigger: 'explicit' | 'interval'
  target: 'user' | 'brief'
  changed: boolean
  content?: string
}

const CATEGORY_TAG_PATTERN = /^\[([a-z][a-z-]{1,31})\]\s*/i
const CATEGORY_SET = new Set<string>(PROMPT_MEMORY_INSIGHT_CATEGORIES)

function taggedCategory(entry: string): PromptMemoryInsightCategory | null {
  const match = entry.match(CATEGORY_TAG_PATTERN)
  if (!match?.[1]) return null
  const value = match[1].toLowerCase()
  return CATEGORY_SET.has(value)
    ? (value as PromptMemoryInsightCategory)
    : null
}

function inferUserCategory(entry: string): PromptMemoryInsightCategory {
  const text = entry.toLowerCase()
  if (
    /(?:\b(?:name|nickname|call me|call (?:the )?(?:assistant|agent))\b|名字|姓名|称呼|取名|叫做|我叫|你叫|名前|呼ん|이름|호칭)/i.test(
      text,
    )
  ) {
    return 'identity'
  }
  if (
    /(?:\b(?:language|reply|respond|tone|concise|verbose|explain|format)\b|中文|英文|日文|韩文|回复|回答|语气|简洁|详细|格式|言語|返答|簡潔|언어|답변|간결)/i.test(
      text,
    )
  ) {
    return 'communication'
  }
  if (
    /(?:\b(?:expert|senior|junior|years? of|familiar|unfamiliar|new to|knowledge)\b|擅长|熟悉|不熟悉|经验|新手|资深|専門|詳しい|初心者|전문|익숙|초보)/i.test(
      text,
    )
  ) {
    return 'expertise'
  }
  if (
    /(?:\b(?:never|must not|do not|don't|permission|confirm before|boundary|avoid)\b|不要|不能|必须先确认|边界|禁止|避免|しないで|禁止|確認して|하지 마|금지|확인)/i.test(
      text,
    )
  ) {
    return 'boundaries'
  }
  if (
    /(?:\b(?:test|verify|quality|complete|polish|acceptance|production-ready)\b|测试|验证|验收|质量|完善|完成度|生产可用|検証|品質|완성도|검증|품질)/i.test(
      text,
    )
  ) {
    return 'quality'
  }
  if (
    /(?:\b(?:first|then|workflow|process|release|commit|step|sequence)\b|先.+再|流程|步骤|顺序|发布|提交|まず|手順|順序|먼저|절차|순서)/i.test(
      text,
    )
  ) {
    return 'workflow'
  }
  if (
    /(?:\b(?:discuss|brainstorm|plan|ask|autonomous|collaborate|decision)\b|先讨论|讨论|计划|直接做|自主|协作|决策|相談|計画|協力|논의|계획|협업)/i.test(
      text,
    )
  ) {
    return 'collaboration'
  }
  return 'other'
}

function inferBriefCategory(entry: string): PromptMemoryInsightCategory {
  const text = entry.toLowerCase()
  if (
    /(?:\b(?:environment|path|directory|terminal|shell|provider|model|runtime|bun|node|rust)\b|环境|路径|目录|终端|模型|厂商|运行时|環境|パス|モデル|환경|경로|모델)/i.test(
      text,
    )
  ) {
    return 'environment'
  }
  if (
    /(?:\b(?:pitfall|failure|failed|error|lesson|avoid|regression|incident)\b|踩坑|失败|错误|教训|回归|事故|落とし穴|失敗|教訓|실패|교훈)/i.test(
      text,
    )
  ) {
    return 'lesson'
  }
  return 'meta-method'
}

export function parsePromptMemoryInsight(
  entry: string,
  target: 'user' | 'brief',
): Pick<PromptMemoryInsight, 'category' | 'content' | 'raw'> {
  const raw = entry.trim()
  const category = taggedCategory(raw) ??
    (target === 'user' ? inferUserCategory(raw) : inferBriefCategory(raw))
  const content = taggedCategory(raw)
    ? raw.replace(CATEGORY_TAG_PATTERN, '').trim()
    : raw
  return { category, content, raw }
}

function insightId(target: 'user' | 'brief', raw: string): string {
  return createHash('sha256')
    .update(`${target}\0${raw}`)
    .digest('hex')
    .slice(0, 20)
}

function findMatchingLog(
  logs: InsightLog[],
  target: 'user' | 'brief',
  raw: string,
): InsightLog | undefined {
  return logs.find(log =>
    log.changed &&
    log.target === target &&
    log.content?.trim() === raw,
  )
}

export function buildPromptMemoryInsights(params: {
  files: { user: InsightFile; brief: InsightFile }
  logs: InsightLog[]
}): PromptMemoryInsights {
  const insights: PromptMemoryInsight[] = []

  for (const target of ['user', 'brief'] as const) {
    for (const entry of params.files[target].entries) {
      const parsed = parsePromptMemoryInsight(entry, target)
      if (!parsed.content) continue
      const log = findMatchingLog(params.logs, target, parsed.raw)
      insights.push({
        id: insightId(target, parsed.raw),
        target,
        ...parsed,
        source: log
          ? log.trigger === 'explicit'
            ? 'explicit'
            : 'observed'
          : 'manual',
        updatedAt: log?.timestamp,
      })
    }
  }

  const user = insights.filter(insight => insight.target === 'user').length
  const methods = insights.length - user
  return {
    insights,
    stats: {
      total: insights.length,
      user,
      methods,
      dimensions: new Set(insights.map(insight => insight.category)).size,
      automaticUpdates: params.logs.filter(log => log.changed).length,
    },
  }
}
