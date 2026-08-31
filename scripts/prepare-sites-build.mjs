import fs from 'node:fs/promises'

const serverDir = new URL('../dist/server/', import.meta.url)
await fs.mkdir(serverDir, { recursive: true })
await fs.copyFile(
  new URL('../sites-worker/index.js', import.meta.url),
  new URL('../dist/server/index.js', import.meta.url),
)
