import React, { useEffect, useMemo, useState } from 'react'
import { Box, Link, Text, useInput } from '../../ink.js'
import { PROVIDER_PRESETS, type ProviderPreset } from '../../server/config/providerPresets.js'
import { activateProviderForCli } from '../../server/proxy/embeddedProxy.js'
import { ProviderService } from '../../server/services/providerService.js'
import type { ApiFormat, SavedProvider } from '../../server/types/provider.js'
import TextInput from '../TextInput.js'
import { Select } from '../CustomSelect/select.js'

type Step =
  | 'loading'
  | 'provider'
  | 'model'
  | 'model-input'
  | 'custom-name'
  | 'custom-url'
  | 'custom-format'
  | 'api-key'
  | 'saving'
  | 'error'

export type ProviderSetupResult = {
  isOfficial: boolean
  name: string
  providerId: string | null
  model: string | null
}

type Props = {
  onComplete: (result: ProviderSetupResult) => void
  onCancel?: () => void
  allowCancel?: boolean
}

const INPUT_STEPS = new Set<Step>([
  'model-input',
  'custom-name',
  'custom-url',
  'api-key',
])

function contextWindowsForModel(preset: ProviderPreset, modelId: string) {
  const contextWindow = preset.modelOptions?.find(model => model.id === modelId)?.contextWindow
  if (!contextWindow) return preset.defaultModelContextWindows
  return {
    main: contextWindow,
    haiku: contextWindow,
    sonnet: contextWindow,
    opus: contextWindow,
  }
}

