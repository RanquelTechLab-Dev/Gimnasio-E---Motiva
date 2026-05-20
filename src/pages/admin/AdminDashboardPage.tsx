import { Link } from 'react-router'

const quickLinks = [
  {
    description: 'Crear, editar, desactivar o revisar alumnos.',
    label: 'Alumnos',
    to: '/admin/students',
  },
  {
    description: 'Crear clases, revisar horarios y tipos de clase.',
    label: 'Calendario',
    to: '/admin/calendar',
  },
  {
    description: 'Registrar, editar o anular pagos manuales.',
    label: 'Pagos',
    to: '/admin/payments',
  },
  {
    description: 'Gestionar planes comerciales y precios.',
    label: 'Planes',
    to: '/admin/plans',
  },
  {
    description: 'Subir documentos y limpiar archivos de prueba.',
    label: 'Archivos',
    to: '/admin/storage',
  },
]

export function AdminDashboardPage() {
  return (
    <section className="grid gap-6">
      <div className="rounded-[28px] border border-[var(--line)] bg-[var(--surface-strong)] p-6 shadow-[var(--shadow)]">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--brand)]">
          Inicio
        </p>
        <h1 className="mt-2 font-display text-3xl font-bold text-[var(--ink)]">
          Panel administrativo
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-[var(--muted)]">
          Accesos rápidos para la operación diaria del gimnasio.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {quickLinks.map((item) => (
          <Link
            className="rounded-[24px] border border-[var(--line)] bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--brand)] hover:shadow-[var(--shadow)]"
            key={item.to}
            to={item.to}
          >
            <h2 className="font-display text-xl font-bold text-[var(--ink)]">
              {item.label}
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              {item.description}
            </p>
          </Link>
        ))}
      </div>
    </section>
  )
}
