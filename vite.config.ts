import { cloudflare } from '@cloudflare/vite-plugin'
import { sites } from '@openai/sites-vite-plugin'
import { readFile } from 'node:fs/promises'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

const DEV_ADMIN_EMAIL = 'wy.lee@ntub.edu.tw'

function localAccessApi() {
  return {
    name: 'gre-local-access-api',
    configureServer(server: { middlewares: { use: (handler: (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse, next: () => void) => void) => void } }) {
      server.middlewares.use(async (request, response, next) => {
        const requestUrl = new URL(request.url ?? '/', 'http://localhost')
        const approved = process.env.GRE_DEV_ACCESS === 'admin'

        if (requestUrl.pathname === '/api/session') {
          response.setHeader('content-type', 'application/json; charset=utf-8')
          response.end(JSON.stringify(approved ? {
            authenticated: true,
            email: DEV_ADMIN_EMAIL,
            fullName: 'Local Admin',
            status: 'approved',
            isAdmin: true,
            role: 'admin',
          } : { authenticated: false }))
          return
        }

        if (requestUrl.pathname === '/api/vocabulary') {
          if (!approved) {
            response.statusCode = 403
            response.setHeader('content-type', 'application/json; charset=utf-8')
            response.end(JSON.stringify({ error: 'approval_required' }))
            return
          }
          const deckFile = requestUrl.searchParams.get('deck') === 'words1000'
            ? './data/vocabulary-1000.json'
            : './data/vocabulary.json'
          response.setHeader('content-type', 'application/json; charset=utf-8')
          response.end(await readFile(new URL(deckFile, import.meta.url)))
          return
        }

        if (requestUrl.pathname === '/api/admin/accounts' && request.method === 'GET' && approved) {
          response.setHeader('content-type', 'application/json; charset=utf-8')
          response.end(JSON.stringify({ accounts: [
            { email: 'wy.lee@ntub.edu.tw', full_name: 'Local Admin', status: 'approved', role: 'admin', requested_at: '2026-09-01 00:00:00', reviewed_at: '2026-09-01 00:00:00', reviewed_by: 'system', last_seen_at: '2026-09-01 00:00:00' },
            { email: 'kenneth.wy.lee21@gmail.com', full_name: null, status: 'approved', role: 'admin', requested_at: '2026-09-01 00:00:00', reviewed_at: '2026-09-01 00:00:00', reviewed_by: 'system', last_seen_at: null },
            { email: 'pending@example.com', full_name: '待審核範例', status: 'pending', role: 'member', requested_at: '2026-09-01 01:00:00', reviewed_at: null, reviewed_by: null, last_seen_at: '2026-09-01 01:00:00' },
          ] }))
          return
        }

        if (requestUrl.pathname.startsWith('/api/admin/accounts/') && request.method === 'POST' && approved) {
          response.setHeader('content-type', 'application/json; charset=utf-8')
          response.end(JSON.stringify({ ok: true }))
          return
        }

        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    localAccessApi(),
    react(),
    tailwindcss(),
    sites(),
    cloudflare(),
  ],
})
