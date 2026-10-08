import { Link, useParams } from 'react-router'

// Lane C owns this page (docs/plan.md, tasks C1–C3): port/components/ai-ar-tryon.tsx fed by the listing's GLB.
export function TryOnPage() {
  const { id } = useParams()
  return (
    <section className="flex min-h-screen flex-col items-center justify-center gap-4 bg-black text-white">
      <p>TODO(C1–C3): camera try-on for listing {id}</p>
      <Link to={`/listing/${id}`} className="underline">Back to listing</Link>
    </section>
  )
}
