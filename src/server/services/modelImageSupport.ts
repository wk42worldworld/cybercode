import { PROVIDER_PRESETS } from '../config/providerPresets.js'
import type { SavedProvider } from '../types/provider.js'
import { inferModelSupportsImages } from '../../utils/model/imageSupport.js'
import { getLearnedImageSupport } from '../../utils/model/imageCapabilityRegistry.js'

export { inferModelSupportsImages } from '../../utils/model/imageSupport.js'

export type ImageSupportResolution = {
  supportsImages: boolean
  status: 'supported' | 'unsupported' | 'unknown'
  modelId?: string
  providerName?: string
  source:
    | 'official'
    | 'provider-forced'
    | 'provider-legacy'
    | 'learned'
    | 'provider-catalog'
    | 'preset-model'
    | 'model-id'
    | 'preset'
    | 'default'
}

export function normalizeModelId(modelId: string | undefined): string {
  const trimmed = (modelId ?? '').trim()
  return trimmed.replace(/\[(?:1|2)m\]$/i, '')
}

function resolved(
  supportsImages: boolean,
  input: Omit<ImageSupportResolution, 'supportsImages' | 'status'>,
): ImageSupportResolution {
  return {
    supportsImages,
    status: supportsImages ? 'supported' : 'unsupported',
    ...input,
  }
}

export function resolveProviderImageSupport(
  provider: SavedProvider | null | undefined,
  modelId?: string,
): ImageSupportResolution {
  const resolvedModelId = normalizeModelId(modelId || provider?.models.main)

  if (!provider) {
    return resolved(true, {
      ...(resolvedModelId && { modelId: resolvedModelId }),
      source: 'official',
    })
  }

  if (provider.imageSupportMode === 'enabled' || provider.imageSupportMode === 'disabled') {
    return resolved(provider.imageSupportMode === 'enabled', {
      modelId: resolvedModelId,
      providerName: provider.name,
      source: 'provider-forced',
    })
  }

  if (provider.imageSupportMode === undefined && typeof provider.supportsImages === 'boolean') {
    return resolved(provider.supportsImages, {
      modelId: resolvedModelId,
      providerName: provider.name,
      source: 'provider-legacy',
    })
  }

  const learned = getLearnedImageSupport(provider.baseUrl, resolvedModelId)
  if (learned) {
    return resolved(learned.status === 'supported', {
      modelId: resolvedModelId,
      providerName: provider.name,
      source: 'learned',
    })
  }

  const preset = PROVIDER_PRESETS.find((item) => item.id === provider.presetId)
  const catalogModel = provider.modelCatalog?.find((option) =>
    normalizeModelId(option.id).toLowerCase() === resolvedModelId.toLowerCase()
  )
  if (typeof catalogModel?.supportsImages === 'boolean') {
    return resolved(catalogModel.supportsImages, {
      modelId: resolvedModelId,
      providerName: provider.name,
      source: 'provider-catalog',
    })
  }
  const presetModel = preset?.modelOptions?.find((option) =>
    normalizeModelId(option.id).toLowerCase() === resolvedModelId.toLowerCase()
  )
  if (typeof presetModel?.supportsImages === 'boolean') {
    return resolved(presetModel.supportsImages, {
      modelId: resolvedModelId,
      providerName: provider.name,
      source: 'preset-model',
    })
  }

  const inferred = inferModelSupportsImages(resolvedModelId)
  if (typeof inferred === 'boolean') {
    return resolved(inferred, {
      modelId: resolvedModelId,
      providerName: provider.name,
      source: 'model-id',
    })
  }

  if (typeof preset?.supportsImages === 'boolean') {
    return resolved(preset.supportsImages, {
      modelId: resolvedModelId,
      providerName: provider.name,
      source: 'preset',
    })
  }

  return {
    supportsImages: false,
    status: 'unknown',
    modelId: resolvedModelId,
    providerName: provider.name,
    source: 'default',
  }
}
