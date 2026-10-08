// Lane B owns this page (docs/plan.md, tasks B1–B3):
// photos → 3D studio (ported from port/components/eyewear-lab.tsx) → upload photo + GLB to Walrus → create_listing.
export function SellPage() {
  return (
    <section>
      <h1 className="text-2xl font-semibold">List your eyewear</h1>
      <p className="mt-2 text-neutral-600">Upload 1–6 photos and we build a 3D model buyers can try on.</p>
      <p className="mt-6 text-sm text-neutral-400">TODO(B1–B3): studio + publish form.</p>
    </section>
  )
}
