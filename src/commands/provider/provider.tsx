import React from 'react'
import { ProviderSetupWizard } from '../../components/providers/ProviderSetupWizard.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { stripSignatureBlocks } from '../../utils/messages.js'

export const call: LocalJSXCommandCall = async (onDone, context) => {
  return <Dialog
    title="Model provider"
    color="permission"
    onCancel={() => onDone('Provider setup dismissed', { display: 'system' })}
  >
    <ProviderSetupWizard
      onComplete={result => {
        context.onChangeAPIKey()
        context.setMessages(stripSignatureBlocks)
        context.setAppState(previous => ({
          ...previous,
          mainLoopModel: result.model,
          mainLoopModelForSession: null,
        }))
        onDone(
          result.isOfficial
            ? 'Switched to Claude Official. Run /login if you are not signed in.'
            : `Switched to ${result.name} (${result.model})`,
          { display: 'system' },
        )
      }}
      onCancel={() => onDone('Provider setup dismissed', { display: 'system' })}
    />
  </Dialog>
}
