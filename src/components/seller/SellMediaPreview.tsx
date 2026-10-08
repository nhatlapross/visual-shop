import { Box } from 'lucide-react'
import type { SellMedia } from './sellTypes'

interface SellMediaPreviewProps {
  media: SellMedia
}

/** Square, like the shop card: the model's rendered snapshot, or a cube for a GLB uploaded directly. */
export default function SellMediaPreview({ media }: SellMediaPreviewProps) {
  return media.previewUrl ? (
    <img src={media.previewUrl} alt={media.type === 'glb' ? '3D model preview' : 'Image preview'} className="aspect-square w-full bg-neutral-100 object-contain" />
  ) : (
    <div className="grid aspect-square w-full place-items-center bg-linear-to-br from-indigo-50 to-neutral-100 text-indigo-400">
      <Box className="size-16" />
    </div>
  )
}
