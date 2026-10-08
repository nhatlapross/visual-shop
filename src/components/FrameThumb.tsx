import { thumbnailUrl } from '@/lib/media'
import { cn } from '@/lib/cn'

interface FrameThumbProps {
  url: string
  type: string
  alt: string
  /** Render width requested from Cloudinary, in px. */
  width?: number
  /** Show the three-quarter view (e.g. the selected frame). Hovering a `group` parent does the same. */
  turned?: boolean
  className?: string
}

/**
 * A frame floating on a transparent background. GLB listings cross-fade from the front view
 * to a three-quarter view on hover or when `turned`, so the frame seems to turn toward you.
 */
export function FrameThumb({ url, type, alt, width = 600, turned = false, className }: FrameThumbProps) {
  const front = thumbnailUrl(url, type, width)
  const angle = type === 'glb' ? thumbnailUrl(url, type, width, 'angle') : ''
  const img = 'absolute inset-0 m-auto max-h-full max-w-full object-contain drop-shadow-[0_10px_12px_rgba(0,0,0,0.25)] transition-all duration-500 ease-out'

  if (!front) return <div className={cn('relative', className)} aria-label={alt} />
  return (
    <div className={cn('relative', className)}>
      <img
        src={front}
        alt={alt}
        draggable={false}
        className={cn(img, angle && 'group-hover:scale-95 group-hover:opacity-0', angle && turned && 'scale-95 opacity-0')}
      />
      {angle && (
        <img
          src={angle}
          alt=""
          aria-hidden
          draggable={false}
          className={cn(img, 'scale-95 opacity-0 group-hover:scale-105 group-hover:opacity-100', turned && 'scale-105 opacity-100')}
        />
      )}
    </div>
  )
}
