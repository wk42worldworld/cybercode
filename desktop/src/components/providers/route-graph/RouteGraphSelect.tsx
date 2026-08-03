import { ChevronDown } from 'lucide-react'

import { Dropdown, type DropdownItem } from '../../shared/Dropdown'

export type RouteGraphSelectOption = DropdownItem<string>

export function RouteGraphSelect({
  label,
  value,
  options,
  variant,
  disabled = false,
  title,
  onChange,
}: {
  label: string
  value: string
  options: readonly RouteGraphSelectOption[]
  variant: 'node' | 'inspector'
  disabled?: boolean
  title?: string
  onChange: (value: string) => void
}) {
  const selectedOption = options.find((option) => option.value === value)
  const selectedLabel = selectedOption?.label ?? value
  const selectedAnnotation = selectedOption?.badge ?? selectedOption?.description
  const selectedAccessibleLabel = selectedAnnotation
    ? `${selectedLabel}, ${selectedAnnotation}`
    : selectedLabel
  const trigger = ({ open, menuId }: { open: boolean; menuId: string }) => (
    <button
      type="button"
      className={`route-graph-select-trigger ${open ? 'is-open' : ''}`}
      disabled={disabled}
      data-route-select-label={label}
      aria-label={`${label}: ${selectedAccessibleLabel}`}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? menuId : undefined}
      title={title ?? selectedAccessibleLabel}
    >
      {variant === 'node' && (
        <span className="route-graph-select-label" aria-hidden="true">{label}</span>
      )}
      <span className="route-graph-select-current">
        <span className="route-graph-select-value">{selectedLabel}</span>
        {selectedAnnotation && (
          <span className="route-graph-select-type" aria-hidden="true">
            {selectedAnnotation}
          </span>
        )}
      </span>
      <ChevronDown size={variant === 'node' ? 13 : 14} strokeWidth={2} aria-hidden="true" />
    </button>
  )

  if (variant === 'node') {
    return (
      <Dropdown
        items={options}
        value={value}
        onChange={onChange}
        trigger={trigger}
        width={220}
        className="route-graph-select route-graph-select-node"
        disabled={disabled}
        ariaLabel={label}
        density="compact"
      />
    )
  }

  return (
    <div className="route-graph-field route-graph-select-inspector">
      <span className="route-graph-field-label">{label}</span>
      <Dropdown
        items={options}
        value={value}
        onChange={onChange}
        trigger={trigger}
        width="100%"
        className="route-graph-select-dropdown"
        disabled={disabled}
        ariaLabel={label}
        density="compact"
      />
    </div>
  )
}
