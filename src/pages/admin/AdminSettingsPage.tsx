import { Link } from 'react-router'

export function AdminSettingsPage() {
  return (
    <section className="rounded-[28px] border border-[var(--line)] bg-[var(--surface-strong)] p-6 shadow-[var(--shadow)]">
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--brand)]">
        Configuración
      </p>
      <h1 className="mt-2 font-display text-3xl font-bold text-[var(--ink)]">
        Configuración avanzada
      </h1>
      <p className="mt-3 max-w-2xl text-sm text-[var(--muted)]">
        Configuración avanzada disponible cuando sea necesaria.
      </p>
      <Link
        className="mt-6 inline-flex rounded-2xl bg-[var(--brand)] px-5 py-3 text-sm font-bold text-white transition hover:bg-emerald-700"
        to="/admin"
      >
        Volver al panel
      </Link>
    </section>
  )
}
