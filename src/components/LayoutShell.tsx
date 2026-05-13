import { NavLink, Outlet } from 'react-router'
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
      <div className="mx-auto grid min-h-screen max-w-7xl gap-6 px-4 py-4 lg:grid-cols-[280px_minmax(0,1fr)] lg:px-6">
        <aside className="rounded-[28px] border border-[var(--line)] bg-[var(--surface-strong)] p-5 shadow-[var(--shadow)]">
          <div className="rounded-[24px] bg-[var(--ink)] p-5 text-white">
            <p className="font-display text-xs font-bold uppercase tracking-[0.3em] text-white/70">
              E-Motiva
            </p>
            <h1 className="mt-3 font-display text-2xl font-bold">{title}</h1>
            <p className="mt-2 text-sm text-white/76">{subtitle}</p>
          </div>

          <div className="mt-5 rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
              Navegacion
            </p>
            <nav className="mt-3 flex flex-col gap-2">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `rounded-2xl px-4 py-3 text-sm font-medium transition ${
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

          <div className="mt-5 rounded-[24px] bg-[var(--accent-soft)] p-4 text-sm text-[var(--ink)]">
            <p className="font-display text-xs font-bold uppercase tracking-[0.26em] text-[var(--accent)]">
              Estado
            </p>
            <p className="mt-2">{pendingLabel}</p>
          </div>
        </aside>

        <main className="flex min-h-[80vh] flex-col gap-5 rounded-[28px] border border-[var(--line)] bg-[var(--surface-strong)] p-5 shadow-[var(--shadow)] sm:p-7">
          <header className="flex flex-col gap-3 rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="font-display text-xs font-bold uppercase tracking-[0.28em] text-[var(--brand)]">
                {section}
              </p>
              <h2 className="mt-3 font-display text-3xl font-bold text-[var(--ink)]">
                {title}
              </h2>
            </div>
            <p className="max-w-xl text-sm text-[var(--muted)]">{subtitle}</p>
          </header>

          <Outlet />
        </main>
      </div>

      <WhatsAppFloatingButton />
    </div>
  )
}
