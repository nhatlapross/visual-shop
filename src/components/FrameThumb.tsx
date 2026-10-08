import { thumbnailUrl } from '@/lib/media'
import { cn } from '@/lib/cn'

interface FrameThumbProps {
  url: string
  type: string
  alt: string
  /** Render width requested from Cloudinary, in px. */
  width?: number
  /** Lift the frame (e.g. the selected one). Hovering a `group` parent does the same. */
  raised?: boolean
  className?: string
}

/** A frame floating on a transparent background; it lifts on hover or when `raised`, always facing front. */
export function FrameThumb({ url, type, alt, width = 600, raised = false, className }: FrameThumbProps) {
  const src = thumbnailUrl(url, type, width)
  if (!src) return <div className={cn('relative', className)} aria-label={alt} />
  return (
    <div className={cn('relative', className)}>
      <img
        src={src}
        alt={alt}
        draggable={false}
        className={cn(
          'absolute inset-0 m-auto max-h-full max-w-full object-contain drop-shadow-[0_10px_12px_rgba(0,0,0,0.25)] transition-transform duration-300 ease-out group-hover:-translate-y-1 group-hover:scale-105',
          raised && '-translate-y-1 scale-105',
        )}
      />
    </div>
  )
}
