import { useMemo, useState } from 'react'
import { ImageGalleryModal } from './ImageGalleryModal'
import { Icon } from '../shared/Icon'

export type AttachmentPreview = {
  id?: string
  type: 'image' | 'file'
  name: string
  data?: string
  previewUrl?: string
}

type Props = {
  attachments: AttachmentPreview[]
  variant?: 'composer' | 'message'
  onRemove?: (id: string) => void
}

export function AttachmentGallery({ attachments, variant = 'message', onRemove }: Props) {
  const [activeImageIndex, setActiveImageIndex] = useState<number | null>(null)

  const images = useMemo(
    () =>
      attachments
        .filter((attachment) => attachment.type === 'image' && (attachment.previewUrl || attachment.data))
        .map((attachment) => ({
          src: attachment.previewUrl || attachment.data || '',
          name: attachment.name,
        })),
    [attachments],
  )

  if (attachments.length === 0) return null

  const isComposer = variant === 'composer'
  const messageAttachmentSurfaceStyle = isComposer
    ? undefined
    : {
        background: 'color-mix(in srgb, var(--color-message-user-fg) 10%, transparent)',
        borderColor: 'color-mix(in srgb, var(--color-message-user-fg) 14%, transparent)',
        color: 'var(--color-message-user-fg)',
      }

  return (
    <>
      <div className={isComposer ? 'flex flex-wrap items-center gap-2' : 'grid max-w-full grid-cols-1 gap-2 sm:grid-cols-2'}>
        {attachments.map((attachment, index) => {
          if (attachment.type === 'image' && (attachment.previewUrl || attachment.data)) {
            const src = attachment.previewUrl || attachment.data || ''
            return (
              <div
                key={attachment.id || `${attachment.name}-${index}`}
                className={isComposer ? 'group relative' : 'min-w-0'}
              >
                <button
                  type="button"
                  onClick={() => setActiveImageIndex(images.findIndex((image) => image.src === src))}
                  className={
                    isComposer
                      ? 'overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface-container-low)] hover:border-[var(--color-brand)] transition-colors'
                      : 'block max-w-full overflow-hidden rounded-[14px] border text-left transition-opacity duration-100 hover:opacity-90'
                  }
                  style={messageAttachmentSurfaceStyle}
                >
                  <img
                    src={src}
                    alt={attachment.name}
                    className={
                      isComposer
                        ? 'h-16 w-16 object-cover'
                        : 'block max-h-[340px] w-auto max-w-full object-contain'
                    }
                  />
                </button>
                {onRemove && attachment.id && (
                  <button
                    type="button"
                    onClick={() => onRemove(attachment.id!)}
                    className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-error)] text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100"
                    aria-label={`Remove ${attachment.name}`}
                  >
                    ×
                  </button>
                )}
              </div>
            )
          }

          return (
            <div
              key={attachment.id || `${attachment.name}-${index}`}
              className={
                isComposer
                  ? 'flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 py-2 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-brand)]'
                  : 'flex min-w-0 items-center gap-2 rounded-[12px] border px-3 py-2 text-[12px] transition-opacity hover:opacity-90'
              }
              style={messageAttachmentSurfaceStyle}
            >
              <Icon name="attach_file" size={14} />
              <span className="max-w-[220px] truncate">{attachment.name}</span>
              {onRemove && attachment.id && (
                <button
                  type="button"
                  onClick={() => onRemove(attachment.id!)}
                  className="ml-1 text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-error)]"
                  aria-label={`Remove ${attachment.name}`}
                >
                  <Icon name="close" size={14} />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {activeImageIndex !== null && activeImageIndex >= 0 && (
        <ImageGalleryModal
          open={activeImageIndex !== null}
          images={images}
          activeIndex={activeImageIndex}
          onClose={() => setActiveImageIndex(null)}
          onSelect={setActiveImageIndex}
        />
      )}
    </>
  )
}
