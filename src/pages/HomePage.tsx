import { Link } from 'react-router'

const routeCards = [
  {
    title: 'Login placeholder',
    path: '/login',
    detail: 'Ingreso visual a E-Motiva. Supabase Auth queda pendiente para RANV2-04.',
  },
  {
    title: 'Panel alumno',
    path: '/app',
    detail: 'Dashboard, calendario, reservas, plan y perfil en modo placeholder.',
  },
  {
    title: 'Panel administracion',
    path: '/admin',
    detail: 'Alumnos, pagos, clases, emails y storage como base de navegacion.',
  },
]

export function HomePage() {
  return (
    <div className="space-y-8">
      <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-[28px] border border-[var(--line)] bg-[var(--surface)] p-6 sm:p-8">
          <p className="font-display text-xs font-bold uppercase tracking-[0.3em] text-[var(--brand)]">
            RANV2-02
          </p>
          <h2 className="mt-4 max-w-2xl font-display text-4xl font-bold text-[var(--ink)] sm:text-5xl">
            E-Motiva arranca limpio con frontend base y rutas listas para crecer.
          </h2>
          <p className="mt-4 max-w-2xl text-base text-[var(--muted)] sm:text-lg">
            Este bloque deja la estructura de navegacion, layouts, placeholders y CI.
            La autenticacion real y Supabase se agregan en los siguientes RAN.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              className="rounded-full bg-[var(--brand)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
              to="/login"
            >
              Ver login
            </Link>
            <Link
              className="rounded-full border border-[var(--line)] bg-[var(--surface-strong)] px-5 py-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--brand-soft)]"
              to="/admin"
            >
              Ver panel admin
            </Link>
          </div>
        </div>

        <div className="rounded-[28px] bg-[var(--ink)] p-6 text-white sm:p-8">
          <p className="font-display text-xs font-bold uppercase tracking-[0.3em] text-white/70">
            Confirmado
          </p>
          <ul className="mt-5 space-y-4 text-sm text-white/82">
            <li>Admin: e.motiva.gym@gmail.com</li>
            <li>WhatsApp: +5493582430953</li>
            <li>No pagos online ni registro publico</li>
            <li>Supabase nuevo pendiente antes de RANV2-03</li>
          </ul>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {routeCards.map((card) => (
          <Link
            key={card.path}
            to={card.path}
            className="rounded-[26px] border border-[var(--line)] bg-[var(--surface)] p-5 transition hover:-translate-y-1 hover:shadow-[var(--shadow)]"
          >
            <p className="font-display text-xs font-bold uppercase tracking-[0.28em] text-[var(--accent)]">
              {card.path}
            </p>
            <h3 className="mt-3 font-display text-2xl font-bold text-[var(--ink)]">
              {card.title}
            </h3>
            <p className="mt-3 text-sm text-[var(--muted)]">{card.detail}</p>
          </Link>
        ))}
      </section>
    </div>
  )
}
