import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router'
import { Layout } from '@/components/Layout'
import { ListingPage } from '@/pages/ListingPage'
import { PurchasesPage } from '@/pages/PurchasesPage'
import { SellPage } from '@/pages/SellPage'
import { ShopPage } from '@/pages/ShopPage'
import { TryOnPage } from '@/pages/TryOnPage'

// Camera + three.js + MediaPipe: loaded only when the store opens.
const StorePage = lazy(() => import('@/pages/StorePage').then((m) => ({ default: m.StorePage })))

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<ShopPage />} />
        <Route path="listing/:id" element={<ListingPage />} />
        <Route path="sell" element={<SellPage />} />
        <Route path="purchases" element={<PurchasesPage />} />
      </Route>
      {/* Full-screen camera view, no header. */}
      <Route
        path="store"
        element={
          <Suspense fallback={<div className="min-h-screen bg-[#0B0F19]" />}>
            <StorePage />
          </Suspense>
        }
      />
      <Route path="try-on/:id" element={<TryOnPage />} />
    </Routes>
  )
}
