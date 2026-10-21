import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import * as vm from 'node:vm'
import { gunzipSync, gzipSync } from 'node:zlib'

const directory = new URL('../.package-check/', import.meta.url)
const args = process.argv.slice(2)

if (args.length > 1 || (args.length === 1 && !['--prepare', '--keep', '--consumer'].includes(args[0]!))) {
    throw new Error(
        'Usage: node [--experimental-vm-modules] scripts/verify-package.ts [--prepare | --keep | --consumer]',
    )
}

function readTarText(block: Buffer, start: number, end: number): string {
    return block.subarray(start, end).toString('utf8').replace(/\0.*$/s, '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function unpack(archive: Buffer): Map<string, Buffer> {
    const tar = gunzipSync(archive)
    const entries = new Map<string, Buffer>()
    for (let offset = 0; offset + 512 <= tar.length;) {
        const header = tar.subarray(offset, offset + 512)
        if (header.every((byte) => byte === 0)) break
        const prefix = readTarText(header, 345, 500)
        const name = `${prefix ? `${prefix}/` : ''}${readTarText(header, 0, 100)}`
        const size = Number.parseInt(readTarText(header, 124, 136).trim(), 8)
        const kind = readTarText(header, 156, 157)
        assert(Number.isSafeInteger(size) && size >= 0, `Invalid tar entry size: ${name}`)
        assert(offset + 512 + size <= tar.length, `Truncated tar entry: ${name}`)
        assert(name.startsWith('package/') && !name.split('/').includes('..'), `Invalid path: ${name}`)
        if (kind !== '5') {
            assert(kind === '' || kind === '0', `Unexpected tar entry type: ${name}`)
            assert(!entries.has(name), `Duplicate tar entry: ${name}`)
            entries.set(name, tar.subarray(offset + 512, offset + 512 + size))
        }
        offset += 512 + Math.ceil(size / 512) * 512
    }

    return entries
}

async function verify(): Promise<void> {
    const archives = (await readdir(directory)).filter((name) => name.endsWith('.tgz'))
    assert.equal(archives.length, 1, 'Expected one tarball from npm pack')
    const archive = await readFile(new URL(archives[0]!, directory))
    const sha256 = createHash('sha256').update(archive).digest('hex')
    if (args[0] === '--consumer') {
        const expectedHash = (await readFile(new URL('sha256.txt', directory), 'utf8')).trim()
        assert.equal(sha256, expectedHash, 'The consumer archive differs from the verified build')
    }
    const entries = unpack(archive)
    const expectedFiles = [
        'package/LICENSE',
        'package/README.md',
        'package/THIRD_PARTY_NOTICES.md',
        'package/dist/index.d.ts',
        'package/dist/index.js',
        'package/package.json',
    ]
    assert.deepEqual(new Set(entries.keys()), new Set(expectedFiles), 'Unexpected published files')

    const manifest: unknown = JSON.parse(entries.get('package/package.json')!.toString('utf8'))
    assert(isRecord(manifest), 'The package manifest must be an object')
    assert.equal(manifest.name, '@liry24/igdb')
    assert.equal(manifest.type, 'module')
    assert.equal(manifest.sideEffects, false)
    assert.deepEqual(manifest.exports, {
        '.': { types: './dist/index.d.ts', default: './dist/index.js' },
    })
    for (const field of [
        'dependencies',
        'peerDependencies',
        'optionalDependencies',
        'bundledDependencies',
        'bundleDependencies',
    ]) {
        const dependencies = manifest[field]
        assert(
            dependencies === undefined ||
                (dependencies !== null && typeof dependencies === 'object' && Object.keys(dependencies).length === 0),
            `${field} must be empty`,
        )
    }

    const runtime = entries.get('package/dist/index.js')!
    const declarations = entries.get('package/dist/index.d.ts')!
    assert(runtime.length > 0 && declarations.length > 0, 'Build output must not be empty')

    // No process, Buffer, require, or Node modules are available in this realm.
    // This checks standard Web APIs, not Cloudflare's full runtime integration.
    const module = new vm.SourceTextModule(runtime.toString('utf8'), {
        context: vm.createContext({
            AbortController,
            AbortSignal,
            Headers,
            Request,
            Response,
            URL,
            URLSearchParams,
            TextDecoder,
            TextEncoder,
            setTimeout,
            clearTimeout,
            fetch: (): never => {
                throw new Error('Unexpected global fetch; package checks must not use the network')
            },
        }),
        importModuleDynamically: (): never => {
            throw new Error('Runtime dynamic imports are not allowed')
        },
    })
    assert.deepEqual(module.dependencySpecifiers, [], 'The runtime bundle must have no imports')
    await module.link((): never => {
        throw new Error('Runtime module dependencies are not allowed')
    })
    await module.evaluate()

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The isolated build is exercised below against the source module's public contract.
    const api = module.namespace as typeof import('../src/index.js')
    let requests = 0
    const fetchMock: typeof fetch = async (input, init) => {
        requests += 1
        const request = new Request(input, init)
        assert.equal(request.url, 'https://api.igdb.com/v4/games')
        assert.equal(request.method, 'POST')
        assert.equal(request.headers.get('Client-ID'), 'package-check')
        assert.equal(request.headers.get('Authorization'), 'Bearer package-token')
        const body = await request.text()
        assert.match(body, /cover\.image_id/)
        assert.match(body, /rating\s*>=\s*80/)
        return Response.json([{ id: 1, name: 'Package check', cover: { id: 2, image_id: 'cover-check' } }])
    }
    const client = api.createIgdbClient({
        clientId: 'package-check',
        accessToken: 'package-token',
        fetch: fetchMock,
    })
    assert.equal(requests, 0, 'Client construction must not perform I/O')
    const rows = await client
        .query('games')
        .fields('name', 'cover.image_id')
        .where((game) => api.and(api.gte(game.rating, 80), api.arrayOverlaps(game.platforms, [6])))
        .orderBy((game) => api.desc(game.rating))
        .limit(1)
        .request()
    assert.equal(requests, 1)
    assert.equal(rows[0]?.id, 1)
    assert.equal(rows[0]?.name, 'Package check')

    const report = JSON.stringify(
        {
            name: manifest.name,
            version: manifest.version,
            files: expectedFiles,
            sha256,
            runtimeDependencies: 0,
            runtimeBytes: runtime.length,
            runtimeGzipBytes: gzipSync(runtime).length,
            declarationBytes: declarations.length,
            tarballBytes: archive.length,
            runtimeSmoke: 'passed with Web APIs and injected fetch',
        },
        null,
        2,
    )
    if (args[0] === '--keep') {
        await writeFile(new URL('sha256.txt', directory), `${sha256}\n`)
        await writeFile(new URL('report.json', directory), `${report}\n`)
    }
    console.log(report)
}

if (args[0] === '--prepare') {
    await rm(directory, { recursive: true, force: true })
    await mkdir(directory, { recursive: true })
} else {
    try {
        await verify()
    } finally {
        if (args[0] !== '--keep') await rm(directory, { recursive: true, force: true })
    }
}
