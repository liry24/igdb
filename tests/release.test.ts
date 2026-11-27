import { access, readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

const root = new URL('../', import.meta.url)

function readText(relativePath: string): Promise<string> {
    return readFile(new URL(relativePath, root), 'utf8')
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function extractJobBlock(workflow: string, jobName: string): string {
    const lines = workflow.split(/\r?\n/u)
    const start = lines.findIndex((line) => line === `    ${jobName}:`)
    expect(start, `Missing job "${jobName}"`).toBeGreaterThan(-1)
    let end = lines.length
    for (let index = start + 1; index < lines.length; index += 1) {
        if (/^ {4}[a-z0-9-]+:$/u.test(lines[index]!)) {
            end = index
            break
        }
    }
    return lines.slice(start, end).join('\n')
}

describe('release infrastructure contracts', () => {
    it('declares OIDC-compatible npm publishing metadata in package.json', async () => {
        const parsed: unknown = JSON.parse(await readText('package.json'))
        expect(isRecord(parsed)).toBe(true)
        if (!isRecord(parsed)) return

        expect(parsed.name).toBe('@liry24/igdb')
        expect(isRecord(parsed.publishConfig) ? parsed.publishConfig.access : undefined).toBe('public')
        expect(isRecord(parsed.repository) ? parsed.repository.url : undefined).toBe(
            'git+https://github.com/liry24/igdb.git',
        )
        expect(isRecord(parsed.scripts) ? parsed.scripts.prepack : undefined).toBe('npm run build')
        expect(parsed.files).toEqual(['dist', 'LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.md'])
    })

    it('gates all blocking CI jobs behind ci-ok', async () => {
        const ci = await readText('.github/workflows/ci.yml')
        expect(ci).toMatch(/^permissions: \{\}$/mu)
        const gate = extractJobBlock(ci, 'ci-ok')
        expect(gate).toContain('if: always()')
        expect(gate).toContain('needs: [build, typecheck, lint, unit, test-consumer]')
        expect(gate).toContain('all(.[]; .result == "success")')
    })

    it('pins all release workflow actions and enforces CI and tarball verification before publish', async () => {
        const release = await readText('.github/workflows/release.yml')
        expect(release).toMatch(/^permissions: \{\}$/mu)
        expect(release).toContain("branches: [main, 'release/v*']")

        const usesRefs = [...release.matchAll(/uses:\s*([^\s#]+)/gu)].map((match) => match[1]!)
        const externalRefs = usesRefs.filter((ref) => !ref.startsWith('./'))
        expect(externalRefs.length).toBeGreaterThan(0)
        for (const ref of externalRefs) {
            expect(ref).toMatch(/^[^@]+@[0-9a-f]{40}$/u)
        }

        const upptRefs = [...release.matchAll(/uses:\s*danielroe\/uppt\/(pr|release|pack|publish)@([0-9a-f]{40})/gu)]
        expect(upptRefs).toHaveLength(4)
        expect(new Set(upptRefs.map((match) => match[1]))).toEqual(new Set(['pack', 'pr', 'publish', 'release']))
        expect(new Set(upptRefs.map((match) => match[2])).size).toBe(1)

        const prJob = extractJobBlock(release, 'pr')
        expect(prJob).toContain('!github.event.repository.fork')
        expect(prJob).toContain("startsWith(github.ref, 'refs/heads/release/v')")
        expect(prJob).toContain('contents: write')
        expect(prJob).toContain('pull-requests: write')
        expect(prJob).not.toContain('id-token: write')

        const releaseJob = extractJobBlock(release, 'release')
        expect(releaseJob).toContain('github.event.pull_request.merged == true')
        expect(releaseJob).toContain("startsWith(github.event.pull_request.head.ref, 'release/v')")
        expect(releaseJob).toContain('github.event.pull_request.head.repo.full_name == github.repository')
        expect(releaseJob).toContain('!github.event.repository.fork')
        expect(releaseJob).toContain('contents: write')
        expect(releaseJob).toContain('actions: write')
        expect(releaseJob).not.toContain('id-token: write')

        const packJob = extractJobBlock(release, 'pack')
        expect(packJob).toContain("startsWith(github.ref, 'refs/tags/v')")
        expect(packJob).toContain('!github.event.repository.fork')
        expect(packJob).toContain('gh run watch "$run_id" --exit-status')
        expect(packJob).toContain('select(.name == "ci-ok")')
        expect(packJob).toContain('uses: ./.github/actions/setup')
        expect(packJob).toContain('checkout: false')
        expect(packJob).toContain('install: false')
        expect(packJob).toContain(
            'IGDB_TARBALL="$RUNNER_TEMP/uppt-pack/$tarball" node --experimental-vm-modules scripts/verify-package.ts',
        )
        expect(packJob).not.toContain('id-token: write')

        const publishJob = extractJobBlock(release, 'publish')
        expect(publishJob).toContain('needs: pack')
        expect(publishJob).toContain('environment: npm')
        expect(publishJob).toContain('id-token: write')
        expect(publishJob).toContain("needs.pack.outputs.files != '[]'")
        expect(publishJob).not.toContain('contents: write')
        expect(publishJob).not.toContain('pull-requests: write')
        expect(publishJob).not.toContain('actions: write')

        expect(release.indexOf('Verify the exact release artifact')).toBeLessThan(release.indexOf('    publish:'))
    })

    it('replaces the legacy package-only workflow with release.yml', async () => {
        await expect(access(new URL('.github/workflows/package.yml', root))).rejects.toMatchObject({
            code: 'ENOENT',
        })
    })
})
