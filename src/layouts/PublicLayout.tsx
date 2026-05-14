import { Outlet } from 'react-router'
import { WhatsAppFloatingButton } from '../components/WhatsAppFloatingButton'

export function PublicLayout() {
  return (
    <div className="min-h-screen px-4 py-4 sm:px-6">
      <main className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-5xl items-center justify-center">
        <Outlet />
      </main>
      <WhatsAppFloatingButton />
    </div>
  )
}
