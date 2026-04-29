import { create } from 'zustand'
import type { RuntimeSelection } from '../types/runtime'

const STORAGE_KEY = 'cybercode-session-runtime'

export const DRAFT_RUNTIME_SELECTION_KEY = '__draft__'

type SessionRuntimeStore = {
  selections: Record<string, RuntimeSelection>
  setSelection: (key: string, selection: RuntimeSelection) => void
  clearSelection: (key: string) => void
  moveSelection: (fromKey: string, toKey: string) => void
}

function loadSelections(): Record<string, RuntimeSelection> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, RuntimeSelection>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function persistSelections(selections: Record<string, RuntimeSelection>) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selections))
  } catch {
    // noop
  }
}

export const useSessionRuntimeStore = create<SessionRuntimeStore>((set) => ({
  selections: loadSelections(),

  setSelection: (key, selection) =>
    set((state) => {
      const selections = {
        ...state.selections,
        [key]: selection,
      }
      persistSelections(selections)
      return { selections }
    }),

  clearSelection: (key) =>
    set((state) => {
      if (!(key in state.selections)) return state
      const { [key]: _removed, ...rest } = state.selections
      persistSelections(rest)
      return { selections: rest }
    }),

  moveSelection: (fromKey, toKey) =>
    set((state) => {
      const selection = state.selections[fromKey]
      if (!selection) return state
      const { [fromKey]: _removed, ...rest } = state.selections
      const selections = {
        ...rest,
        [toKey]: selection,
      }
      persistSelections(selections)
      return { selections }
    }),
}))
