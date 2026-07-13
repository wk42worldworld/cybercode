import type { CSSProperties } from 'react'
import {
  resolveProviderIdentity,
  type ProviderLogoIdentity,
  type ProviderLogoMotif,
} from './providerIdentity'

type ProviderLogoSize = 'xs' | 'sm' | 'md' | 'lg'

type ProviderLogoProps = {
  name: string
  providerId?: string | null
  baseUrl?: string | null
  modelId?: string | null
  active?: boolean
  decorative?: boolean
  size?: ProviderLogoSize
  className?: string
}

const SIZE_CLASS_NAMES: Record<ProviderLogoSize, string> = {
  xs: 'h-[22px] w-[22px] rounded-[7px]',
  sm: 'h-[30px] w-[30px] rounded-[9px]',
  md: 'h-[40px] w-[40px] rounded-[11px]',
  lg: 'h-[50px] w-[50px] rounded-[13px]',
}

const GLYPH_SIZE: Record<ProviderLogoSize, number> = {
  xs: 16,
  sm: 21,
  md: 28,
  lg: 34,
}

export function ProviderLogo({
  name,
  providerId,
  baseUrl,
  modelId,
  active = false,
  decorative = false,
  size = 'lg',
  className = '',
}: ProviderLogoProps) {
  const identity = resolveProviderIdentity({ providerId, name, baseUrl, modelId })
  const label = name.trim() || identity.label
  const usesAsset = Boolean(identity.assetSrc)
  const style = {
    '--provider-accent': identity.accent,
    borderColor: active ? identity.accent : hexToRgba(identity.accent, 0.2),
    background: active
      ? `linear-gradient(145deg, ${hexToRgba(identity.accent, 0.16)} 0%, rgba(255,255,255,0) 100%), var(--color-surface-container-lowest)`
      : `linear-gradient(145deg, ${hexToRgba(identity.accent, 0.09)} 0%, rgba(255,255,255,0) 100%), var(--color-surface-container-lowest)`,
    boxShadow: active
      ? `0 0 0 1px ${hexToRgba(identity.accent, 0.15)}, 0 10px 24px ${hexToRgba(identity.accent, 0.13)}`
      : `0 1px 2px rgba(15, 23, 42, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.45)`,
  } as CSSProperties
  const assetScale = `${Math.round((identity.assetScale ?? 0.7) * 100)}%`

  return (
    <div
      aria-label={!usesAsset && !decorative ? `${label} logo` : undefined}
      role={!usesAsset && !decorative ? 'img' : undefined}
      data-provider-logo={identity.id}
      data-provider-logo-kind={usesAsset ? 'asset' : 'generated'}
      className={`relative flex shrink-0 items-center justify-center overflow-hidden border transition-[border-color,box-shadow,transform] duration-150 ${SIZE_CLASS_NAMES[size]} ${className}`}
      style={style}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-[2px] rounded-[inherit] border border-white/35 dark:border-white/10"
      />
      {usesAsset ? (
        <img
          src={identity.assetSrc}
          alt={decorative ? '' : `${label} logo`}
          aria-hidden={decorative ? true : undefined}
          className="relative z-[1] block select-none"
          decoding="async"
          draggable={false}
          style={{
            width: assetScale,
            height: assetScale,
            objectFit: 'contain',
            filter: identity.assetShadow === false
              ? undefined
              : 'drop-shadow(0 1px 1px rgba(15, 23, 42, 0.10))',
          }}
        />
      ) : (
        <ProviderGeneratedGlyph
          identity={identity}
          motif={identity.motif}
          size={GLYPH_SIZE[size]}
        />
      )}
    </div>
  )
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return `rgba(15, 23, 42, ${alpha})`
  const red = parseInt(normalized.slice(0, 2), 16)
  const green = parseInt(normalized.slice(2, 4), 16)
  const blue = parseInt(normalized.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

function ProviderGeneratedGlyph({
  identity,
  motif,
  size,
}: {
  identity: ProviderLogoIdentity
  motif: ProviderLogoMotif
  size: number
}) {
  const sharedProps = {
    width: size,
    height: size,
    viewBox: '0 0 40 40',
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg',
    className: 'relative z-[1]',
    'aria-hidden': true,
  } as const

  if (motif === 'orbit') {
    return (
      <svg {...sharedProps}>
        <circle cx="20" cy="20" r="12.5" stroke="var(--provider-accent)" strokeWidth="3" opacity="0.92" />
        <path d="M9 22c5.5-8.5 16.5-10.8 23-4.5" stroke="var(--provider-accent)" strokeWidth="2.8" strokeLinecap="round" opacity="0.72" />
        <circle cx="29" cy="15" r="3.2" fill="var(--provider-accent)" />
      </svg>
    )
  }

  if (motif === 'spark') {
    return (
      <svg {...sharedProps}>
        <path d="M20 5l4.8 10.2L35 20l-10.2 4.8L20 35l-4.8-10.2L5 20l10.2-4.8L20 5z" fill="var(--provider-accent)" opacity="0.92" />
        <path d="M20 12l2.6 5.4L28 20l-5.4 2.6L20 28l-2.6-5.4L12 20l5.4-2.6L20 12z" fill="white" opacity="0.86" />
      </svg>
    )
  }

  if (motif === 'blocks') {
    return (
      <svg {...sharedProps}>
        <rect x="7" y="8" width="9" height="9" rx="2" fill="var(--provider-accent)" opacity="0.72" />
        <rect x="18" y="8" width="15" height="9" rx="2" fill="var(--provider-accent)" />
        <rect x="7" y="19" width="15" height="13" rx="2" fill="var(--provider-accent)" />
        <rect x="24" y="21" width="9" height="11" rx="2" fill="var(--provider-accent)" opacity="0.78" />
      </svg>
    )
  }

  if (motif === 'slash') {
    return (
      <svg {...sharedProps}>
        <path d="M10 10l20 20" stroke="var(--provider-accent)" strokeWidth="5" strokeLinecap="round" />
        <path d="M30 10L10 30" stroke="var(--provider-accent)" strokeWidth="3.5" strokeLinecap="round" opacity="0.62" />
      </svg>
    )
  }

  if (motif === 'loop') {
    return (
      <svg {...sharedProps}>
        <path
          d="M7 24c4.4-10 8.4-14 13-4.2C24.6 10 28.6 14 33 24c-5.7 3.2-10.3 1.7-13-4.2C17.3 25.7 12.7 27.2 7 24z"
          stroke="var(--provider-accent)"
          strokeWidth="3.2"
          strokeLinejoin="round"
        />
      </svg>
    )
  }

  if (motif === 'chip') {
    return (
      <svg {...sharedProps}>
        <rect x="10" y="10" width="20" height="20" rx="5" stroke="var(--provider-accent)" strokeWidth="3" />
        <rect x="16" y="16" width="8" height="8" rx="2" fill="var(--provider-accent)" />
        <path d="M4 15h6M4 25h6M30 15h6M30 25h6M15 4v6M25 4v6M15 30v6M25 30v6" stroke="var(--provider-accent)" strokeWidth="2.2" strokeLinecap="round" opacity="0.72" />
      </svg>
    )
  }

  return (
    <span
      aria-hidden="true"
      className="relative z-[1] flex h-[72%] w-[72%] items-center justify-center rounded-[inherit] text-center font-black leading-none tracking-normal text-white"
      style={{
        background: 'var(--provider-accent)',
        fontSize: Math.max(9, Math.round(size * 0.34)),
      }}
    >
      {identity.initials.slice(0, 2)}
    </span>
  )
}
