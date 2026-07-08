import { PROVIDER_PRESETS } from '../config/providerPresets.js'
import type { SavedProvider } from '../types/provider.js'
import { inferModelSupportsImages } from '../../utils/model/imageSupport.js'

export { inferModelSupportsImages } from '../../utils/model/imageSupport.js'

export type ImageSupportResolution = {
  supportsImages: boolean
  modelId?: string
  providerName?: string
  source:
    | 'official'
    | 'provider-forced'
    | 'provider-legacy'
    | 'preset-model'
    | 'model-id'
    | 'preset'
    | 'default'
}

export function normalizeModelId(modelId: string | undefined): string {
  const trimmed = (modelId ?? '').trim()
  return trimmed.replace(/:(?:\d+(?:k|m)?|[a-z]+)$/i, '')
}

export function resolveProviderImageSupport(
  provider: SavedProvider | null | undefined,
  modelId?: string,
): ImageSupportResolution {
  const resolvedModelId = normalizeModelId(modelId || provider?.models.main)

  if (!provider) {
    return {
      supportsImages: true,
      ...(resolvedModelId && { modelId: resolvedModelId }),
      source: 'official',
    }
  }

  if (provider.imageSupportMode === 'enabled' || provider.imageSupportMode === 'disabled') {
    return {
      supportsImages: provider.imageSupportMode === 'enabled',
      modelId: resolvedModelId,
      providerName: provider.name,
      source: 'provider-forced',
    }
  }

  if (provider.imageSupportMode === undefined && typeof provider.supportsImages === 'boolean') {
    return {
      supportsImages: provider.supportsImages,
      modelId: resolvedModelId,
      providerName: provider.name,
      source: 'provider-legacy',
    }
  }

  const preset = PROVIDER_PRESETS.find((item) => item.id === provider.presetId)
  const presetModel = preset?.modelOptions?.find((option) =>
    normalizeModelId(option.id).toLowerCase() === resolvedModelId.toLowerCase()
  )
  if (typeof presetModel?.supportsImages === 'boolean') {
    return {
      supportsImages: presetModel.supportsImages,
      modelId: resolvedModelId,
      providerName: provider.name,
      source: 'preset-model',
    }
  }

  const inferred = inferModelSupportsImages(resolvedModelId)
  if (typeof inferred === 'boolean') {
    return {
      supportsImages: inferred,
      modelId: resolvedModelId,
      providerName: provider.name,
      source: 'model-id',
    }
  }

  if (typeof preset?.supportsImages === 'boolean') {
    return {
      supportsImages: preset.supportsImages,
      modelId: resolvedModelId,
      providerName: provider.name,
      source: 'preset',
    }
  }

  return {
    supportsImages: true,
    modelId: resolvedModelId,
    providerName: provider.name,
    source: 'default',
  }
}
