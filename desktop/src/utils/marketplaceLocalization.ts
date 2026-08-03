import type { Locale } from '../i18n/localeConfig'

type LocalizedDescriptions = Partial<Record<Locale, string>>

type MarketplaceDescriptionItem = {
  displayName: string
  description: string
  localizedDescriptions?: LocalizedDescriptions
  sourceName: string
}

export type MarketplaceSortMode = 'recommended' | 'newest' | 'popular' | 'name'

type MarketplaceSortableItem = {
  displayName: string
  version?: string
  updatedAt?: string
  popularity?: number
  installations?: readonly unknown[]
}

const FEATURE_LABELS: Record<Locale, Record<string, string>> = {
  en: {
    plugin: 'plugin',
    skills: 'skills',
    commands: 'commands',
    agents: 'agents',
    hooks: 'hooks',
    mcpServers: 'MCP servers',
    lspServers: 'language servers',
  },
  zh: {
    plugin: '完整插件',
    skills: '技能',
    commands: '命令',
    agents: '智能体',
    hooks: '自动化钩子',
    mcpServers: 'MCP 服务',
    lspServers: '语言服务',
  },
  ja: {
    plugin: 'プラグイン',
    skills: 'スキル',
    commands: 'コマンド',
    agents: 'エージェント',
    hooks: '自動化フック',
    mcpServers: 'MCP サーバー',
    lspServers: '言語サーバー',
  },
  ko: {
    plugin: '플러그인',
    skills: '스킬',
    commands: '명령',
    agents: '에이전트',
    hooks: '자동화 훅',
    mcpServers: 'MCP 서버',
    lspServers: '언어 서버',
  },
}

