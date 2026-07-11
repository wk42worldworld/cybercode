import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

// GitHub-compatible slugify (matches github-slugger algorithm)
// Makes heading anchor IDs consistent between VitePress and GitHub rendering
function slugify(str: string): string {
  return str
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
    .replace(/ /g, '-')
}

const zhSidebar = [
  {
    text: '快速开始',
    items: [
      { text: '安装与启动', link: '/guide/quick-start' },
      { text: '环境变量', link: '/guide/env-vars' },
      { text: '第三方模型', link: '/guide/third-party-models' },
      { text: '全局使用', link: '/guide/global-usage' },
      { text: '常见问题', link: '/guide/faq' },
    ],
  },
  {
    text: '记忆系统',
    collapsed: false,
    items: [
      { text: '概览', link: '/memory/' },
      { text: '使用指南', link: '/memory/01-usage-guide' },
      { text: '实现原理', link: '/memory/02-implementation' },
      { text: 'AutoDream 记忆整合', link: '/memory/03-autodream' },
    ],
  },
  {
    text: '多 Agent 系统',
    collapsed: false,
    items: [
      { text: '概览', link: '/agent/' },
      { text: '使用指南', link: '/agent/01-usage-guide' },
      { text: '实现原理', link: '/agent/02-implementation' },
      { text: 'Agent 框架解析', link: '/agent/03-agent-framework' },
    ],
  },
  {
    text: 'Skills 系统',
    collapsed: false,
    items: [
      { text: '使用指南', link: '/skills/01-usage-guide' },
      { text: '实现原理', link: '/skills/02-implementation' },
    ],
  },
  {
    text: 'IM 接入',
    collapsed: false,
    items: [
      { text: '总览', link: '/im/' },
      { text: 'Telegram', link: '/im/telegram' },
      { text: '飞书', link: '/im/feishu' },
    ],
  },
  {
    text: 'Channel 源码研究',
    collapsed: false,
    items: [
      { text: '概览', link: '/channel/' },
      { text: '架构解析', link: '/channel/01-channel-system' },
    ],
  },
  {
    text: 'Computer Use',
    collapsed: false,
    items: [
      { text: '功能指南', link: '/features/computer-use' },
      { text: '架构解析', link: '/features/computer-use-architecture' },
    ],
  },
  {
    text: '桌面端',
    collapsed: false,
    items: [
      { text: '概览', link: '/desktop/' },
      { text: '快速上手', link: '/desktop/01-quick-start' },
      { text: '架构设计', link: '/desktop/02-architecture' },
      { text: '功能详解', link: '/desktop/03-features' },
      { text: '安装与构建', link: '/desktop/04-installation' },
    ],
  },
  {
    text: '参考',
    collapsed: true,
    items: [
      { text: '源码修复记录', link: '/reference/fixes' },
      { text: '项目结构', link: '/reference/project-structure' },
    ],
  },
]

const enSidebar = [
  {
    text: 'Getting Started',
    items: [
      { text: 'Quick Start', link: '/en/guide/quick-start' },
      { text: 'Environment Variables', link: '/en/guide/env-vars' },
      { text: 'Third-Party Models', link: '/en/guide/third-party-models' },
      { text: 'Global Usage', link: '/en/guide/global-usage' },
      { text: 'FAQ', link: '/en/guide/faq' },
    ],
  },
  {
    text: 'Memory System',
    collapsed: false,
    items: [
      { text: 'Overview', link: '/en/memory/' },
      { text: 'Usage Guide', link: '/en/memory/01-usage-guide' },
      { text: 'Implementation', link: '/en/memory/02-implementation' },
      { text: 'AutoDream', link: '/en/memory/03-autodream' },
    ],
  },
  {
    text: 'Multi-Agent System',
    collapsed: false,
    items: [
      { text: 'Overview', link: '/en/agent/' },
      { text: 'Usage Guide', link: '/en/agent/01-usage-guide' },
      { text: 'Implementation', link: '/en/agent/02-implementation' },
      { text: 'Framework Deep Dive', link: '/en/agent/03-agent-framework' },
    ],
  },
  {
    text: 'Skills System',
    collapsed: false,
    items: [
      { text: 'Usage Guide', link: '/en/skills/01-usage-guide' },
      { text: 'Implementation', link: '/en/skills/02-implementation' },
    ],
  },
  {
    text: 'Channel System',
    collapsed: false,
    items: [
      { text: 'Overview', link: '/en/channel/' },
      { text: 'Architecture', link: '/en/channel/01-channel-system' },
    ],
  },
  {
    text: 'Computer Use',
    collapsed: false,
    items: [
      { text: 'Guide', link: '/en/features/computer-use' },
      { text: 'Architecture', link: '/en/features/computer-use-architecture' },
    ],
  },
  {
    text: 'Desktop',
    collapsed: false,
    items: [
      { text: 'Overview', link: '/en/desktop/' },
      { text: 'Quick Start', link: '/en/desktop/01-quick-start' },
      { text: 'Architecture', link: '/en/desktop/02-architecture' },
      { text: 'Features', link: '/en/desktop/03-features' },
      { text: 'Installation & Build', link: '/en/desktop/04-installation' },
    ],
  },
  {
    text: 'Reference',
    collapsed: true,
    items: [
      { text: 'Source Fixes', link: '/en/reference/fixes' },
      { text: 'Project Structure', link: '/en/reference/project-structure' },
    ],
  },
]

