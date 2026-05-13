import { createBrowserRouter } from 'react-router'
import { PublicLayout } from './layouts/PublicLayout'
import { StudentLayout } from './layouts/StudentLayout'
import { AdminLayout } from './layouts/AdminLayout'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { StudentDashboardPage } from './pages/student/StudentDashboardPage'
import { StudentCalendarPage } from './pages/student/StudentCalendarPage'
import { StudentBookingsPage } from './pages/student/StudentBookingsPage'
import { StudentPlanPage } from './pages/student/StudentPlanPage'
import { StudentProfilePage } from './pages/student/StudentProfilePage'
import { AdminDashboardPage } from './pages/admin/AdminDashboardPage'
import { AdminStudentsPage } from './pages/admin/AdminStudentsPage'
import { AdminPaymentsPage } from './pages/admin/AdminPaymentsPage'
import { AdminCalendarPage } from './pages/admin/AdminCalendarPage'
import { AdminAttendancePage } from './pages/admin/AdminAttendancePage'
import { AdminPlansPage } from './pages/admin/AdminPlansPage'
import { AdminEmailsPage } from './pages/admin/AdminEmailsPage'
import { AdminStoragePage } from './pages/admin/AdminStoragePage'
import { AdminSettingsPage } from './pages/admin/AdminSettingsPage'

export const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/login', element: <LoginPage /> },
    ],
  },
  {
    path: '/app',
    element: <StudentLayout />,
    children: [
      { index: true, element: <StudentDashboardPage /> },
      { path: 'calendar', element: <StudentCalendarPage /> },
      { path: 'my-bookings', element: <StudentBookingsPage /> },
      { path: 'my-plan', element: <StudentPlanPage /> },
      { path: 'profile', element: <StudentProfilePage /> },
    ],
  },
  {
    path: '/admin',
    element: <AdminLayout />,
    children: [
      { index: true, element: <AdminDashboardPage /> },
      { path: 'students', element: <AdminStudentsPage /> },
      { path: 'payments', element: <AdminPaymentsPage /> },
      { path: 'calendar', element: <AdminCalendarPage /> },
      { path: 'attendance', element: <AdminAttendancePage /> },
      { path: 'plans', element: <AdminPlansPage /> },
      { path: 'emails', element: <AdminEmailsPage /> },
      { path: 'storage', element: <AdminStoragePage /> },
      { path: 'settings', element: <AdminSettingsPage /> },
    ],
  },
])