const CATEGORY_LABELS: Record<Locale, Record<string, string>> = {
  en: {
    'autonomous ai agents': 'Autonomous AI Agents',
    automation: 'Automation',
    blockchain: 'Blockchain',
    'business & operations': 'Business & Operations',
    communication: 'Communication',
    creative: 'Creative',
    creativity: 'Creativity',
    'data science': 'Data Science',
    'data & analytics': 'Data & Analytics',
    database: 'Database',
    deployment: 'Deployment',
    design: 'Design',
    devops: 'DevOps',
    development: 'Development',
    'developer tools': 'Developer Tools',
    'education & research': 'Education & Research',
    engineering: 'Engineering',
    dogfood: 'Internal Testing',
    email: 'Email',
    finance: 'Finance',
    general: 'General',
    gaming: 'Gaming',
    health: 'Health',
    inference: 'Inference',
    learning: 'Learning',
    location: 'Location',
    math: 'Math',
    mcp: 'MCP',
    migration: 'Migration',
    mlops: 'MLOps',
    models: 'Models',
    monitoring: 'Monitoring',
    other: 'Other',
    payments: 'Payments',
    productivity: 'Productivity',
    research: 'Research',
    security: 'Security',
    'software development': 'Software Development',
    'software engineering': 'Software Engineering',
    testing: 'Testing',
    travel: 'Travel',
    training: 'Training',
    'web development': 'Web Development',
  },
  zh: {
    'autonomous ai agents': '自主智能体',
    automation: '自动化',
    blockchain: '区块链',
    'business & operations': '商务与运营',
    communication: '沟通协作',
    creative: '创意',
    creativity: '创意',
    'data science': '数据科学',
    'data & analytics': '数据与分析',
    database: '数据库',
    deployment: '部署',
    design: '设计',
    devops: 'DevOps',
    development: '开发',
    'developer tools': '开发工具',
    'education & research': '教育与研究',
    engineering: '工程',
    dogfood: '内部试用',
    email: '邮件',
    finance: '财务',
    general: '通用',
    gaming: '游戏',
    health: '健康',
    inference: '推理',
    learning: '学习',
    location: '地图与位置',
    math: '数学',
    mcp: 'MCP',
    migration: '迁移',
    mlops: 'MLOps',
    models: '模型',
    monitoring: '监控',
    other: '其他',
    payments: '支付',
    productivity: '效率',
    research: '研究',
    security: '安全',
    'software development': '软件开发',
    'software engineering': '软件工程',
    testing: '测试',
    travel: '旅行',
    training: '训练',
    'web development': 'Web 开发',
  },
  ja: {
    'autonomous ai agents': '自律型 AI エージェント',
    automation: '自動化',
    blockchain: 'ブロックチェーン',
    'business & operations': 'ビジネス・業務',
    communication: 'コミュニケーション',
    creative: 'クリエイティブ',
    creativity: 'クリエイティブ',
    'data science': 'データサイエンス',
    'data & analytics': 'データ・分析',
    database: 'データベース',
    deployment: 'デプロイ',
    design: 'デザイン',
    devops: 'DevOps',
    development: '開発',
    'developer tools': '開発ツール',
    'education & research': '教育・研究',
    engineering: 'エンジニアリング',
    dogfood: '社内検証',
    email: 'メール',
    finance: '財務',
    general: '一般',
    gaming: 'ゲーム',
    health: 'ヘルスケア',
    inference: '推論',
    learning: '学習',
    location: '位置情報',
    math: '数学',
    mcp: 'MCP',
    migration: '移行',
    mlops: 'MLOps',
    models: 'モデル',
    monitoring: '監視',
    other: 'その他',
    payments: '決済',
    productivity: '生産性',
    research: '研究',
    security: 'セキュリティ',
    'software development': 'ソフトウェア開発',
    'software engineering': 'ソフトウェア開発',
    testing: 'テスト',
    travel: '旅行',
    training: 'トレーニング',
    'web development': 'Web 開発',
  },
  ko: {
    'autonomous ai agents': '자율형 AI 에이전트',
    automation: '자동화',
    blockchain: '블록체인',
    'business & operations': '비즈니스 및 운영',
    communication: '커뮤니케이션',
    creative: '크리에이티브',
    creativity: '크리에이티브',
    'data science': '데이터 과학',
    'data & analytics': '데이터 및 분석',
    database: '데이터베이스',
    deployment: '배포',
    design: '디자인',
    devops: 'DevOps',
    development: '개발',
    'developer tools': '개발 도구',
    'education & research': '교육 및 연구',
    engineering: '엔지니어링',
    dogfood: '내부 검증',
    email: '이메일',
    finance: '금융',
    general: '일반',
    gaming: '게임',
    health: '헬스케어',
    inference: '추론',
    learning: '학습',
    location: '위치',
    math: '수학',
    mcp: 'MCP',
    migration: '마이그레이션',
    mlops: 'MLOps',
    models: '모델',
    monitoring: '모니터링',
    other: '기타',
    payments: '결제',
    productivity: '생산성',
    research: '연구',
    security: '보안',
    'software development': '소프트웨어 개발',
    'software engineering': '소프트웨어 엔지니어링',
    testing: '테스트',
    travel: '여행',
    training: '학습',
    'web development': '웹 개발',
  },
}

function descriptionMatchesLocale(description: string, locale: Locale): boolean {
  const latinCount = description.match(/[A-Za-z]/g)?.length ?? 0
  const hanCount = description.match(/[\u3400-\u9fff]/gu)?.length ?? 0
  const kanaCount = description.match(/[\u3040-\u30ff]/gu)?.length ?? 0
  const hangulCount = description.match(/[\uac00-\ud7af]/gu)?.length ?? 0

  if (locale === 'en') return latinCount > 0 && latinCount >= hanCount + kanaCount + hangulCount
  if (locale === 'ja') return kanaCount >= 2 && kanaCount + hanCount >= latinCount * 0.3
  if (locale === 'ko') return hangulCount >= 2 && hangulCount >= latinCount * 0.3
  return hanCount >= 2
    && hanCount >= latinCount * 0.3
    && kanaCount === 0
    && hangulCount === 0
}

export function marketplaceFeatureLabel(feature: string, locale: Locale): string {
  return FEATURE_LABELS[locale][feature]
    ?? {
      en: 'plugin feature',
      zh: '插件能力',
      ja: 'プラグイン機能',
      ko: '플러그인 기능',
    }[locale]
}

export function marketplaceCategoryKey(category: string): string {
  return category
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s*\/\s*/g, ' / ')
    .replace(/\s+/g, ' ')
}

