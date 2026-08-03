import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CompositionEvent,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'

/**
 * Controlled fields whose value round-trips through graph state break IME
 * composition (notably Chinese input in WKWebView): a stale prop value gets
 * written back mid-composition and the IME buffer is committed as raw Latin
 * letters. Echo edits into local state immediately and only adopt external
 * values that did not originate from this field.
 */
function useImeEcho(
  value: string,
  onChange: ((value: string) => void) | undefined,
) {
  const [draft, setDraft] = useState(value)
  const lastPushedRef = useRef(value)
  const lastSeenValueRef = useRef(value)
  const composingRef = useRef(false)

  useEffect(() => {
    // Only react to value props that actually changed between renders. The
    // graph pipeline repaints nodes once with the stale value before the new
    // one arrives; adopting that repaint would reset the field mid-edit.
    if (value === lastSeenValueRef.current) return
    lastSeenValueRef.current = value
    if (composingRef.current) return
    if (value !== lastPushedRef.current) setDraft(value)
    lastPushedRef.current = value
  }, [value])

  const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    lastPushedRef.current = event.target.value
    setDraft(event.target.value)
    onChange?.(event.target.value)
  }
  const handleCompositionStart = () => {
    composingRef.current = true
  }
  const handleCompositionEnd = (
    event: CompositionEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    composingRef.current = false
    lastPushedRef.current = event.currentTarget.value
    setDraft(event.currentTarget.value)
    onChange?.(event.currentTarget.value)
  }

  return {
    value: draft,
    onChange: handleChange,
    onCompositionStart: handleCompositionStart,
    onCompositionEnd: handleCompositionEnd,
  }
}

export function ImeSafeInput({
  value,
  onChange,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> & {
  value: string
  onChange?: (value: string) => void
}) {
  const echo = useImeEcho(value, onChange)
  return <input {...rest} {...echo} />
}

export function ImeSafeTextarea({
  value,
  onChange,
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> & {
  value: string
  onChange?: (value: string) => void
}) {
  const echo = useImeEcho(value, onChange)
  return <textarea {...rest} {...echo} />
}