const jaSidebar = [
  {
    text: 'はじめに',
    items: [
      { text: 'インストールと CLI コマンド', link: '/ja/guide/quick-start' },
    ],
  },
]

const koSidebar = [
  {
    text: '시작하기',
    items: [
      { text: '설치 및 CLI 명령', link: '/ko/guide/quick-start' },
    ],
  },
]

export default withMermaid(defineConfig({
  title: 'CyberCode',
  description: '高度借鉴 Claude Code 设计的本地可运行客户端，支持接入任意 Anthropic 兼容 API',
  lastUpdated: true,
  base: '/',

  markdown: {
    anchor: {
      slugify,
    },
  },

  head: [],

  locales: {
    root: {
      label: '中文',
      lang: 'zh-CN',
      themeConfig: {
        nav: [
          { text: '首页', link: '/' },
          { text: '快速开始', link: '/guide/quick-start' },
        ],
        sidebar: zhSidebar,
        outline: { label: '页面导航' },
        returnToTopLabel: '返回顶部',
        sidebarMenuLabel: '菜单',
        darkModeSwitchLabel: '主题',
        lastUpdated: { text: '最后更新于' },
        docFooter: { prev: '上一页', next: '下一页' },
      },
    },
    en: {
      label: 'English',
      lang: 'en-US',
      description: 'A locally runnable client heavily inspired by Claude Code, with support for any Anthropic-compatible API endpoint.',
      themeConfig: {
        editLink: {
          pattern: 'https://github.com/wk42worldworld/cybercode/edit/main/docs/:path',
          text: 'Edit this page on GitHub',
        },
        nav: [
          { text: 'Home', link: '/en/' },
          { text: 'Quick Start', link: '/en/guide/quick-start' },
        ],
        sidebar: enSidebar,
      },
    },
    ja: {
      label: '日本語',
      lang: 'ja-JP',
      description: 'Claude Code に着想を得た、任意の Anthropic 互換 API に接続できるローカル実行型クライアント。',
      themeConfig: {
        editLink: {
          pattern: 'https://github.com/wk42worldworld/cybercode/edit/main/docs/:path',
          text: 'GitHub でこのページを編集',
        },
        nav: [
          { text: 'ホーム', link: '/ja/' },
          { text: 'クイックスタート', link: '/ja/guide/quick-start' },
        ],
        sidebar: jaSidebar,
        outline: { label: 'ページ内ナビゲーション' },
        returnToTopLabel: 'ページ上部へ戻る',
        sidebarMenuLabel: 'メニュー',
        darkModeSwitchLabel: 'テーマ',
        lastUpdated: { text: '最終更新' },
        docFooter: { prev: '前のページ', next: '次のページ' },
      },
    },
    ko: {
      label: '한국어',
      lang: 'ko-KR',
      description: 'Claude Code에서 영감을 받아 모든 Anthropic 호환 API를 연결할 수 있는 로컬 실행 클라이언트입니다.',
      themeConfig: {
        editLink: {
          pattern: 'https://github.com/wk42worldworld/cybercode/edit/main/docs/:path',
          text: 'GitHub에서 이 페이지 편집',
        },
        nav: [
          { text: '홈', link: '/ko/' },
          { text: '빠른 시작', link: '/ko/guide/quick-start' },
        ],
        sidebar: koSidebar,
        outline: { label: '페이지 목차' },
        returnToTopLabel: '맨 위로 돌아가기',
        sidebarMenuLabel: '메뉴',
        darkModeSwitchLabel: '테마',
        lastUpdated: { text: '마지막 업데이트' },
        docFooter: { prev: '이전 페이지', next: '다음 페이지' },
      },
    },
  },

  themeConfig: {
    editLink: {
      pattern: 'https://github.com/wk42worldworld/cybercode/edit/main/docs/:path',
      text: '在 GitHub 上编辑此页',
    },
    search: {
      provider: 'local',
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/wk42worldworld/cybercode' },
    ],
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright 2026 CyberCode Contributors',
    },
  },
}))
