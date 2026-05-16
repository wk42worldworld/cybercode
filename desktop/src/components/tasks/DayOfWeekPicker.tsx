import { useTranslation } from '../../i18n'

type Props = {
  selected: number[]
  onChange: (days: number[]) => void
}

// Display order: Mon(1) → Sun(0), matching Chinese convention
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

const DAY_KEYS = [
  'newTask.daySun',
  'newTask.dayMon',
  'newTask.dayTue',
  'newTask.dayWed',
  'newTask.dayThu',
  'newTask.dayFri',
  'newTask.daySat',
] as const

export function DayOfWeekPicker({ selected, onChange }: Props) {
  const t = useTranslation()

  const toggle = (day: number) => {
    if (selected.includes(day)) {
      // Don't allow deselecting the last day
      if (selected.length <= 1) return
      onChange(selected.filter((d) => d !== day))
    } else {
      onChange([...selected, day])
    }
  }

  return (
    <div className="flex gap-1.5">
      {DAY_ORDER.map((day) => {
        const isActive = selected.includes(day)
        return (
          <button
            key={day}
            type="button"
            onClick={() => toggle(day)}
            className={`
              w-8 h-8 rounded-full text-[12px] font-bold transition-colors
              ${isActive
                ? 'bg-black text-white border border-black dark:bg-white dark:text-black dark:border-white'
                : 'bg-[var(--color-surface)] text-[var(--color-text-tertiary)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]'
              }
            `}
          >
            {t(DAY_KEYS[day]!)}
          </button>
        )
      })}
    </div>
  )
}
