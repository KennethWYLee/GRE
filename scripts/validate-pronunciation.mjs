import worker from '../sites-worker/index.js'

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
    new Request('https://gre.example.test/api/pronunciation?word=temerity'),
    {},
  )
  const payload = await response.json()

  if (response.status !== 200) throw new Error(`Unexpected status: ${response.status}`)
  if (payload.audio !== 'https://ssl.gstatic.com/dictionary/static/sounds/20200429/temerity--_us_2.mp3') {
    throw new Error(`US recording was not preferred: ${payload.audio}`)
  }
  if (payload.accent !== 'en-US') throw new Error(`Unexpected accent: ${payload.accent}`)

  console.log(JSON.stringify({ valid: true, selected: 'US recording' }, null, 2))
} finally {
  globalThis.fetch = originalFetch
}
