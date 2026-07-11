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
    points: ['Latest stable release', 'Installs Bun when needed', 'Adds cybercode to PATH'],
    copy: 'Copy command',
    copied: 'Copied',
  },
  zh: {
    eyebrow: 'CYBERCODE CLI',
    title: '在终端中一行安装',
    detail: '自动获取最新稳定版，缺少 Bun 时自动安装，并将 cybercode 命令加入用户 PATH。',
    unix: 'macOS / Linux',
    windows: 'Windows',
    points: ['自动获取最新稳定版', '缺少 Bun 时自动安装', '加入用户 PATH'],
    copy: '复制命令',
    copied: '已复制',
  },
  ja: {
    eyebrow: 'CYBERCODE CLI',
    title: 'ターミナルから 1 行でインストール',
    detail: '最新の安定版を取得し、必要に応じて Bun をインストールして、cybercode コマンドをユーザー PATH に追加します。',
    unix: 'macOS / Linux',
    windows: 'Windows',
    points: ['最新の安定版', '必要に応じて Bun を導入', 'ユーザー PATH に追加'],
    copy: 'コマンドをコピー',
    copied: 'コピーしました',
  },
  ko: {
    eyebrow: 'CYBERCODE CLI',
    title: '터미널에서 한 줄로 설치',
    detail: '최신 안정 버전을 가져오고, 필요한 경우 Bun을 설치한 뒤 cybercode 명령을 사용자 PATH에 추가합니다.',
    unix: 'macOS / Linux',
    windows: 'Windows',
    points: ['최신 안정 버전', '필요하면 Bun 자동 설치', '사용자 PATH에 추가'],
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

function copyWithTextarea() {
  const textarea = document.createElement('textarea')
  textarea.value = activeCommand.value
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const succeeded = document.execCommand('copy')
  textarea.remove()
  return succeeded
}

async function copyCommand() {
  let succeeded = false

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(activeCommand.value)
      succeeded = true
    } catch {
      succeeded = copyWithTextarea()
    }
  }

  if (!navigator.clipboard?.writeText) succeeded = copyWithTextarea()
  if (!succeeded) return

  copied.value = true
  window.setTimeout(() => {
    copied.value = false
  }, 1600)
}
</script>

<template>
  <section class="home-cli-install" aria-labelledby="home-cli-title">
    <div class="home-cli-terminal-band">
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

        <ul class="home-cli-terminal__status">
          <li v-for="point in content.points" :key="point">{{ point }}</li>
        </ul>
      </div>
    </div>

    <div class="home-cli-install__inner">
      <header class="home-cli-install__intro">
        <p class="home-cli-install__eyebrow">{{ content.eyebrow }}</p>
        <h2 id="home-cli-title">{{ content.title }}</h2>
        <p>{{ content.detail }}</p>
      </header>
    </div>
  </section>
</template>
