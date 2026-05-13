import { PlaceholderPanel } from '../../components/PlaceholderPanel'

export function StudentProfilePage() {
  return (
    <PlaceholderPanel
      bullets={[
        'Perfil editable pendiente de auth real.',
        'Preferencias de email quedan para bloques futuros.',
        'No hay persistencia todavia.',
        'La estructura visual ya esta lista.',
      ]}
      description="La version real permitira editar datos personales y preferencias sin exponer campos administrativos."
      eyebrow="/app/profile"
      title="Perfil del alumno"
    />
  )
}
