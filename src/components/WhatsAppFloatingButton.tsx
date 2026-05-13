export function WhatsAppFloatingButton() {
  return (
    <a
      className="fixed bottom-5 right-5 z-50 inline-flex items-center gap-3 rounded-full border border-emerald-900/10 bg-[var(--brand)] px-4 py-3 text-sm font-semibold text-white shadow-[var(--shadow)] transition hover:-translate-y-0.5 hover:bg-emerald-700"
      href="https://wa.me/5493582430953"
      rel="noreferrer"
      target="_blank"
    >
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/18 text-base">
        W
      </span>
      WhatsApp E-Motiva
    </a>
  )
}
