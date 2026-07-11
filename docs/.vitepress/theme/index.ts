import DefaultTheme from 'vitepress/theme'
import mediumZoom from 'medium-zoom'
import { h, onMounted, watch, nextTick } from 'vue'
import { useRoute } from 'vitepress'
import HomeCliInstall from './HomeCliInstall.vue'
import './custom.css'

if (typeof document !== 'undefined') {
  document.documentElement.classList.add('cyber-js')
}

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      'home-hero-after': () => h(HomeCliInstall),
    }),
  setup() {
    const route = useRoute()
    const initZoom = () => {
      mediumZoom('.main img', { background: 'var(--vp-c-bg)' })
    }

    const initHeroImageReveal = () => {
      const image = document.querySelector<HTMLImageElement>(
        '.VPHome .VPHero .image-src'
      )
      if (!image || image.dataset.revealBound === 'true') return

      image.dataset.revealBound = 'true'
      const reveal = () => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => image.classList.add('is-loaded'))
        })
      }

      if (image.complete && image.naturalWidth > 0) reveal()
      else image.addEventListener('load', reveal, { once: true })
    }

    const initPageEnhancements = () => {
      initZoom()
      initHeroImageReveal()
    }

    onMounted(() => nextTick(() => initPageEnhancements()))
    watch(
      () => route.path,
      () => nextTick(() => initPageEnhancements())
    )
  },
}
