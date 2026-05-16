/**
 * Vitest setup file for jsdom environment.
 * Provides browser API mocks required by react-virtuoso.
 */

// ResizeObserver is used by react-virtuoso to measure the scroll container.
class ResizeObserverMock {
  private callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }

  observe(target: Element) {
    // Fire the callback immediately with a large height so Virtuoso
    // treats the viewport as tall enough to render items.
    this.callback(
      [
        {
          target,
          contentRect: new DOMRect(0, 0, 800, 10000),
          borderBoxSize: [] as unknown as ResizeObserverSize[],
          contentBoxSize: [] as unknown as ResizeObserverSize[],
          devicePixelContentBoxSize: [] as unknown as ResizeObserverSize[],
        },
      ],
      this,
    )
  }

  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver

// IntersectionObserver is used by react-virtuoso for visibility tracking.
class IntersectionObserverMock {
  readonly root: Element | null = null
  readonly rootMargin = ''
  readonly thresholds: ReadonlyArray<number> = []

  constructor(private callback: IntersectionObserverCallback) {}

  observe(target: Element) {
    // Report all observed items as intersecting so Virtuoso renders them.
    this.callback(
      [
        {
          target,
          isIntersecting: true,
          intersectionRatio: 1,
          boundingClientRect: {} as DOMRectReadOnly,
          intersectionRect: {} as DOMRectReadOnly,
          rootBounds: null,
          time: Date.now(),
        },
      ],
      this,
    )
  }

  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

globalThis.IntersectionObserver = IntersectionObserverMock as unknown as typeof IntersectionObserver

if (typeof globalThis.localStorage?.clear !== 'function') {
  const storage = new Map<string, string>()
  const localStorageMock: Storage = {
    get length() {
      return storage.size
    },
    clear: () => {
      storage.clear()
    },
    getItem: (key) => storage.get(key) ?? null,
    key: (index) => Array.from(storage.keys())[index] ?? null,
    removeItem: (key) => {
      storage.delete(key)
    },
    setItem: (key, value) => {
      storage.set(key, String(value))
    },
  }

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: localStorageMock,
  })
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: localStorageMock,
    })
  }
}

// Virtuoso reads offsetHeight/scrollHeight/clientHeight/getBoundingClientRect
// from the scroll container and list items. In jsdom these are always 0,
// so Virtuoso thinks the viewport has zero height and renders nothing.
// Mock them to return large values for the Virtuoso scroller element
// (identified by data-testid="virtuoso-scroller") and reasonable values
// for all other elements.

Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get(this: HTMLElement) {
    if (this.getAttribute('data-testid') === 'virtuoso-scroller') return 10000
    if (this.getAttribute('data-testid') === 'virtuoso-item-list') return 0
    return 100
  },
})

Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
  configurable: true,
  get(this: HTMLElement) {
    if (this.getAttribute('data-testid') === 'virtuoso-scroller') return 10000
    return 100
  },
})

Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
  configurable: true,
  get(this: HTMLElement) {
    if (this.getAttribute('data-testid') === 'virtuoso-scroller') return 100000
    return 100
  },
})

Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
  configurable: true,
  get(this: HTMLElement) {
    return 800
  },
})

const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect
Element.prototype.getBoundingClientRect = function (this: Element) {
  if (this.getAttribute('data-testid') === 'virtuoso-scroller') {
    return new DOMRect(0, 0, 800, 10000)
  }
  return originalGetBoundingClientRect.call(this)
}
