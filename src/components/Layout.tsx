import { ConnectButton } from '@mysten/dapp-kit-react/ui'
import { Glasses, Menu, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { isContractConfigured } from '@/config'
import { cn } from '@/lib/cn'

interface LayoutNavItem {
  to: string
  label: string
  // Pathname prefixes that light this item up. /store has no header, so the
  // listing detail it leads to is what keeps Store active.
  paths: string[]
}

const navItems: LayoutNavItem[] = [
  { to: '/store', label: 'Store', paths: ['/store', '/listing'] },
  { to: '/sell', label: 'Sell', paths: ['/sell'] },
  { to: '/purchases', label: 'My purchases', paths: ['/purchases'] },
]

function isPathActive(pathname: string, paths: string[]) {
  return paths.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}

interface LayoutNavLinksProps {
  pathname: string
  vertical?: boolean
  onNavigate?: () => void
}

function LayoutNavLinks({ pathname, vertical = false, onNavigate }: LayoutNavLinksProps) {
  return (
    <>
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          className={cn(
            'px-4 text-base font-medium transition-colors',
            vertical ? 'rounded-lg py-3' : 'rounded-full py-2',
            isPathActive(pathname, item.paths)
              ? 'bg-neutral-900 text-white'
              : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900',
          )}
        >
          {item.label}
        </NavLink>
      ))}
    </>
  )
}

interface LayoutNavDrawerProps {
  pathname: string
  onClose: () => void
}

function LayoutNavDrawer({ pathname, onClose }: LayoutNavDrawerProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-20 md:hidden">
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 transition-opacity duration-200 starting:opacity-0"
      >
        <span className="sr-only">Close menu</span>
      </button>

      <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl transition-transform duration-200 starting:-translate-x-full">
        <div className="flex h-16 items-center justify-between border-b border-neutral-200 pr-2 pl-4">
          <NavLink to="/" onClick={onClose} className="flex items-center gap-2 font-semibold">
            <Glasses className="size-5" /> Visual Shop
          </NavLink>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-10 items-center justify-center rounded-md hover:bg-neutral-100"
          >
            <X className="size-5" />
            <span className="sr-only">Close menu</span>
          </button>
        </div>

        <nav className="flex flex-col gap-1 p-3">
          <LayoutNavLinks pathname={pathname} vertical onNavigate={onClose} />
        </nav>
      </div>
    </div>
  )
}

export function Layout() {
  const { pathname } = useLocation()
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const closeDrawer = useCallback(() => setIsDrawerOpen(false), [])

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 md:gap-6">
          <button
            type="button"
            onClick={() => setIsDrawerOpen(true)}
            className="-ml-2 inline-flex size-10 shrink-0 items-center justify-center rounded-md hover:bg-neutral-100 md:hidden"
          >
            <Menu className="size-5" />
            <span className="sr-only">Open menu</span>
          </button>

          <NavLink to="/" className="flex shrink-0 items-center gap-2 font-semibold" aria-label="Visual Shop home">
            <Glasses className="size-5" /> <span className="hidden sm:inline">Visual Shop</span>
          </NavLink>

          <nav className="hidden gap-2 whitespace-nowrap md:flex">
            <LayoutNavLinks pathname={pathname} />
          </nav>

          <div className="ml-auto shrink-0">
            <ConnectButton />
          </div>
        </div>
      </header>

      {/* Outside the header: its backdrop-blur would make it the containing block of this fixed overlay. */}
      {isDrawerOpen && <LayoutNavDrawer pathname={pathname} onClose={closeDrawer} />}

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
