import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { updateStudent } from '../../admin/api'
import type { UpdateStudentInput } from '../../admin/types'
import { updateMyProfilePreferences } from '../../app/api'
import { StudentProfilePage } from './StudentProfilePage'

const supabaseMocks = vi.hoisted(() => ({
  eq: vi.fn(),
  from: vi.fn(),
  functionsInvoke: vi.fn(),
  rpc: vi.fn(),
  update: vi.fn(),
  updateUser: vi.fn(),
}))

const networkMocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}))

const authMocks = vi.hoisted(() => ({
  refreshProfile: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { updateUser: supabaseMocks.updateUser },
    from: supabaseMocks.from,
    functions: { invoke: supabaseMocks.functionsInvoke },
    rpc: supabaseMocks.rpc,
  },
  supabaseConfigError: null,
}))
vi.mock('../../auth/useAuth', () => ({
  useAuth: () => ({ refreshProfile: authMocks.refreshProfile }),
}))

function profileFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000037',
    first_name: 'Fixture',
    last_name: 'Alumno',
    email: 'fixture.ran37@example.invalid',
    phone: '3510000000',
    active: true,
    receives_emails: true,
    receives_payment_reminders: true,
    last_payment_at: null,
    last_real_activity_at: null,
    last_attendance_at: null,
    ...overrides,
  }
}

function summaryFor(profile: ReturnType<typeof profileFixture>) {
  return {
    profile,
    active_membership: null,
    next_booking: null,
    last_payment: null,
    last_attendance: null,
  }
}

let summaryProfile = profileFixture()
let updatedProfile = profileFixture()

async function renderProfile(overrides: Record<string, unknown>) {
  summaryProfile = profileFixture(overrides)
  const user = userEvent.setup()
  render(<StudentProfilePage />)
  const emailCheckbox = (await screen.findByRole('checkbox', {
    name: 'Recibir novedades por email',
  })) as HTMLInputElement

  return { emailCheckbox, user }
}

