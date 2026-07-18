import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

const docsBase = process.env.DOCS_BASE || '/'

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
      { text: '斜杠命令', link: '/guide/slash-commands' },
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
      { text: 'Slash Commands', link: '/en/guide/slash-commands' },
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
      { text: 'スラッシュコマンド', link: '/ja/guide/slash-commands' },
    ],
  },
]

const koSidebar = [
  {
    text: '시작하기',
    items: [
      { text: '설치 및 CLI 명령', link: '/ko/guide/quick-start' },
      { text: '슬래시 명령', link: '/ko/guide/slash-commands' },
    ],
  },
]

export default withMermaid(defineConfig({
  title: 'CyberCode',
  description: '本地运行的智能编程客户端，支持 Anthropic 与 OpenAI 兼容 API，并内置多模型厂商配置',
  lastUpdated: true,
  base: docsBase,

  markdown: {
    anchor: {
      slugify,
    },
  },

  head: [
    ['link', { rel: 'icon', type: 'image/png', sizes: '32x32', href: `${docsBase}favicon-32x32.png` }],
    ['link', { rel: 'apple-touch-icon', sizes: '180x180', href: `${docsBase}apple-touch-icon.png` }],
  ],

  locales: {
    root: {
      label: '中文',
      lang: 'zh-CN',
      themeConfig: {
        nav: [
          { text: '首页', link: '/' },
          { text: '教程文档', link: '/guide/quick-start' },
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
      description: 'A locally runnable coding agent with built-in provider setup for Anthropic- and OpenAI-compatible APIs.',
      themeConfig: {
        editLink: {
          pattern: 'https://github.com/wk42worldworld/cybercode/edit/main/docs/:path',
          text: 'Edit this page on GitHub',
        },
        nav: [
          { text: 'Home', link: '/en/' },
          { text: 'Documentation', link: '/en/guide/quick-start' },
        ],
        sidebar: enSidebar,
      },
    },
    ja: {
      label: '日本語',
      lang: 'ja-JP',
      description: 'Anthropic・OpenAI 互換 API のプロバイダー設定を内蔵した、ローカル実行型コーディング Agent。',
      themeConfig: {
        editLink: {
          pattern: 'https://github.com/wk42worldworld/cybercode/edit/main/docs/:path',
          text: 'GitHub でこのページを編集',
        },
        nav: [
          { text: 'ホーム', link: '/ja/' },
          { text: 'ドキュメント', link: '/ja/guide/quick-start' },
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
      description: 'Anthropic 및 OpenAI 호환 API 공급자 설정을 내장한 로컬 실행형 코딩 Agent입니다.',
      themeConfig: {
        editLink: {
          pattern: 'https://github.com/wk42worldworld/cybercode/edit/main/docs/:path',
          text: 'GitHub에서 이 페이지 편집',
        },
        nav: [
          { text: '홈', link: '/ko/' },
          { text: '문서', link: '/ko/guide/quick-start' },
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
    logo: {
      light: '/images/cybercode-wordmark.png',
      dark: '/images/cybercode-wordmark-dark.png',
      alt: 'CyberCode',
    },
    siteTitle: false,
    editLink: {
      pattern: 'https://github.com/wk42worldworld/cybercode/edit/main/docs/:path',
      text: '在 GitHub 上编辑此页',
    },
    search: {
      provider: 'local',
      options: {
        translations: {
          button: {
            buttonText: '搜索',
            buttonAriaLabel: '搜索文档',
          },
          modal: {
            displayDetails: '显示详细结果',
            resetButtonTitle: '清除搜索',
            backButtonTitle: '关闭搜索',
            noResultsText: '未找到相关结果：',
            footer: {
              selectText: '选择',
              selectKeyAriaLabel: '回车',
              navigateText: '切换',
              navigateUpKeyAriaLabel: '向上',
              navigateDownKeyAriaLabel: '向下',
              closeText: '关闭',
              closeKeyAriaLabel: '退出',
            },
          },
        },
        locales: {
          en: {
            translations: {
              button: {
                buttonText: 'Search',
                buttonAriaLabel: 'Search documentation',
              },
              modal: {
                displayDetails: 'Display detailed results',
                resetButtonTitle: 'Reset search',
                backButtonTitle: 'Close search',
                noResultsText: 'No results for:',
                footer: {
                  selectText: 'to select',
                  selectKeyAriaLabel: 'enter',
                  navigateText: 'to navigate',
                  navigateUpKeyAriaLabel: 'up arrow',
                  navigateDownKeyAriaLabel: 'down arrow',
                  closeText: 'to close',
                  closeKeyAriaLabel: 'escape',
                },
              },
            },
          },
          ja: {
            translations: {
              button: {
                buttonText: '検索',
                buttonAriaLabel: 'ドキュメントを検索',
              },
              modal: {
                displayDetails: '詳細結果を表示',
                resetButtonTitle: '検索をリセット',
                backButtonTitle: '検索を閉じる',
                noResultsText: '検索結果がありません：',
                footer: {
                  selectText: '選択',
                  selectKeyAriaLabel: 'Enter キー',
                  navigateText: '移動',
                  navigateUpKeyAriaLabel: '上矢印',
                  navigateDownKeyAriaLabel: '下矢印',
                  closeText: '閉じる',
                  closeKeyAriaLabel: 'Escape キー',
                },
              },
            },
          },
          ko: {
            translations: {
              button: {
                buttonText: '검색',
                buttonAriaLabel: '문서 검색',
              },
              modal: {
                displayDetails: '상세 결과 표시',
                resetButtonTitle: '검색 초기화',
                backButtonTitle: '검색 닫기',
                noResultsText: '검색 결과 없음:',
                footer: {
                  selectText: '선택',
                  selectKeyAriaLabel: 'Enter 키',
                  navigateText: '이동',
                  navigateUpKeyAriaLabel: '위쪽 화살표',
                  navigateDownKeyAriaLabel: '아래쪽 화살표',
                  closeText: '닫기',
                  closeKeyAriaLabel: 'Escape 키',
                },
              },
            },
          },
        },
      },
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
