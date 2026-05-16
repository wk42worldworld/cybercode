import { Icon } from './Icon'

/* Cyberpunk-refined avatar: accent border, hash-based identity gradients,
 * green glow for online status. */

const PALETTE = [
  { from: '#00f0ff', to: '#0a84ff' }, // electric cyan → blue
  { from: '#7C3AED', to: '#C084FC' }, // violet
  { from: '#F59E0B', to: '#FBBF24' }, // amber
  { from: '#10B981', to: '#34D399' }, // emerald
  { from: '#EC4899', to: '#F472B6' }, // pink
  { from: '#14B8A6', to: '#22D3EE' }, // teal
  { from: '#8B5CF6', to: '#A78BFA' }, // indigo
  { from: '#F97316', to: '#FB923C' }, // orange
] as const

function colorFor(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]!
}

type Variant = 'tile' | 'circle'

type Props = {
  seed: string
  /** "AB" for providers, blank for icon-only */
  initials?: string
  /** Material icon name; renders instead of initials when provided */
  icon?: string
  /** "tile" → squircle (providers/agents), "circle" → round (mcp/skills) */
  variant?: Variant
  size?: number
  /** Visually emphasise the active item (accent glow ring) */
  active?: boolean
  /** Show green online indicator */
  online?: boolean
}

export function Avatar({ seed, initials, icon, variant = 'tile', size = 44, active = false, online = false }: Props) {
  const c = colorFor(seed)
  const radius = variant === 'circle' ? '9999px' : `${Math.round(size * 0.32)}px`
  const ringStyle = active
    ? `0 0 0 2px var(--color-accent-glow), 0 0 0 3px var(--color-brand), 0 0 16px var(--color-accent-glow)`
    : `0 0 0 1px var(--color-border), 0 4px 12px ${c.from}30`

  return (
    <div className="relative inline-flex shrink-0">
      <div
        className="flex items-center justify-center font-bold tracking-tight text-white"
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          background: `linear-gradient(135deg, ${c.from} 0%, ${c.to} 100%)`,
          boxShadow: ringStyle,
          fontSize: Math.round(size * 0.36),
          letterSpacing: '-0.01em',
          fontFamily: 'var(--font-label)',
        }}
      >
        {icon ? (
          <Icon name={icon} size={Math.round(size * 0.5)} className="text-white drop-shadow-sm" />
        ) : (
          initials
        )}
      </div>
      {online && (
        <span
          className="absolute -right-0.5 -bottom-0.5 rounded-full border-2 border-[var(--color-surface-container-lowest)]"
          style={{
            width: Math.round(size * 0.26),
            height: Math.round(size * 0.26),
            backgroundColor: 'var(--color-success)',
            boxShadow: '0 0 6px var(--color-success)',
          }}
        />
      )}
    </div>
  )
}
