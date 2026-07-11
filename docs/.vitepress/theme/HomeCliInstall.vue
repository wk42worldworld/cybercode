<script setup lang="ts">
import { computed, ref } from 'vue'
import { useData } from 'vitepress'

type Platform = 'unix' | 'windows'

const { lang } = useData()
const activePlatform = ref<Platform>('unix')
const copied = ref(false)

const isEnglish = computed(() => lang.value.startsWith('en'))
const copyLabel = computed(() => {
  if (copied.value) return isEnglish.value ? 'Copied' : '已复制'
  return isEnglish.value ? 'Copy command' : '复制命令'
})
const content = computed(() =>
  isEnglish.value
    ? {
        eyebrow: 'CYBERCODE CLI',
        title: 'Install from your terminal',
        detail: 'Gets the latest stable release, installs Bun when needed, and adds the cybercode command to your user PATH.',
        unix: 'macOS / Linux',
        windows: 'Windows',
        start: 'Then start an agent from any project:',
      }
    : {
        eyebrow: 'CYBERCODE CLI',
        title: '在终端中一行安装',
        detail: '自动获取最新稳定版，缺少 Bun 时自动安装，并将 cybercode 命令加入用户 PATH。',
        unix: 'macOS / Linux',
        windows: 'Windows',
        start: '随后可在任意项目目录启动 Agent：',
      }
)

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