export function marketplaceCategoryLabel(category: string, locale: Locale): string {
  const categoryKey = marketplaceCategoryKey(category)
  const exact = CATEGORY_LABELS[locale][categoryKey]
  if (exact) return exact

  return categoryKey
    .split(' / ')
    .map((part) => CATEGORY_LABELS[locale][part] ?? part.replace(/\b\w/g, (letter) => (
      letter.toUpperCase()
    )))
    .join(' / ')
}

function timestamp(value: string | undefined): number {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function versionParts(value: string | undefined): number[] {
  return (value?.match(/\d+/g) ?? []).slice(0, 4).map(Number)
}

function compareVersions(a: string | undefined, b: string | undefined): number {
  const left = versionParts(a)
  const right = versionParts(b)
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (right[index] ?? 0) - (left[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

export function sortMarketplaceItems<T extends MarketplaceSortableItem>(
  items: readonly T[],
  mode: MarketplaceSortMode,
  locale: Locale,
): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      if (mode === 'newest') {
        const dateDifference = timestamp(right.item.updatedAt) - timestamp(left.item.updatedAt)
        if (dateDifference !== 0) return dateDifference
        const versionDifference = compareVersions(left.item.version, right.item.version)
        if (versionDifference !== 0) return versionDifference
      }
      if (mode === 'popular') {
        const popularityDifference = (right.item.popularity ?? 0) - (left.item.popularity ?? 0)
        if (popularityDifference !== 0) return popularityDifference
        const installationDifference = (right.item.installations?.length ?? 0)
          - (left.item.installations?.length ?? 0)
        if (installationDifference !== 0) return installationDifference
      }
      if (mode === 'name') {
        return left.item.displayName.localeCompare(right.item.displayName, locale)
      }
      return left.index - right.index
    })
    .map(({ item }) => item)
}

export function marketplaceSourceLabel(sourceName: string, locale: Locale): string {
  if (locale === 'en') return sourceName
  const officialMatch = sourceName.match(/^(.*?)\s+Official$/i)
  if (!officialMatch) return sourceName
  const suffix = {
    zh: '官方',
    ja: '公式',
    ko: '공식',
  }[locale]
  return `${officialMatch[1]} ${suffix}`
}

export function marketplaceDescription(
  item: MarketplaceDescriptionItem,
  locale: Locale,
  kind: 'skill' | 'plugin',
  features: string[] = [],
): string {
  const sourceName = marketplaceSourceLabel(item.sourceName, locale)
  const localized = item.localizedDescriptions?.[locale]?.trim()
  if (localized) return localized

  const original = item.description.trim()
  if (original && descriptionMatchesLocale(original, locale)) return original

  if (kind === 'skill') {
    if (locale === 'en') {
      return `A skill for tasks related to “${item.displayName}”. Once installed, CyberCode can use it when relevant. Source: ${sourceName}.`
    }
    if (locale === 'zh') {
      return `用于处理“${item.displayName}”相关任务的技能。安装后，CyberCode 可在合适的工作中调用它；来源：${sourceName}。`
    }
    if (locale === 'ja') {
      return `「${item.displayName}」に関連するタスクを処理するスキルです。インストール後、CyberCode が適切な作業で利用できます。提供元：${sourceName}。`
    }
    return `“${item.displayName}” 관련 작업을 처리하는 스킬입니다. 설치 후 CyberCode가 적절한 작업에서 사용할 수 있습니다. 제공: ${sourceName}.`
  }

  const capabilities = [...new Set(features.map((feature) => (
    marketplaceFeatureLabel(feature, locale)
  )))].join(locale === 'zh' || locale === 'ja' ? '、' : ', ')
  if (locale === 'en') {
    return `A plugin that adds “${item.displayName}” capabilities to CyberCode${capabilities ? `, including ${capabilities}` : ''}. Source: ${sourceName}.`
  }
  if (locale === 'zh') {
    return `为 CyberCode 增加“${item.displayName}”相关能力的插件${capabilities ? `，包含${capabilities}` : ''}；来源：${sourceName}。`
  }
  if (locale === 'ja') {
    return `CyberCode に「${item.displayName}」関連の機能を追加するプラグインです${capabilities ? `。内容：${capabilities}` : ''}。提供元：${sourceName}。`
  }
  return `CyberCode에 “${item.displayName}” 관련 기능을 추가하는 플러그인입니다${capabilities ? `. 포함 기능: ${capabilities}` : ''}. 제공: ${sourceName}.`
}
