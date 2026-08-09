/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminStudentsPage } from './AdminStudentsPage'
import type { StudentProfile, UpdateStudentInput } from './types'

const supabaseMocks = vi.hoisted(() => ({
  from: vi.fn(),
}))

const adminApiMocks = vi.hoisted(() => ({
  listPayments: vi.fn(),
  listPlans: vi.fn(),
  listStudentFiles: vi.fn(),
  listStudentFixedSchedules: vi.fn(),
  listStudentPrograms: vi.fn(),
  listStudents: vi.fn(),
  listStudentTrainingNotes: vi.fn(),
  updateStudent: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: { from: supabaseMocks.from },
  supabaseConfigError: null,
}))

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()

  return {
    ...actual,
    ...adminApiMocks,
  }
})

const adminTypesSource = readFileSync(
  resolve(process.cwd(), 'src/admin/types.ts'),
  'utf8',
)
const adminPageSource = readFileSync(
  resolve(process.cwd(), 'src/admin/AdminStudentsPage.tsx'),
  'utf8',
)

function sourceBetween(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex + start.length)

  if (startIndex < 0 || endIndex < 0) {
    return ''
  }

  return source.slice(startIndex, endIndex)
}

function exportedTypeBody(typeName: string) {
  return sourceBetween(
    adminTypesSource,
    `export type ${typeName} = {`,
    '\n}',
  )
}

