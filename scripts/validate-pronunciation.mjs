import worker from '../sites-worker/index.js'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const originalFetch = globalThis.fetch

try {
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('temerity--_us_2.mp3')) {
      return new Response(null, { status: 200, headers: { 'content-type': 'audio/mpeg' } })
    }
    return new Response(null, { status: 404 })
  }

  const response = await worker.fetch(
    new Request('https://gre.example.test/api/pronunciation?word=temerity', {
      headers: {
        'oai-authenticated-user-email': 'wy.lee@ntub.edu.tw',
        'oai-authenticated-user-id': 'admin-test-id',
      },
    }),
    {
      DB: {
        prepare(sql) {
          const statement = {
            values: [],
            bind(...values) { this.values = values; return this },
            async run() { return { meta: { changes: 1 } } },
            async first() {
              if (!sql.includes('SELECT email')) return null
              return {
                email: 'wy.lee@ntub.edu.tw',
                full_name: 'Test Admin',
                status: 'approved',
                role: 'admin',
                requested_at: '2026-09-01 00:00:00',
                reviewed_at: '2026-09-01 00:00:00',
              }
            },
          }
          return statement
        },
        async batch(statements) {
          return Promise.all(statements.map((statement) => statement.run()))
        },
      },
    },
  )
  const payload = await response.json()

  if (response.status !== 200) throw new Error(`Unexpected status: ${response.status}`)
  if (payload.audio !== 'https://ssl.gstatic.com/dictionary/static/sounds/20200429/temerity--_us_2.mp3') {
    throw new Error(`US recording was not preferred: ${payload.audio}`)
  }
  if (payload.accent !== 'en-US') throw new Error(`Unexpected accent: ${payload.accent}`)
  if (!response.headers.get('cache-control')?.startsWith('private, max-age=')) {
    throw new Error(`Pronunciation response is not browser-cacheable: ${response.headers.get('cache-control')}`)
  }

  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.equal(appSource.includes('moeMandarinAudio'), false, 'Mandarin must not use MOE recordings')
  assert.equal(appSource.includes('wikimediaMandarinAudio'), false, 'Mandarin must not use Wikimedia recordings')
  assert.match(appSource, /const SPEECH_VOLUME = 1/)
  assert.equal((appSource.match(/utterance\.volume = SPEECH_VOLUME/g) ?? []).length, 2)
  assert.equal((appSource.match(/audio\.volume = SPEECH_VOLUME/g) ?? []).length >= 2, true)
  assert.match(appSource, /const returnToFirstCard = \(\) =>/)
  assert.match(appSource, /<ChevronsLeft size=\{18\} \/> 第一張/)

  console.log(JSON.stringify({
    valid: true,
    selected: 'US recording',
    browserCache: true,
    mandarinAiOnly: true,
    equalPlaybackVolume: true,
    returnToFirstCard: true,
  }, null, 2))
} finally {
  globalThis.fetch = originalFetch
}