describe('RAN-37 student payment reminder preferences', () => {
  beforeEach(() => {
    summaryProfile = profileFixture()
    updatedProfile = profileFixture()
    supabaseMocks.eq.mockReset()
    supabaseMocks.from.mockReset()
    supabaseMocks.functionsInvoke.mockReset()
    supabaseMocks.rpc.mockReset()
    supabaseMocks.update.mockReset()
    supabaseMocks.updateUser.mockReset()
    networkMocks.fetch.mockReset()
    authMocks.refreshProfile.mockReset()
    authMocks.refreshProfile.mockResolvedValue(undefined)
    supabaseMocks.eq.mockResolvedValue({ error: null })
    supabaseMocks.update.mockReturnValue({ eq: supabaseMocks.eq })
    supabaseMocks.from.mockImplementation((table: string) => {
      if (table !== 'profiles') {
        throw new Error(`Tabla inesperada en harness: ${table}`)
      }

      return { update: supabaseMocks.update }
    })
    supabaseMocks.functionsInvoke.mockImplementation(() => {
      throw new Error('Edge Function prohibida en harness RAN-37')
    })
    networkMocks.fetch.mockImplementation(() => {
      throw new Error('Fetch externo prohibido en harness RAN-37')
    })
    vi.stubGlobal('fetch', networkMocks.fetch)
    supabaseMocks.updateUser.mockResolvedValue({ error: null })
    supabaseMocks.rpc.mockImplementation(
      async (name: string) => {
        if (name === 'get_my_profile_summary') {
          return { data: summaryFor(summaryProfile), error: null }
        }

        if (name === 'update_my_profile_preferences_v2') {
          return { data: updatedProfile, error: null }
        }

        return {
          data: null,
          error: new Error(`RPC inesperada en harness: ${name}`),
        }
      },
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('8. profile carga emails true y reminders false independientemente', async () => {
    const { emailCheckbox } = await renderProfile({
      receives_emails: true,
      receives_payment_reminders: false,
    })
    const reminderCheckbox = screen.getByRole('checkbox', {
      name: 'Recibir recordatorios de vencimiento de cuota',
    }) as HTMLInputElement

    expect(emailCheckbox.checked).toBe(true)
    expect(reminderCheckbox.checked).toBe(false)
  })

  it('9. profile carga emails false y reminders true independientemente', async () => {
    const { emailCheckbox } = await renderProfile({
      receives_emails: false,
      receives_payment_reminders: true,
    })
    const reminderCheckbox = screen.getByRole('checkbox', {
      name: 'Recibir recordatorios de vencimiento de cuota',
    }) as HTMLInputElement

    expect(emailCheckbox.checked).toBe(false)
    expect(reminderCheckbox.checked).toBe(true)
  })

  it('10. cambiar reminders no cambia receives_emails', async () => {
    const { emailCheckbox, user } = await renderProfile({
      receives_emails: true,
      receives_payment_reminders: false,
    })
    const reminderCheckbox = screen.getByRole('checkbox', {
      name: 'Recibir recordatorios de vencimiento de cuota',
    }) as HTMLInputElement

    await user.click(reminderCheckbox)

    expect(reminderCheckbox.checked).toBe(true)
    expect(emailCheckbox.checked).toBe(true)
  })

  it('11. cambiar receives_emails no cambia reminders', async () => {
    const { emailCheckbox, user } = await renderProfile({
      receives_emails: false,
      receives_payment_reminders: true,
    })
    const reminderCheckbox = screen.getByRole('checkbox', {
      name: 'Recibir recordatorios de vencimiento de cuota',
    }) as HTMLInputElement

    await user.click(emailCheckbox)

    expect(emailCheckbox.checked).toBe(true)
    expect(reminderCheckbox.checked).toBe(true)
  })

  it('12. submit envia phone y ambas preferencias y aplica el retorno', async () => {
    const { user } = await renderProfile({
      receives_emails: true,
      receives_payment_reminders: false,
    })
    updatedProfile = profileFixture({
      phone: '3519999999',
      receives_emails: false,
      receives_payment_reminders: true,
    })
    const phoneInput = screen.getByRole('textbox', {
      name: 'Telefono',
    }) as HTMLInputElement
    await user.clear(phoneInput)
    await user.type(phoneInput, '3519999999')
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() =>
      expect(supabaseMocks.rpc).toHaveBeenCalledWith(
        'update_my_profile_preferences_v2',
        {
          p_phone: '3519999999',
          p_receives_emails: true,
          p_receives_payment_reminders: false,
        },
      ),
    )
    await waitFor(() => {
      expect(
        (screen.getByRole('checkbox', {
          name: 'Recibir novedades por email',
        }) as HTMLInputElement).checked,
      ).toBe(false)
      expect(
        (screen.getByRole('checkbox', {
          name: 'Recibir recordatorios de vencimiento de cuota',
        }) as HTMLInputElement).checked,
      ).toBe(true)
    })
  })

  it('13. app api usa update_my_profile_preferences_v2', async () => {
    updatedProfile = profileFixture({ receives_payment_reminders: false })

    await updateMyProfilePreferences({
      phone: '3511111111',
      receives_emails: true,
      receives_payment_reminders: false,
    } as Parameters<typeof updateMyProfilePreferences>[0] & {
      receives_payment_reminders: boolean
    })

    expect(supabaseMocks.rpc).toHaveBeenCalledWith(
      'update_my_profile_preferences_v2',
      {
        p_phone: '3511111111',
        p_receives_emails: true,
        p_receives_payment_reminders: false,
      },
    )
  })

  it('14. API alumno ejecuta exclusivamente RPC v2 con las tres preferencias', async () => {
    updatedProfile = {
      id: 'student-fixture-01',
      first_name: 'Fixture',
      last_name: 'Alpha',
      email: 'fixture.alpha@example.invalid',
      phone: '3580000000',
      active: true,
      receives_emails: false,
      receives_payment_reminders: true,
      last_payment_at: null,
      last_real_activity_at: null,
      last_attendance_at: null,
    }

    await updateMyProfilePreferences({
      phone: '3580000000',
      receives_emails: false,
      receives_payment_reminders: true,
    })

    expect(supabaseMocks.rpc).toHaveBeenCalledTimes(1)
    expect(supabaseMocks.rpc).toHaveBeenCalledWith(
      'update_my_profile_preferences_v2',
      {
        p_phone: '3580000000',
        p_receives_emails: false,
        p_receives_payment_reminders: true,
      },
    )
    expect(
      supabaseMocks.rpc.mock.calls.some(
        ([name]) => name === 'update_my_profile_preferences',
      ),
    ).toBe(false)
  })

  it('15. los save paths B1B no invocan Edge Functions ni fetch externo', async () => {
    const studentId = 'student-fixture-01'
    const adminInput: UpdateStudentInput = {
      first_name: ' Fixture ',
      last_name: ' Alpha ',
      phone: ' 3580000000 ',
      active: true,
      receives_emails: false,
      receives_payment_reminders: true,
    }

    await updateStudent(studentId, adminInput)
    await updateMyProfilePreferences({
      phone: '3580000000',
      receives_emails: false,
      receives_payment_reminders: true,
    })

    expect(supabaseMocks.from).toHaveBeenCalledTimes(1)
    expect(supabaseMocks.from).toHaveBeenCalledWith('profiles')
    expect(supabaseMocks.update).toHaveBeenCalledTimes(1)
    expect(supabaseMocks.update).toHaveBeenCalledWith({
      first_name: 'Fixture',
      last_name: 'Alpha',
      phone: '3580000000',
      active: true,
      receives_emails: false,
      receives_payment_reminders: true,
    })
    expect(supabaseMocks.eq).toHaveBeenCalledTimes(1)
    expect(supabaseMocks.eq).toHaveBeenCalledWith('id', studentId)
    expect(supabaseMocks.rpc).toHaveBeenCalledTimes(1)
    expect(supabaseMocks.rpc).toHaveBeenCalledWith(
      'update_my_profile_preferences_v2',
      {
        p_phone: '3580000000',
        p_receives_emails: false,
        p_receives_payment_reminders: true,
      },
    )
    expect(supabaseMocks.functionsInvoke).not.toHaveBeenCalled()
    expect(
      supabaseMocks.functionsInvoke.mock.calls.some(
        ([name]) => name === 'send-payment-reminders',
      ),
    ).toBe(false)
    expect(networkMocks.fetch).not.toHaveBeenCalled()
  })
})
