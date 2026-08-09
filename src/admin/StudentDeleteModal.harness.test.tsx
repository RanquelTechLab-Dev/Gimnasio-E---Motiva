import { useState } from 'react'
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { StudentDeleteModal } from './StudentDeleteModal'
import type {
  DeleteStudentDefinitiveResult,
  StudentProfile,
} from './types'

type DeleteInput = {
  studentId: string
  targetEmail: string
  confirmText?: string
  dryRun: boolean
}

const apiMocks = vi.hoisted(() => ({
  deleteStudentDefinitive: vi.fn(),
  formatAdminError: vi.fn(),
  listPayments: vi.fn(),
  listCalendarSessions: vi.fn(),
  previewCancelFixedScheduleBookings: vi.fn(),
  listAttendanceSessions: vi.fn(),
  checkDriveStatus: vi.fn(),
  sendMassEmail: vi.fn(),
}))

vi.mock('./api', () => apiMocks)

const alphaStudent: StudentProfile = {
  id: '00000000-0000-4000-8000-0000000000a1',
  role: 'student',
  first_name: 'Fixture',
  last_name: 'Alpha',
  email: 'fixture.alpha@example.invalid',
  phone: null,
  active: true,
  receives_emails: false,
  notes: null,
  last_payment_at: null,
  last_real_activity_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

const betaStudent: StudentProfile = {
  ...alphaStudent,
  id: '00000000-0000-4000-8000-0000000000b2',
  first_name: 'Fixture',
  last_name: 'Beta',
  email: 'fixture.beta@example.invalid',
}

function previewFor(
  student: StudentProfile,
  auditLogs = 0,
): DeleteStudentDefinitiveResult {
  return {
    dryRun: true,
    deleted: false,
    required_confirmation: 'ELIMINAR',
    preview: {
      student_id: student.id,
      student_email: student.email,
      student_name: `${student.first_name} ${student.last_name}`,
      counts: {
        attendance: 0,
        bookings: 0,
        payments: 0,
        memberships: 0,
        files: 0,
        training_notes: 0,
        fixed_schedules: 0,
        email_logs: 0,
        audit_logs: auditLogs,
      },
      drive_files: [],
    },
  }
}

function finalResultFor(student: StudentProfile): DeleteStudentDefinitiveResult {
  return {
    ...previewFor(student),
    dryRun: false,
    deleted: true,
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

const ignoreMessage = () => undefined
const ignoreSaving = () => undefined
const ignoreDeleted = () => undefined

function LifecycleHarness() {
  const [student, setStudent] = useState(alphaStudent)
  const [open, setOpen] = useState(true)

  return (
    <>
      <button
        onClick={() => {
          setStudent(betaStudent)
          setOpen(false)
        }}
        type="button"
      >
        Cambiar alumno
      </button>
      {!open ? (
        <button onClick={() => setOpen(true)} type="button">
          Reabrir modal
        </button>
      ) : null}
      {open ? (
        <StudentDeleteModal
          key={student.id}
          onCancel={() => setOpen(false)}
          onDeleted={ignoreDeleted}
          onError={ignoreMessage}
          onSavingChange={ignoreSaving}
          student={student}
        />
      ) : null}
    </>
  )
}

function renderModal(student = alphaStudent) {
  const callbacks = {
    onCancel: vi.fn(),
    onDeleted: vi.fn(),
    onError: vi.fn(),
    onSavingChange: vi.fn(),
  }
  const user = userEvent.setup()
  render(
    <StudentDeleteModal
      key={student.id}
      {...callbacks}
      student={student}
    />,
  )
  return { ...callbacks, user }
}

function dialog() {
  return screen.getByRole('dialog')
}

function confirmationInput() {
  return within(dialog()).getByRole('textbox', {
    name: /Confirmacion escrita/i,
  }) as HTMLInputElement
}

function deleteButton() {
  return within(dialog()).getByRole('button', {
    name: /Eliminar definitivamente|Eliminando/i,
  }) as HTMLButtonElement
}

async function waitForPreview() {
  await screen.findByText('Preview de impacto')
}

describe('StudentDeleteModal hard-delete harness', () => {
  beforeEach(() => {
    for (const mock of Object.values(apiMocks)) {
      mock.mockReset()
    }

    apiMocks.formatAdminError.mockImplementation((error: unknown) =>
      error instanceof Error ? error.message : 'Error controlado del harness.',
    )
    apiMocks.deleteStudentDefinitive.mockImplementation(
      async (input: DeleteInput) => {
        const student =
          input.studentId === betaStudent.id ? betaStudent : alphaStudent
        return input.dryRun ? previewFor(student) : finalResultFor(student)
      },
    )
  })

  afterEach(() => {
    cleanup()
  })

  it('1. muestra el nombre del alumno seleccionado', async () => {
    renderModal()
    await waitForPreview()
    expect(within(dialog()).getByText('Fixture Alpha')).toBeTruthy()
  })

  it('2. muestra el email del alumno seleccionado como texto', async () => {
    renderModal()
    await waitForPreview()
    expect(
      within(dialog()).getByText('fixture.alpha@example.invalid'),
    ).toBeTruthy()
  })

  it('3. no muestra un input editable llamado Email del alumno', async () => {
    renderModal()
    await waitForPreview()
    expect(
      within(dialog()).queryByRole('textbox', { name: /Email del alumno/i }),
    ).toBeNull()
  })

  it('4. solo existe el textbox de confirmacion escrita', async () => {
    renderModal()
    await waitForPreview()
    expect(within(dialog()).getAllByRole('textbox')).toHaveLength(1)
    expect(confirmationInput()).toBeTruthy()
  })

  it.each([
    ['5. confirmacion vacia', ''],
    ['6. confirmacion en minusculas', 'eliminar'],
    ['7. confirmacion con espacio final', 'ELIMINAR '],
    ['8. confirmacion con espacio inicial', ' ELIMINAR'],
    ['9. confirmacion con texto diferente', 'CONFIRMAR'],
  ])('%s mantiene el boton deshabilitado', async (_name, value) => {
    const { user } = renderModal()
    await waitForPreview()
    if (value) {
      await user.type(confirmationInput(), value)
    }
    expect(deleteButton().disabled).toBe(true)
  })

  it('10. habilita el boton con preview valido y ELIMINAR exacto', async () => {
    const { user } = renderModal()
    await waitForPreview()
    await user.type(confirmationInput(), 'ELIMINAR')
    await waitFor(() => expect(deleteButton().disabled).toBe(false))
  })

  it('11. mantiene el boton deshabilitado sin preview', async () => {
    const pendingPreview = createDeferred<DeleteStudentDefinitiveResult>()
    apiMocks.deleteStudentDefinitive.mockReturnValueOnce(pendingPreview.promise)
    const { user } = renderModal()
    await user.type(confirmationInput(), 'ELIMINAR')
    expect(deleteButton().disabled).toBe(true)
  })

  it('12. cancelar limpia confirmacion y preview', async () => {
    const nextPreview = createDeferred<DeleteStudentDefinitiveResult>()
    apiMocks.deleteStudentDefinitive
      .mockResolvedValueOnce(previewFor(alphaStudent, 11))
      .mockReturnValueOnce(nextPreview.promise)
    const user = userEvent.setup()
    render(<LifecycleHarness />)
    await waitForPreview()
    await user.type(confirmationInput(), 'ELIMINAR')
    await waitFor(() =>
      expect(
        (within(dialog()).getByRole('button', {
          name: 'Cancelar',
        }) as HTMLButtonElement).disabled,
      ).toBe(false),
    )
    await user.click(within(dialog()).getByRole('button', { name: 'Cancelar' }))
    await user.click(screen.getByRole('button', { name: 'Reabrir modal' }))
    expect(confirmationInput().value).toBe('')
    expect(within(dialog()).queryByText('Preview de impacto')).toBeNull()
    expect(within(dialog()).getByText('Preparando preview seguro...')).toBeTruthy()
  })

  it('13. cambiar de alumno no reutiliza la confirmacion', async () => {
    const user = userEvent.setup()
    render(<LifecycleHarness />)
    await waitForPreview()
    await user.type(confirmationInput(), 'ELIMINAR')
    await user.click(screen.getByRole('button', { name: 'Cambiar alumno' }))
    await user.click(screen.getByRole('button', { name: 'Reabrir modal' }))
    await waitForPreview()
    expect(within(dialog()).getByText('Fixture Beta')).toBeTruthy()
    expect(confirmationInput().value).toBe('')
  })

  it('14. cambiar de alumno no reutiliza un preview anterior u obsoleto', async () => {
    const alphaPreview = createDeferred<DeleteStudentDefinitiveResult>()
    const betaPreview = createDeferred<DeleteStudentDefinitiveResult>()
    const betaRetryPreview = createDeferred<DeleteStudentDefinitiveResult>()
    apiMocks.deleteStudentDefinitive
      .mockReturnValueOnce(alphaPreview.promise)
      .mockReturnValueOnce(betaPreview.promise)
      .mockReturnValueOnce(betaRetryPreview.promise)
    const user = userEvent.setup()
    render(<LifecycleHarness />)
    await waitFor(() =>
      expect(apiMocks.deleteStudentDefinitive).toHaveBeenCalledTimes(1),
    )
    await user.click(screen.getByRole('button', { name: 'Cambiar alumno' }))
    await user.click(screen.getByRole('button', { name: 'Reabrir modal' }))
    await waitFor(() =>
      expect(apiMocks.deleteStudentDefinitive).toHaveBeenCalledTimes(2),
    )

    await act(async () => {
      alphaPreview.resolve(previewFor(alphaStudent, 11))
    })
    expect(within(dialog()).queryByText('Preview de impacto')).toBeNull()
    expect(within(dialog()).queryByText('audit_logs: 11')).toBeNull()

    await act(async () => {
      betaPreview.resolve(previewFor(alphaStudent, 22))
    })
    await waitFor(() =>
      expect(
        (within(dialog()).getByRole('button', {
          name: 'Cancelar',
        }) as HTMLButtonElement).disabled,
      ).toBe(false),
    )
    expect(within(dialog()).queryByText('Preview de impacto')).toBeNull()

    await user.click(within(dialog()).getByRole('button', { name: 'Cancelar' }))
    await user.click(screen.getByRole('button', { name: 'Reabrir modal' }))
    await waitFor(() =>
      expect(apiMocks.deleteStudentDefinitive).toHaveBeenCalledTimes(3),
    )
    await act(async () => {
      betaRetryPreview.resolve(previewFor(betaStudent, 22))
    })
    await screen.findByText('Preview de impacto')
    expect(within(dialog()).getByText('22')).toBeTruthy()
  })

  it('15. el dry-run usa id y email del alumno seleccionado', async () => {
    renderModal()
    await waitForPreview()
    expect(apiMocks.deleteStudentDefinitive).toHaveBeenNthCalledWith(1, {
      studentId: alphaStudent.id,
      targetEmail: alphaStudent.email,
      dryRun: true,
    })
  })

  it('16. la ejecucion final usa el payload contractual exacto', async () => {
    const { user } = renderModal()
    await waitForPreview()
    await user.type(confirmationInput(), 'ELIMINAR')
    await waitFor(() => expect(deleteButton().disabled).toBe(false))
    await user.click(deleteButton())
    await waitFor(() =>
      expect(apiMocks.deleteStudentDefinitive).toHaveBeenCalledTimes(2),
    )
    expect(apiMocks.deleteStudentDefinitive).toHaveBeenNthCalledWith(2, {
      studentId: alphaStudent.id,
      targetEmail: alphaStudent.email,
      confirmText: 'ELIMINAR',
      dryRun: false,
    })
  })

  it('17. no ejecuta eliminacion final con confirmacion invalida', async () => {
    const { user } = renderModal()
    await waitForPreview()
    apiMocks.deleteStudentDefinitive.mockClear()
    await user.type(confirmationInput(), 'eliminar')
    await user.click(deleteButton())
    expect(apiMocks.deleteStudentDefinitive).not.toHaveBeenCalled()
  })

  it('18. no ejecuta eliminacion final sin preview', async () => {
    const pendingPreview = createDeferred<DeleteStudentDefinitiveResult>()
    apiMocks.deleteStudentDefinitive.mockReturnValueOnce(pendingPreview.promise)
    const { user } = renderModal()
    await waitFor(() =>
      expect(apiMocks.deleteStudentDefinitive).toHaveBeenCalledTimes(1),
    )
    apiMocks.deleteStudentDefinitive.mockClear()
    await user.type(confirmationInput(), 'ELIMINAR')
    await user.click(deleteButton())
    expect(apiMocks.deleteStudentDefinitive).not.toHaveBeenCalled()
  })

  it('19. la validacion es exacta y case-sensitive', async () => {
    const { user } = renderModal()
    await waitForPreview()
    await user.type(confirmationInput(), 'ELIMINAr')
    expect(deleteButton().disabled).toBe(true)
  })

  it('20. el flujo no llama pagos, calendario, reservas, asistencia, Drive ni emails', async () => {
    const { user } = renderModal()
    await waitForPreview()
    await user.type(confirmationInput(), 'ELIMINAR')
    await waitFor(() => expect(deleteButton().disabled).toBe(false))
    await user.click(deleteButton())
    await waitFor(() =>
      expect(apiMocks.deleteStudentDefinitive).toHaveBeenCalledTimes(2),
    )

    expect(apiMocks.listPayments).not.toHaveBeenCalled()
    expect(apiMocks.listCalendarSessions).not.toHaveBeenCalled()
    expect(apiMocks.previewCancelFixedScheduleBookings).not.toHaveBeenCalled()
    expect(apiMocks.listAttendanceSessions).not.toHaveBeenCalled()
    expect(apiMocks.checkDriveStatus).not.toHaveBeenCalled()
    expect(apiMocks.sendMassEmail).not.toHaveBeenCalled()
  })
})
