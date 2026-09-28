import { webcrypto } from 'node:crypto'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { build } from 'vite'

describe('local repository browser bundle', () => {
  it('runs a synchronous transaction and replay without Node globals', async () => {
    const entry = resolve('backend/local/index.ts').replaceAll('\\', '/')
    const result = await build({
      configFile: false,
      logLevel: 'silent',
      plugins: [{
        name: 'browser-repository-probe',
        resolveId(id) { return id === 'virtual:browser-repository-probe' ? id : null },
        load(id) {
          if (id !== 'virtual:browser-repository-probe') return null
          return `
            import { InMemorySpaceRepository } from ${JSON.stringify(entry)};
            const repository = new InMemorySpaceRepository({ now: () => '2026-09-29T09:00:00Z' });
            const spaceId = '11111111-1111-4111-8111-111111111111';
            repository.createSpace(spaceId, 'Asia/Shanghai');
            const key = {
              clientOperationId: '22222222-2222-4222-8222-222222222222',
              fingerprint: '中文和 emoji 🙂', expectedSpaceRevision: 0,
            };
            const first = repository.transact(spaceId, key, () => 'committed');
            const replay = repository.transact(spaceId, key, () => { throw Error('replayed mutation'); });
            globalThis.probeResult = { first, replay, revision: repository.read(spaceId).revision };
          `
        },
      }],
      build: {
        write: false,
        minify: false,
        rollupOptions: {
          input: 'virtual:browser-repository-probe',
          output: { format: 'iife', name: 'BrowserRepositoryProbe' },
        },
      },
    })
    const output = Array.isArray(result) ? result[0] : result
    const code = output.output.find((item) => item.type === 'chunk')
    if (!code || code.type !== 'chunk') throw new Error('browser bundle did not produce JavaScript')

    const context = { crypto: webcrypto, structuredClone, TextEncoder, probeResult: null }
    runInNewContext(code.code, context)
    expect(context.probeResult).toEqual({ first: 'committed', replay: 'committed', revision: 1 })
  })
})
