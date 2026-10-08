import { useRef, type ChangeEvent } from 'react'
import { ScanLine, Upload } from 'lucide-react'
import { tv } from 'tailwind-variants'

const sourceButton = tv({
  base: 'inline-flex h-9 items-center justify-center gap-1.5 rounded-full px-3.5 text-sm font-medium text-white shadow-sm transition',
  variants: {
    tone: {
      indigo: 'bg-indigo-600 hover:bg-indigo-500',
      emerald: 'bg-emerald-600 hover:bg-emerald-500',
    },
  },
})

interface SellUploadStepButtonsProps {
  onFileSelected: (file: File) => void
  onScan: () => void
}

/** The two ways to add frames: pick a file from the device, or scan with the camera. */
export default function SellUploadStepButtons({ onFileSelected, onScan }: SellUploadStepButtonsProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) onFileSelected(file)
  }

  return (
    <div className="flex flex-wrap items-center justify-center w-full gap-2">
      <button type="button" className={sourceButton({ tone: 'indigo' })} onClick={() => inputRef.current?.click()}>
        <Upload className="size-4" /> Upload file
      </button>

      <button type="button" className={sourceButton({ tone: 'emerald' })} onClick={onScan}>
        <ScanLine className="size-4" /> Scan visual
      </button>

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".jpg,.jpeg,.png,.glb,image/jpeg,image/png,model/gltf-binary"
        onChange={handleChange}
      />
    </div>
  )
}
