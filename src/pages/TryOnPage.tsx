import { Navigate, useParams } from 'react-router'

/** Old `/try-on/:id` links open the try-on store with that frame preselected. */
export function TryOnPage() {
  const { id } = useParams()
  return <Navigate to={id ? `/store?frame=${encodeURIComponent(id)}` : '/store'} replace />
}