const fixtureStudent: StudentProfile = {
  id: '00000000-0000-4000-8000-000000000037',
  role: 'student',
  first_name: 'Fixture',
  last_name: 'Alpha',
  email: 'fixture.alpha@example.invalid',
  phone: '3580000000',
  active: true,
  receives_emails: false,
  receives_payment_reminders: true,
  notes: null,
  last_payment_at: null,
  last_real_activity_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

describe('RAN-37 admin payment reminder preferences', () => {
  beforeEach(() => {
    supabaseMocks.from.mockReset()
    adminApiMocks.listPayments.mockReset()
    adminApiMocks.listPlans.mockReset()
    adminApiMocks.listStudentFiles.mockReset()
    adminApiMocks.listStudentFixedSchedules.mockReset()
    adminApiMocks.listStudentPrograms.mockReset()
    adminApiMocks.listStudents.mockReset()
    adminApiMocks.listStudentTrainingNotes.mockReset()
    adminApiMocks.updateStudent.mockReset()
    adminApiMocks.listStudents.mockResolvedValue([fixtureStudent])
    adminApiMocks.listPlans.mockResolvedValue([])
    adminApiMocks.listStudentPrograms.mockResolvedValue([])
    adminApiMocks.listPayments.mockResolvedValue([])
    adminApiMocks.listStudentTrainingNotes.mockResolvedValue([])
    adminApiMocks.listStudentFiles.mockResolvedValue([])
    adminApiMocks.listStudentFixedSchedules.mockResolvedValue([])
    adminApiMocks.updateStudent.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
  })

  it('1. StudentProfile incluye receives_payment_reminders', () => {
    expect(exportedTypeBody('StudentProfile')).toMatch(
      /receives_payment_reminders:\s*boolean/,
    )
  })

  it('2. UpdateStudentInput incluye receives_payment_reminders', () => {
    expect(exportedTypeBody('UpdateStudentInput')).toMatch(
      /receives_payment_reminders:\s*boolean/,
    )
  })

  it('3. listStudents selecciona receives_payment_reminders', async () => {
    const { listStudents } =
      await vi.importActual<typeof import('./api')>('./api')
    const finalOrder = vi.fn().mockResolvedValue({ data: [], error: null })
    const firstOrder = vi.fn().mockReturnValue({ order: finalOrder })
    const eq = vi.fn().mockReturnValue({ order: firstOrder })
    const select = vi.fn().mockReturnValue({ eq })
    supabaseMocks.from.mockReturnValue({ select })

    await listStudents()

    expect(supabaseMocks.from).toHaveBeenCalledWith('profiles')
    expect(select).toHaveBeenCalledWith(
      expect.stringContaining('receives_payment_reminders'),
    )
  })

  it('4. updateStudent persiste receives_payment_reminders', async () => {
    const { updateStudent } =
      await vi.importActual<typeof import('./api')>('./api')
    const eq = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn().mockReturnValue({ eq })
    supabaseMocks.from.mockReturnValue({ update })
    const input = {
      first_name: 'Fixture',
      last_name: 'Admin',
      phone: '3510000000',
      active: true,
      receives_emails: true,
      receives_payment_reminders: false,
    } as UpdateStudentInput & { receives_payment_reminders: boolean }

    await updateStudent('00000000-0000-4000-8000-000000000037', input)

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ receives_payment_reminders: false }),
    )
  })

  it('5. studentToEditForm conserva el valor elegido', () => {
    const mapperSource = sourceBetween(
      adminPageSource,
      'function studentToEditForm',
      'function weeklyPlanLabel',
    )

    expect(mapperSource).toMatch(
      /receives_payment_reminders:\s*student\.receives_payment_reminders/,
    )
  })

  it('6. ficha admin renderiza por separado email y recordatorios de cuota', async () => {
    render(createElement(AdminStudentsPage))

    const studentHeading = await screen.findByRole('heading', {
      name: 'Fixture Alpha',
    })
    const studentCard = studentHeading.closest('article')
    if (!studentCard) {
      throw new Error('No se encontro la ficha real del alumno.')
    }

    const card = within(studentCard)
    const emailTerm = card.getByText('Recibe emails', { selector: 'dt' })
    const reminderTerm = card.getByText('Recordatorios de cuota', {
      selector: 'dt',
    })

    expect(emailTerm.nextElementSibling?.tagName).toBe('DD')
    expect(emailTerm.nextElementSibling?.textContent?.trim()).toBe('No')
    expect(reminderTerm.nextElementSibling?.tagName).toBe('DD')
    expect(reminderTerm.nextElementSibling?.textContent?.trim()).toBe('Si')
  })

  it('7. admin cambia reminders y guarda sin alterar receives_emails', async () => {
    const user = userEvent.setup()
    render(createElement(AdminStudentsPage))

    await screen.findByRole('heading', { name: 'Fixture Alpha' })
    const editHeading = screen.getByRole('heading', { name: 'Datos basicos' })
    const editForm = editHeading.closest('form')
    if (!editForm) {
      throw new Error('No se encontro el formulario real de edicion.')
    }

    const edit = within(editForm)
    const reminderCheckbox = edit.getByRole('checkbox', {
      name: 'Recibir recordatorios de vencimiento de cuota',
    }) as HTMLInputElement
    const emailCheckbox = edit.getByRole('checkbox', {
      name: 'Recibe emails',
    }) as HTMLInputElement

    expect(reminderCheckbox.checked).toBe(true)
    expect(emailCheckbox.checked).toBe(false)

    await user.click(reminderCheckbox)

    expect(reminderCheckbox.checked).toBe(false)
    expect(emailCheckbox.checked).toBe(false)

    await user.click(reminderCheckbox)

    expect(reminderCheckbox.checked).toBe(true)
    expect(emailCheckbox.checked).toBe(false)

    await user.click(reminderCheckbox)

    expect(reminderCheckbox.checked).toBe(false)
    expect(emailCheckbox.checked).toBe(false)
    adminApiMocks.listStudents.mockResolvedValue([
      { ...fixtureStudent, receives_payment_reminders: false },
    ])

    await user.click(edit.getByRole('button', { name: 'Guardar alumno' }))

    await waitFor(() => {
      expect(adminApiMocks.updateStudent).toHaveBeenCalledTimes(1)
    })
    expect(adminApiMocks.updateStudent).toHaveBeenCalledWith(
      fixtureStudent.id,
      {
        first_name: 'Fixture',
        last_name: 'Alpha',
        phone: '3580000000',
        active: true,
        receives_emails: false,
        receives_payment_reminders: false,
      },
    )
    expect(emailCheckbox.checked).toBe(false)
  })
})