export function ProviderSetupWizard({
  onComplete,
  onCancel,
  allowCancel = true,
}: Props): React.ReactNode {
  const [step, setStep] = useState<Step>('loading')
  const [providers, setProviders] = useState<SavedProvider[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [preset, setPreset] = useState<ProviderPreset | null>(null)
  const [model, setModel] = useState('')
  const [customName, setCustomName] = useState('')
  const [customUrl, setCustomUrl] = useState('')
  const [customFormat, setCustomFormat] = useState<ApiFormat>('anthropic')
  const [inputValue, setInputValue] = useState('')
  const [cursorOffset, setCursorOffset] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void new ProviderService()
      .listProviders()
      .then(result => {
        if (cancelled) return
        setProviders(result.providers)
        setActiveId(result.activeId)
        setStep('provider')
      })
      .catch(loadError => {
        if (cancelled) return
        setError(loadError instanceof Error ? loadError.message : String(loadError))
        setStep('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  function beginInput(nextStep: Step, initialValue = ''): void {
    setInputValue(initialValue)
    setCursorOffset(initialValue.length)
    setStep(nextStep)
  }

  function returnToProviderList(): void {
    setPreset(null)
    setModel('')
    setInputValue('')
    setError('')
    setStep('provider')
  }

  function handleBack(): void {
    if (step === 'api-key') {
      if (preset?.id === 'custom') beginInput('model-input', model)
      else setStep('model')
      return
    }
    if (step === 'custom-url') {
      beginInput('custom-name', customName)
      return
    }
    if (step === 'model-input') {
      if (preset?.id === 'custom') setStep('custom-format')
      else setStep('model')
      return
    }
    if (step === 'custom-name' || step === 'model') {
      returnToProviderList()
      return
    }
    if (step === 'custom-format') {
      beginInput('custom-url', customUrl)
      return
    }
    if (step === 'provider' && allowCancel) onCancel?.()
  }

  useInput(
    (_input, key) => {
      if (key.escape) handleBack()
    },
    { isActive: INPUT_STEPS.has(step) },
  )

  async function finishOfficial(): Promise<void> {
    setStep('saving')
    try {
      await activateProviderForCli(null)
      onComplete({
        isOfficial: true,
        name: 'Claude Official',
        providerId: null,
        model: null,
      })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
      setStep('error')
    }
  }

  async function finishSavedProvider(provider: SavedProvider): Promise<void> {
    setStep('saving')
    try {
      await activateProviderForCli(provider.id)
      onComplete({
        isOfficial: false,
        name: provider.name,
        providerId: provider.id,
        model: provider.models.main,
      })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
      setStep('error')
    }
  }

  async function saveNewProvider(
    apiKey: string,
    selectedModel = model,
  ): Promise<void> {
    if (!preset || !selectedModel) return
    setStep('saving')

    try {
      const name = preset.id === 'custom' ? customName.trim() : preset.name
      const baseUrl = preset.id === 'custom' ? customUrl.trim() : preset.baseUrl
      const apiFormat = preset.id === 'custom' ? customFormat : preset.apiFormat
      const contextWindows = contextWindowsForModel(preset, selectedModel)
      const provider = await new ProviderService().addProvider({
        presetId: preset.id,
        name,
        apiKey: apiKey.trim(),
        baseUrl,
        apiFormat,
        models: {
          main: selectedModel,
          haiku: selectedModel,
          sonnet: selectedModel,
          opus: selectedModel,
        },
        modelCatalog: preset.modelOptions,
        modelContextWindows: contextWindows,
        imageSupportMode: 'auto',
      })
      await activateProviderForCli(provider.id)
      onComplete({
        isOfficial: false,
        name: provider.name,
        providerId: provider.id,
        model: provider.models.main,
      })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
      setStep('error')
    }
  }

  function finishModelSelection(selectedModel: string): void {
    setModel(selectedModel)
    if (preset?.needsApiKey) beginInput('api-key')
    else void saveNewProvider('', selectedModel)
  }

  function selectPreset(selectedPreset: ProviderPreset): void {
    setPreset(selectedPreset)
    if (selectedPreset.id === 'custom') {
      beginInput('custom-name', 'Custom provider')
      return
    }
    setModel(selectedPreset.defaultModels.main)
    setStep('model')
  }

  const providerOptions = useMemo(() => {
    const savedOptions = providers.map(provider => ({
      label: provider.name,
      value: `saved:${provider.id}`,
      description: provider.id === activeId
        ? `Active · ${provider.models.main}`
        : `Saved · ${provider.models.main}`,
    }))
    return [
      ...savedOptions,
      {
        label: 'Claude Official',
        value: 'official',
        description: activeId === null ? 'Active · Anthropic account or API key' : 'Anthropic account or API key',
      },
      ...PROVIDER_PRESETS
        .filter(item => item.id !== 'official')
        .map(item => ({
          label: `Configure ${item.name}`,
          value: `preset:${item.id}`,
          description: item.id === 'custom'
            ? 'Anthropic or OpenAI-compatible endpoint'
            : item.apiFormat === 'anthropic'
              ? 'Direct connection'
              : 'Built-in protocol bridge',
        })),
    ]
  }, [activeId, providers])

  if (step === 'loading') {
    return <Text dimColor>Loading model providers...</Text>
  }

  if (step === 'saving') {
    return <Text dimColor>Saving provider and preparing the connection...</Text>
  }

  if (step === 'error') {
    return <Box flexDirection="column" gap={1}>
      <Text color="error">Could not configure the provider: {error}</Text>
      <Select
        options={[{ label: 'Back to provider list', value: 'back' }]}
        onChange={returnToProviderList}
        onCancel={allowCancel ? onCancel : undefined}
      />
    </Box>
  }

  if (step === 'provider') {
    return <Box flexDirection="column" gap={1}>
      <Text bold>Choose a model provider</Text>
      <Text dimColor>CyberCode includes the protocol bridge. No extra proxy installation is needed.</Text>
      <Select
        options={providerOptions}
        visibleOptionCount={10}
        layout="compact-vertical"
        defaultFocusValue={activeId ? `saved:${activeId}` : 'official'}
        onChange={value => {
          if (value === 'official') {
            void finishOfficial()
            return
          }
          if (value.startsWith('saved:')) {
            const saved = providers.find(provider => provider.id === value.slice(6))
            if (saved) void finishSavedProvider(saved)
            return
          }
          const selectedPreset = PROVIDER_PRESETS.find(item => item.id === value.slice(7))
          if (selectedPreset) selectPreset(selectedPreset)
        }}
        onCancel={allowCancel ? onCancel : undefined}
      />
    </Box>
  }

  if (step === 'model' && preset) {
    const options = [
      ...(preset.modelOptions ?? []).map(option => ({
        label: option.label ?? option.id,
        value: option.id,
        description: option.id,
      })),
      {
        label: 'Enter another model ID',
        value: '__custom__',
        description: 'Use a model not listed above',
      },
    ]
    return <Box flexDirection="column" gap={1}>
      <Text bold>Choose the default {preset.name} model</Text>
      <Text dimColor>This model will be used for the main agent and sub-agents.</Text>
      <Select
        options={options}
        visibleOptionCount={8}
        defaultFocusValue={model || preset.defaultModels.main}
        onChange={value => {
          if (value === '__custom__') beginInput('model-input', model)
          else finishModelSelection(value)
        }}
        onCancel={returnToProviderList}
      />
    </Box>
  }

  if (step === 'custom-format') {
    return <Box flexDirection="column" gap={1}>
      <Text bold>Which API protocol does this endpoint expose?</Text>
      <Select
        options={[
          { label: 'Anthropic Messages', value: 'anthropic' as const, description: 'Direct connection' },
          { label: 'OpenAI Chat Completions', value: 'openai_chat' as const, description: 'Uses CyberCode built-in bridge' },
          { label: 'OpenAI Responses', value: 'openai_responses' as const, description: 'Uses CyberCode built-in bridge' },
        ]}
        defaultFocusValue={customFormat}
        onChange={format => {
          setCustomFormat(format)
          beginInput('model-input')
        }}
        onCancel={() => beginInput('custom-url', customUrl)}
      />
    </Box>
  }

  const inputConfig = (() => {
    if (step === 'custom-name') {
      return {
        title: 'Name this provider',
        hint: 'This name is only shown inside CyberCode.',
        placeholder: 'My model provider',
        mask: undefined,
        submit(value: string) {
          if (!value.trim()) return
          setCustomName(value.trim())
          beginInput('custom-url')
        },
      }
    }
    if (step === 'custom-url') {
      return {
        title: 'Enter the API Base URL',
        hint: 'Example: https://api.example.com',
        placeholder: 'https://api.example.com',
        mask: undefined,
        submit(value: string) {
          try {
            const parsed = new URL(value.trim())
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
              throw new Error('Unsupported URL protocol')
            }
          } catch {
            setError('Enter a valid http:// or https:// URL')
            return
          }
          setError('')
          setCustomUrl(value.trim().replace(/\/+$/, ''))
          setStep('custom-format')
        },
      }
    }
    if (step === 'model-input') {
      return {
        title: 'Enter the model ID',
        hint: 'Use the exact model ID accepted by the provider.',
        placeholder: 'model-id',
        mask: undefined,
        submit(value: string) {
          if (!value.trim()) return
          const selectedModel = value.trim()
          setModel(selectedModel)
          if (preset?.needsApiKey) beginInput('api-key')
          else void saveNewProvider('', selectedModel)
        },
      }
    }
    return {
      title: `Enter the ${preset?.name ?? 'provider'} API key`,
      hint: preset?.id === 'custom'
        ? 'Leave it empty only when the endpoint does not require authentication.'
        : 'The key is stored locally in your CyberCode configuration.',
      placeholder: 'API key',
      mask: '*',
      submit(value: string) {
        if (preset?.id !== 'custom' && !value.trim()) return
        void saveNewProvider(value)
      },
    }
  })()

  return <Box flexDirection="column" gap={1}>
    <Text bold>{inputConfig.title}</Text>
    <Text dimColor>{inputConfig.hint}</Text>
    {step === 'api-key' && preset?.apiKeyUrl ? <Text dimColor>Get a key: <Link url={preset.apiKeyUrl} /></Text> : null}
    {error ? <Text color="error">{error}</Text> : null}
    <Box borderStyle="round" borderDimColor paddingX={1} width={68}>
      <TextInput
        value={inputValue}
        onChange={value => {
          setInputValue(value)
          setCursorOffset(value.length)
          if (error) setError('')
        }}
        onSubmit={inputConfig.submit}
        onExit={allowCancel ? onCancel : undefined}
        placeholder={inputConfig.placeholder}
        mask={inputConfig.mask}
        columns={64}
        cursorOffset={cursorOffset}
        onChangeCursorOffset={setCursorOffset}
        focus
        showCursor
      />
    </Box>
    <Text dimColor>Enter to continue · Esc to go back</Text>
  </Box>
}
