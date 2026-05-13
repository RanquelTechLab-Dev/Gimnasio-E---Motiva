import { NavLink, Outlet } from 'react-router'
import { WhatsAppFloatingButton } from '../components/WhatsAppFloatingButton'

const links = [
  { label: 'Inicio', to: '/' },
  { label: 'Login', to: '/login' },
  { label: 'Panel alumno', to: '/app' },
  { label: 'Panel admin', to: '/admin' },
]

export function PublicLayout() {
  return (
    <div className="min-h-screen px-4 py-4 sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-7xl flex-col rounded-[32px] border border-[var(--line)] bg-[var(--surface-strong)] shadow-[var(--shadow)]">
        <header className="flex flex-col gap-4 border-b border-[var(--line)] px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div>
            <p className="font-display text-xs font-bold uppercase tracking-[0.34em] text-[var(--brand)]">
              E-Motiva
            </p>
            <h1 className="mt-2 font-display text-2xl font-bold text-[var(--ink)]">
              Base v2 del gimnasio
            </h1>
          </div>
          <nav className="flex flex-wrap gap-2">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  `rounded-full px-4 py-2 text-sm font-medium transition ${
                    isActive
                      ? 'bg-[var(--ink)] text-white'
                      : 'bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--brand-soft)]'
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        </header>
        <main className="flex-1 px-5 py-6 sm:px-8 sm:py-8">
          <Outlet />
        </main>
      </div>
      <WhatsAppFloatingButton />
    </div>
  )
}
