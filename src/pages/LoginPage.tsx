export function LoginPage() {
  return (
    <section className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[0.9fr_1.1fr]">
      <div className="rounded-[28px] bg-[var(--ink)] p-6 text-white sm:p-8">
        <p className="font-display text-xs font-bold uppercase tracking-[0.28em] text-white/70">
          Acceso
        </p>
        <h2 className="mt-4 font-display text-4xl font-bold">
          Ingresar a E-Motiva
        </h2>
        <p className="mt-4 text-sm text-white/78">
          Pantalla visual de acceso. La autenticacion real con Supabase queda
          pendiente para RANV2-04.
        </p>
        <div className="mt-8 rounded-[22px] bg-white/8 p-4 text-sm text-white/82">
          <p>Admin confirmado: e.motiva.gym@gmail.com</p>
          <p className="mt-2">
            Sin registro publico. Las cuentas de alumnos se crean desde
            administracion.
          </p>
        </div>
      </div>

      <form className="rounded-[28px] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[var(--shadow)] sm:p-8">
        <label className="block">
          <span className="text-sm font-medium text-[var(--muted)]">Email</span>
          <input
            className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-[var(--ink)] outline-none transition focus:border-[var(--brand)]"
            name="email"
            placeholder="carolina@e-motiva.com"
            type="email"
          />
        </label>

        <label className="mt-4 block">
          <span className="text-sm font-medium text-[var(--muted)]">
            Contrasena
          </span>
          <input
            className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-[var(--ink)] outline-none transition focus:border-[var(--brand)]"
            name="password"
            placeholder="Tu contrasena"
            type="password"
          />
        </label>

        <button
          className="mt-6 inline-flex w-full items-center justify-center rounded-2xl bg-[var(--brand)] px-5 py-3 font-semibold text-white transition hover:bg-emerald-700"
          type="button"
        >
          Entrar
        </button>

        <p className="mt-4 rounded-2xl bg-[var(--accent-soft)] px-4 py-3 text-sm text-[var(--ink)]">
          Autenticacion real pendiente para RANV2-04.
        </p>
      </form>
    </section>
  )
}
