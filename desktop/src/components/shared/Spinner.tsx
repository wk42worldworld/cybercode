type SpinnerProps = {
  size?: number
  className?: string
}

export function Spinner({ size = 20, className = '' }: SpinnerProps) {
  const dotSize = Math.max(3, Math.round(size * 0.2))
  const gap = Math.max(3, Math.round(size * 0.16))
  const containerHeight = dotSize + 2

  return (
    <span
      className={`inline-flex items-center ${className}`}
      style={{ width: size, height: containerHeight, gap }}
      role="status"
      aria-label="Loading"
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="animate-pulse-dot rounded-full bg-[var(--color-brand)]"
          style={{
            width: dotSize,
            height: dotSize,
            animationDelay: `${i * 0.2}s`,
          }}
        />
      ))}
    </span>
  )
}
