import fs from 'node:fs/promises'

const distDir = new URL('../dist/', import.meta.url)
const clientIndex = new URL('../dist/client/index.html', import.meta.url)
const workerBundle = new URL('../dist/gre_roots/index.js', import.meta.url)
const serverDir = new URL('../dist/server/', import.meta.url)

await fs.access(clientIndex)
await fs.access(workerBundle)
await fs.mkdir(serverDir, { recursive: true })
await fs.copyFile(workerBundle, new URL('../dist/server/index.js', import.meta.url))

// Remove stale root-level Vite output from builds made before the Cloudflare
// client/worker environments were enabled. Sites serves the canonical client
// bundle from dist/client.
for (const relativePath of ['assets', 'data', 'favicon.svg', 'index.html']) {
  await fs.rm(new URL(relativePath, distDir), { force: true, recursive: true })
}
