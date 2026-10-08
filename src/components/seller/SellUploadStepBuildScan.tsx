/** Decorative "scanning" layer drawn over the photo while it is being turned into 3D. */
export default function SellUploadStepBuildScan() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-neutral-950/35" />

      <div className="sell-scan-grid absolute inset-0" />

      <div className="absolute inset-x-0 top-0 h-[30%] animate-sell-scan motion-reduce:hidden">
        <div className="size-full bg-linear-to-b from-transparent to-emerald-300/45" />

        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-emerald-200 shadow-[0_0_14px_3px_rgba(110,231,183,0.9)]" />
      </div>

      <div className="absolute top-3 left-3 size-8 rounded-tl-xl border-t-4 border-l-4 border-emerald-300" />

      <div className="absolute top-3 right-3 size-8 rounded-tr-xl border-t-4 border-r-4 border-emerald-300" />

      <div className="absolute bottom-3 left-3 size-8 rounded-bl-xl border-b-4 border-l-4 border-emerald-300" />

      <div className="absolute right-3 bottom-3 size-8 rounded-br-xl border-r-4 border-b-4 border-emerald-300" />

      <p className="absolute top-4 left-1/2 -translate-x-1/2 rounded-full bg-emerald-950/70 px-3 py-1 text-xs font-medium tracking-widest text-emerald-200 uppercase">
        Scanning
      </p>
    </div>
  )
}
