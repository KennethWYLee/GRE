import worker from '../sites-worker/index.js'

const originalFetch = globalThis.fetch

try {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify([
        {
          phonetics: [
            { text: 'təˈmɛr.ə.ti', audio: '//cdn.example.test/temerity-gb.mp3' },
            { text: 'təˈmer.ə.t̬i', audio: 'https://cdn.example.test/temerity-us.mp3' },
          ],
        },
      ]),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )

  const response = await worker.fetch(
    new Request('https://gre.example.test/api/pronunciation?word=temerity'),
    {},
  )
  const payload = await response.json()

  if (response.status !== 200) throw new Error(`Unexpected status: ${response.status}`)
  if (payload.audio !== 'https://cdn.example.test/temerity-us.mp3') {
    throw new Error(`US recording was not preferred: ${payload.audio}`)
  }
  if (payload.accent !== 'en-US') throw new Error(`Unexpected accent: ${payload.accent}`)

  console.log(JSON.stringify({ valid: true, selected: 'US recording' }, null, 2))
} finally {
  globalThis.fetch = originalFetch
}
