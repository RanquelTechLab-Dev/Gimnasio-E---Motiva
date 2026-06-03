export function formatLocalDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function parseLocalDate(dateValue: string) {
  return new Date(`${dateValue}T00:00:00`)
}

export function addLocalDays(dateValue: string, days: number) {
  const date = parseLocalDate(dateValue)
  date.setDate(date.getDate() + days)
  return formatLocalDate(date)
}

export function dateInputToRangeStart(dateValue: string) {
  return parseLocalDate(dateValue).toISOString()
}

export function dateInputToExclusiveRangeEnd(dateValue: string) {
  return parseLocalDate(addLocalDays(dateValue, 1)).toISOString()
}

export function calendarDateRange(fromDate: string, toDate: string) {
  return {
    from: dateInputToRangeStart(fromDate),
    to: dateInputToExclusiveRangeEnd(toDate),
  }
}
