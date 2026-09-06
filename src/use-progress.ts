import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { apiFetch } from './api-client'
import { createProgressSync } from './progress-sync'

export function useProgress(email: string) {
  const sync = useMemo(() => createProgressSync(email, { fetch: apiFetch }), [email])
  const decks = useSyncExternalStore(sync.subscribe, sync.getSnapshot)
  useEffect(() => {
    sync.start()
    const onVisible = () => { if (document.visibilityState === 'visible') sync.refresh() }
    window.addEventListener('online', sync.refresh)
    window.addEventListener('focus', sync.refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      sync.stop()
      window.removeEventListener('online', sync.refresh)
      window.removeEventListener('focus', sync.refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [sync])
  return { decks, update: sync.update, refresh: sync.refresh }
}
