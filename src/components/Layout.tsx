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
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:gap-6">
          <NavLink to="/" className="flex shrink-0 items-center gap-2 font-semibold" aria-label="Visual Shop home">
            <Glasses className="size-5" /> <span className="hidden sm:inline">Visual Shop</span>
          </NavLink>
          <nav className="flex gap-3 whitespace-nowrap sm:gap-4">
            <NavLink to="/store" className={navClass}>Store</NavLink>
            <NavLink to="/sell" className={navClass}>Sell</NavLink>
            <NavLink to="/purchases" className={navClass}><span className="sm:hidden">Purchases</span><span className="hidden sm:inline">My purchases</span></NavLink>
          </nav>
          <div className="ml-auto shrink-0">
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
