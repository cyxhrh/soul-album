import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const node = process.execPath

function launch(args, env = process.env) {
  return spawn(node, args, { cwd: root, env, stdio: 'inherit' })
}

const compiler = launch(['node_modules/typescript/bin/tsc', '-p', 'tsconfig.server.json'])
const [buildCode] = await once(compiler, 'exit')
if (buildCode !== 0) {
  process.exitCode = buildCode ?? 1
} else {
  const server = launch(['dist-server/server/index.js'], {
    ...process.env,
    SOUL_ALBUM_AI_PORT: process.env.SOUL_ALBUM_AI_PORT ?? '8787',
  })
  const vite = launch([
    'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5175', '--strictPort',
  ])
  let stopping = false
  function stop(code) {
    if (stopping) return
    stopping = true
    server.kill()
    vite.kill()
    process.exitCode = code ?? 1
  }
  server.on('exit', (code) => stop(code))
  vite.on('exit', (code) => stop(code))
  process.on('SIGINT', () => stop(0))
  process.on('SIGTERM', () => stop(0))
}
