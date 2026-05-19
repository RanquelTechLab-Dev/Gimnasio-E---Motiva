import { NavLink, Outlet } from 'react-router'
import { SessionBadge } from './SessionBadge'
import { WhatsAppFloatingButton } from './WhatsAppFloatingButton'

type NavItem = {
  label: string
  to: string
}

type LayoutShellProps = {
  section: string
  title: string
  subtitle: string
  pendingLabel: string
  navItems: NavItem[]
}

export function LayoutShell({
  section,
  title,
  subtitle,
  pendingLabel,
  navItems,
}: LayoutShellProps) {
  return (
    <div className="min-h-screen bg-transparent">
      <div className="mx-auto grid min-h-screen w-full max-w-[1760px] gap-4 px-3 py-3 sm:px-4 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-5 lg:px-5 2xl:grid-cols-[300px_minmax(0,1fr)] 2xl:px-8">
        <aside className="rounded-[24px] border border-[var(--line)] bg-[var(--surface-strong)] p-3 shadow-[var(--shadow)] sm:p-4 lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:overflow-y-auto">
          <div className="rounded-[22px] bg-[var(--ink)] p-4 text-white">
            <div className="flex items-center gap-3">
              <img
                alt="E-Motiva"
                className="h-12 w-12 rounded-2xl bg-white object-contain p-1 shadow-sm"
                src="/brand/logo-small.png"
              />
              <p className="font-display text-xs font-bold uppercase tracking-[0.3em] text-white/70">
                E-Motiva
              </p>
            </div>
            <h1 className="mt-3 font-display text-xl font-bold leading-tight sm:text-2xl">
              {title}
            </h1>
            <p className="mt-2 text-sm text-white/76">{subtitle}</p>
          </div>

          <div className="mt-4 rounded-[20px] border border-[var(--line)] bg-[var(--surface)] p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
              Navegacion
            </p>
            <nav className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-1">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `rounded-2xl px-3 py-2.5 text-sm font-medium transition ${
                      isActive
                        ? 'bg-[var(--brand)] text-white'
                        : 'bg-transparent text-[var(--ink)] hover:bg-[var(--brand-soft)]'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="mt-4 rounded-[20px] bg-[var(--brand-soft)] p-4 text-sm text-[var(--ink)]">
            <p className="font-display text-xs font-bold uppercase tracking-[0.26em] text-[var(--accent)]">
              Estado
            </p>
            <p className="mt-2">{pendingLabel}</p>
          </div>
        </aside>

        <main className="flex min-h-[80vh] min-w-0 flex-col gap-4 rounded-[24px] border border-[var(--line)] bg-[var(--surface-strong)] p-4 shadow-[var(--shadow)] sm:p-5 xl:p-6">
          <header className="grid gap-3 rounded-[20px] border border-[var(--line)] bg-[var(--surface)] p-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,520px)] lg:items-end">
            <div>
              <p className="font-display text-xs font-bold uppercase tracking-[0.28em] text-[var(--brand)]">
                {section}
              </p>
              <h2 className="mt-3 font-display text-3xl font-bold leading-tight text-[var(--ink)]">
                {title}
              </h2>
            </div>
            <div className="flex w-full flex-col gap-3">
              <p className="text-sm text-[var(--muted)]">{subtitle}</p>
              <SessionBadge />
            </div>
          </header>

          <Outlet />
        </main>
      </div>

      <WhatsAppFloatingButton />
    </div>
  )
}
