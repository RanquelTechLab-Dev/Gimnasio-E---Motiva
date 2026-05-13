type PlaceholderPanelProps = {
  eyebrow: string
  title: string
  description: string
  bullets: string[]
}

export function PlaceholderPanel({
  eyebrow,
  title,
  description,
  bullets,
}: PlaceholderPanelProps) {
  return (
    <section className="rounded-3xl border border-[var(--line)] bg-[var(--surface-strong)] p-6 shadow-[var(--shadow)]">
      <p className="font-display text-xs font-bold uppercase tracking-[0.28em] text-[var(--brand)]">
        {eyebrow}
      </p>
      <h1 className="mt-3 font-display text-3xl font-bold text-[var(--ink)] sm:text-4xl">
        {title}
      </h1>
      <p className="mt-3 max-w-2xl text-base text-[var(--muted)]">
        {description}
      </p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {bullets.map((bullet) => (
          <div
            key={bullet}
            className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--ink)]"
          >
            {bullet}
          </div>
        ))}
      </div>
    </section>
  )
}
