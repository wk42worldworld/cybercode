<script setup lang="ts">
import { computed, ref } from 'vue'
import { useData } from 'vitepress'

type Platform = 'unix' | 'windows'

const { lang } = useData()
const activePlatform = ref<Platform>('unix')
const copied = ref(false)

const localizedContent = {
  en: {
    eyebrow: 'CYBERCODE CLI',
    title: 'Install from your terminal',
    detail: 'Gets the latest stable release, installs Bun when needed, and adds the cybercode command to your user PATH.',
    unix: 'macOS / Linux',
    windows: 'Windows',
    start: 'Then start an agent from any project:',
    copy: 'Copy command',
    copied: 'Copied',
  },
  zh: {
    eyebrow: 'CYBERCODE CLI',
    title: '在终端中一行安装',
    detail: '自动获取最新稳定版，缺少 Bun 时自动安装，并将 cybercode 命令加入用户 PATH。',
    unix: 'macOS / Linux',
    windows: 'Windows',
    start: '随后可在任意项目目录启动 Agent：',
    copy: '复制命令',
    copied: '已复制',
  },
  ja: {
    eyebrow: 'CYBERCODE CLI',
    title: 'ターミナルから 1 行でインストール',
    detail: '最新の安定版を取得し、必要に応じて Bun をインストールして、cybercode コマンドをユーザー PATH に追加します。',
    unix: 'macOS / Linux',
    windows: 'Windows',
    start: '任意のプロジェクトで Agent を起動できます：',
    copy: 'コマンドをコピー',
    copied: 'コピーしました',
  },
  ko: {
    eyebrow: 'CYBERCODE CLI',
    title: '터미널에서 한 줄로 설치',
    detail: '최신 안정 버전을 가져오고, 필요한 경우 Bun을 설치한 뒤 cybercode 명령을 사용자 PATH에 추가합니다.',
    unix: 'macOS / Linux',
    windows: 'Windows',
    start: '이제 어떤 프로젝트에서든 Agent를 시작할 수 있습니다:',
    copy: '명령 복사',
    copied: '복사됨',
  },
} as const

const locale = computed<keyof typeof localizedContent>(() => {
  if (lang.value.startsWith('zh')) return 'zh'
  if (lang.value.startsWith('ja')) return 'ja'
  if (lang.value.startsWith('ko')) return 'ko'
  return 'en'
})
const content = computed(() => localizedContent[locale.value])
const copyLabel = computed(() => {
  return copied.value ? content.value.copied : content.value.copy
})

const commands: Record<Platform, string> = {
  unix: 'curl -fsSL https://raw.githubusercontent.com/wk42worldworld/cybercode/main/scripts/install-cli.sh | bash',
  windows: 'irm https://raw.githubusercontent.com/wk42worldworld/cybercode/main/scripts/install-cli.ps1 | iex',
}

const activeCommand = computed(() => commands[activePlatform.value])

async function copyCommand() {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(activeCommand.value)
  } else {
    const textarea = document.createElement('textarea')
    textarea.value = activeCommand.value
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
  }

  copied.value = true
  window.setTimeout(() => {
    copied.value = false
  }, 1600)
}
</script>

<template>
  <section class="home-cli-install" aria-labelledby="home-cli-title">
    <div class="home-cli-install__inner">
      <header class="home-cli-install__intro">
        <p class="home-cli-install__eyebrow">{{ content.eyebrow }}</p>
        <h2 id="home-cli-title">{{ content.title }}</h2>
        <p>{{ content.detail }}</p>
      </header>

      <div class="home-cli-terminal">
        <div class="home-cli-terminal__toolbar">
          <div class="home-cli-platforms" role="tablist" :aria-label="content.title">
            <button
              type="button"
              role="tab"
              :aria-selected="activePlatform === 'unix'"
              :class="{ active: activePlatform === 'unix' }"
              @click="activePlatform = 'unix'; copied = false"
            >
              {{ content.unix }}
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="activePlatform === 'windows'"
              :class="{ active: activePlatform === 'windows' }"
              @click="activePlatform = 'windows'; copied = false"
            >
              {{ content.windows }}
            </button>
          </div>

          <button class="home-cli-copy" type="button" :aria-label="copyLabel" :title="copyLabel" @click="copyCommand">
            <span v-if="copied" class="home-cli-copy__check" aria-hidden="true" />
            <span v-else class="home-cli-copy__glyph" aria-hidden="true" />
          </button>
        </div>

        <div class="home-cli-command" role="tabpanel">
          <span class="home-cli-command__prompt" aria-hidden="true">$</span>
          <code>{{ activeCommand }}</code>
        </div>

        <div class="home-cli-terminal__start">
          <span>{{ content.start }}</span>
          <code>cybercode</code>
        </div>
      </div>
    </div>
  </section>
</template>
