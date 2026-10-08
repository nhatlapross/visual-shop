import { ConnectButton } from '@mysten/dapp-kit-react/ui'
import { Glasses } from 'lucide-react'
import { NavLink, Outlet } from 'react-router'
import { isContractConfigured } from '@/config'

const navClass = ({ isActive }: { isActive: boolean }) =>
  `text-sm font-medium ${isActive ? 'text-neutral-900' : 'text-neutral-500 hover:text-neutral-900'}`

export function Layout() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4">
          <NavLink to="/" className="flex items-center gap-2 font-semibold">
            <Glasses className="size-5" /> Visual Shop
          </NavLink>
          <nav className="flex gap-4">
            <NavLink to="/" end className={navClass}>Shop</NavLink>
            <NavLink to="/sell" className={navClass}>Sell</NavLink>
            <NavLink to="/purchases" className={navClass}>My purchases</NavLink>
          </nav>
          <div className="ml-auto">
            <ConnectButton />
          </div>
        </div>
      </header>
      {!isContractConfigured() && (
        <div className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">
          Contract not configured. Run <code>pnpm publish:move</code>, then restart the dev server.
        </div>
      )}
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
