import { Route, Routes } from 'react-router'
import { Layout } from '@/components/Layout'
import { ListingPage } from '@/pages/ListingPage'
import { PurchasesPage } from '@/pages/PurchasesPage'
import { SellPage } from '@/pages/SellPage'
import { ShopPage } from '@/pages/ShopPage'
import { TryOnPage } from '@/pages/TryOnPage'

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
      <Route path="try-on/:id" element={<TryOnPage />} />
    </Routes>
  )
}
