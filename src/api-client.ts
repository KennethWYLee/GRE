const SESSION_STORAGE_KEY = 'gre-roots-session-id-v1'
let fallbackSessionId = ''

function createSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function getSessionId() {
  try {
    const saved = window.sessionStorage.getItem(SESSION_STORAGE_KEY)
    if (saved) return saved
    const created = createSessionId()
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, created)
    return created
  } catch {
    if (!fallbackSessionId) fallbackSessionId = createSessionId()
    return fallbackSessionId
  }
}

export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('x-gre-session-id', getSessionId())
  return fetch(input, { ...init, headers })
}
