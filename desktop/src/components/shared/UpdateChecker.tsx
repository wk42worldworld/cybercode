import { useEffect } from 'react'
import { isTauriRuntime } from '../../lib/desktopRuntime'
import { useUpdateStore } from '../../stores/updateStore'

export function UpdateChecker() {
  const initialize = useUpdateStore((s) => s.initialize)

  useEffect(() => {
    void initialize()
  }, [initialize])

  if (!isTauriRuntime()) return null

  return null
}
