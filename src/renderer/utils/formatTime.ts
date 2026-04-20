export function formatDateTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hours = String(d.getHours()).padStart(2, '0')
  const mins = String(d.getMinutes()).padStart(2, '0')
  return `${month}/${day} ${hours}:${mins}`
}

export function formatTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 取 ISO 字串的 YYYY-MM-DD 部分；null/空值回 '—' */
export function formatDateOnly(iso: string | null): string {
  if (!iso) return '—'
  return iso.substring(0, 10)
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return ''
  if (seconds < 60) return `${seconds}s`
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const remainMins = mins % 60
  return remainMins > 0 ? `${hours}h${remainMins}m` : `${hours}h`
}
