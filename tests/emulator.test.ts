import { afterEach, describe, expect, it, vi } from 'vitest'

import {
    createIgdbEmulator,
    defaultEmulatorAliases,
    defaultEmulatorDataset,
    type IgdbEmulator,
    type IgdbEmulatorQueryContext,
} from '../src/emulator.js'
import {
    and,
    arrayContains,
    arrayOverlaps,
    asc,
    createIgdbClient,
    desc,
    eq,
    gt,
    gte,
    IgdbError,
    inArray,
    isNotNull,
    isNull,
    lt,
    lte,
    ne,
    notInArray,
    or,
    type IgdbClientOptions,
} from '../src/index.js'

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

describe('IGDB emulator', () => {
    it('runs queries without credentials or any network fetch calls', async () => {
        const fetchSpy = vi.fn<typeof globalThis.fetch>(() => {
            throw new Error('Emulator must never invoke global fetch')
        })
        vi.stubGlobal('fetch', fetchSpy)

        const igdb = createIgdbClient({ emulator: createIgdbEmulator(), timeoutMs: 5_000 })
        const sf6 = await igdb.query('games').fields('id', 'slug', 'name', 'cover.image_id').search('sf6').limit(10)
        expect(sf6).toHaveLength(1)
        expect(sf6[0]).toMatchObject({
            id: 191692,
            slug: 'street-fighter-6',
            name: 'Street Fighter 6',
        })
        expect(sf6[0]?.cover?.id).toBeTypeOf('number')
        expect(sf6[0]?.cover?.image_id).toMatch(/^[a-zA-Z0-9_]+$/u)

        const [valorant] = await igdb
            .query('games')
            .fields('id', 'slug', 'name', 'cover.image_id')
            .where((g) => eq(g.slug, 'valorant'))
            .limit(1)
        expect(valorant).toMatchObject({ id: 126459, slug: 'valorant', name: 'VALORANT' })
        expect(valorant?.cover?.image_id).toMatch(/^[a-zA-Z0-9_]+$/u)
        expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('ships 15 built-in titles with valid covers and missing-cover fixtures', () => {
        expect(defaultEmulatorDataset.games).toHaveLength(15)
        expect(Object.isFrozen(defaultEmulatorDataset)).toBe(true)
        expect(Object.isFrozen(defaultEmulatorAliases)).toBe(true)

        const slugs = new Set(defaultEmulatorDataset.games?.map((game) => game.slug))
        expect(slugs).toContain('vrchat')
        expect(slugs).toContain('hades-ii')
        expect(defaultEmulatorDataset.games?.find((game) => game.id === 27789)?.cover).toBeUndefined()
        expect(defaultEmulatorDataset.games?.find((game) => game.id === 228530)?.cover).toBeUndefined()

        for (const cover of defaultEmulatorDataset.covers ?? []) {
            expect(cover.image_id).toMatch(/^[a-zA-Z0-9_]+$/u)
        }
    })

    it('projects fields with implicit id, wildcards, relation expansion, and omitted undefined fields', async () => {
        const igdb = createIgdbClient({ emulator: createIgdbEmulator() })

        const minimal = await igdb
            .query('games')
            .fields('name')
            .where((g) => eq(g.id, 126459))
        expect(minimal).toEqual([{ id: 126459, name: 'VALORANT' }])

        const expanded = await igdb
            .query('games')
            .fields('name', 'cover.image_id', 'platforms.abbreviation')
            .where((g) => eq(g.id, 126459))
        expect(expanded).toEqual([
            {
                id: 126459,
                name: 'VALORANT',
                cover: { id: 1001, image_id: 'co2mvt' },
                platforms: [
                    { id: 6, abbreviation: 'PC' },
                    { id: 167, abbreviation: 'PS5' },
                    { id: 169, abbreviation: 'Series X|S' },
                ],
            },
        ])

        const missingCover = await igdb
            .query('games')
            .fields('slug', 'cover.image_id')
            .where((g) => eq(g.id, 27789))
        expect(missingCover).toEqual([{ id: 27789, slug: 'vrchat' }])
        expect('cover' in (missingCover[0] ?? {})).toBe(false)

        const wildcard = await igdb
            .query('games')
            .fields('*')
            .where((g) => eq(g.id, 126459))
        expect(wildcard[0]).toMatchObject({ id: 126459, slug: 'valorant', name: 'VALORANT', cover: 1001 })

        const wildcardExpanded = await igdb
            .query('games')
            .fields('*', 'cover.*')
            .where((g) => eq(g.id, 126459))
        expect(wildcardExpanded[0]?.cover).toMatchObject({ id: 1001, game: 126459, image_id: 'co2mvt' })
    })

    it('evaluates all 14 predicates, empty list boundaries, and dotted relation filters', async () => {
        const igdb = createIgdbClient({
            emulator: createIgdbEmulator({
                mode: 'replace',
                data: {
                    games: [
                        {
                            id: 1,
                            slug: 'alpha',
                            name: 'Alpha',
                            rating: 90,
                            cover: 10,
                            platforms: [6, 48],
                            release_dates: [100, 101],
                        },
                        {
                            id: 2,
                            slug: 'beta',
                            name: 'Beta',
                            rating: 75,
                            platforms: [6],
                            release_dates: [102],
                        },
                        {
                            id: 3,
                            slug: 'gamma',
                            name: 'Gamma',
                            rating: 60,
                            cover: 11,
                            platforms: [130],
                        },
                    ],
                    covers: [
                        { id: 10, game: 1, image_id: 'co_alpha' },
                        { id: 11, game: 3, image_id: 'co_gamma' },
                    ],
                    release_dates: [
                        { id: 100, game: 1, platform: 6, date: 1_700_000_000 },
                        { id: 101, game: 1, platform: 48, date: 1_710_000_000 },
                        { id: 102, game: 2, platform: 6, date: 1_600_000_000 },
                    ],
                },
            }),
        })

        const ids = async (query: ReturnType<typeof igdb.query<'games'>>) => (await query).map((row) => row.id)

        expect(await ids(igdb.query('games').where((g) => eq(g.slug, 'alpha')))).toEqual([1])
        expect(await ids(igdb.query('games').where((g) => ne(g.slug, 'alpha')))).toEqual([2, 3])
        expect(await ids(igdb.query('games').where((g) => gt(g.rating, 75)))).toEqual([1])
        expect(await ids(igdb.query('games').where((g) => gte(g.rating, 75)))).toEqual([1, 2])
        expect(await ids(igdb.query('games').where((g) => lt(g.rating, 75)))).toEqual([3])
        expect(await ids(igdb.query('games').where((g) => lte(g.rating, 75)))).toEqual([2, 3])
        expect(await ids(igdb.query('games').where((g) => and(gte(g.rating, 70), lt(g.rating, 90))))).toEqual([2])
        expect(await ids(igdb.query('games').where((g) => or(eq(g.id, 1), eq(g.id, 3))))).toEqual([1, 3])
        expect(await ids(igdb.query('games').where((g) => inArray(g.id, [1, 3])))).toEqual([1, 3])
        expect(await ids(igdb.query('games').where((g) => inArray(g.id, [])))).toEqual([])
        expect(await ids(igdb.query('games').where((g) => notInArray(g.id, [2])))).toEqual([1, 3])
        expect(await ids(igdb.query('games').where((g) => notInArray(g.id, [])))).toEqual([1, 2, 3])
        expect(await ids(igdb.query('games').where((g) => isNull(g.cover)))).toEqual([2])
        expect(await ids(igdb.query('games').where((g) => isNotNull(g.cover)))).toEqual([1, 3])
        expect(await ids(igdb.query('games').where((g) => arrayContains(g.platforms, [6, 48])))).toEqual([1])
        expect(await ids(igdb.query('games').where((g) => arrayOverlaps(g.platforms, [48, 130])))).toEqual([1, 3])

        // Dotted single and many relation predicates
        expect(await ids(igdb.query('games').where((g) => eq(g.cover.image_id, 'co_gamma')))).toEqual([3])
        expect(await ids(igdb.query('games').where((g) => arrayOverlaps(g.release_dates.platform, [48])))).toEqual([1])
        expect(await ids(igdb.query('games').where((g) => gt(g.release_dates.date, 1_650_000_000)))).toEqual([1])
    })

    it('ranks search matches by exact, prefix, word boundary, substring, then id, and supports aliases', async () => {
        const igdb = createIgdbClient({
            emulator: createIgdbEmulator({
                mode: 'replace',
                data: {
                    games: [
                        { id: 50, slug: 'super-nova', name: 'Super Nova' },
                        { id: 40, slug: 'chronova', name: 'Chronova' },
                        { id: 30, slug: 'nova-strike', name: 'Nova Strike' },
                        { id: 20, slug: 'nova', name: 'Nova' },
                        { id: 10, slug: 'nova-zero', name: 'Nova Zero' },
                    ],
                },
                aliases: {
                    50: ['sn'],
                },
            }),
        })

        const ranked = await igdb.query('games').fields('name').search('NOVA')
        expect(ranked.map((g) => g.id)).toEqual([
            20, // exact
            10, // prefix, id 10
            30, // prefix, id 30
            50, // word boundary ("Super Nova")
            40, // substring ("Chronova")
        ])

        expect((await igdb.query('games').fields('name').search('sn')).map((g) => g.id)).toEqual([50])
        expect(await igdb.query('games').search('does-not-exist')).toEqual([])
    })

    it('sorts stably with null/undefined last and defaults pagination to offset 0, limit 10', async () => {
        const igdb = createIgdbClient({ emulator: createIgdbEmulator() })

        // Default limit is 10 across 15 built-in games
        expect(await igdb.query('games')).toHaveLength(10)
        expect(await igdb.query('games').offset(10)).toHaveLength(5)
        expect(await igdb.query('games').limit(3).offset(2)).toHaveLength(3)

        const nullSortClient = createIgdbClient({
            emulator: createIgdbEmulator({
                mode: 'replace',
                data: {
                    games: [
                        { id: 1, name: 'NoRating1' },
                        { id: 2, name: 'Mid', rating: 80 },
                        { id: 3, name: 'High', rating: 95 },
                        { id: 4, name: 'NoRating2' },
                        { id: 5, name: 'MidTie', rating: 80 },
                    ],
                },
            }),
        })

        expect((await nullSortClient.query('games').orderBy((g) => asc(g.rating))).map((g) => g.id)).toEqual([
            2, 5, 3, 1, 4,
        ])
        expect((await nullSortClient.query('games').orderBy((g) => desc(g.rating))).map((g) => g.id)).toEqual([
            3, 2, 5, 1, 4,
        ])
    })

    it('supports merge and replace modes without leaking external mutations', async () => {
        const customGames = [{ id: 126459, slug: 'valorant', name: 'VALORANT Custom', rating: 99 }]
        const merged = createIgdbClient({
            emulator: createIgdbEmulator({
                mode: 'merge',
                data: { games: customGames },
                aliases: { 126459: ['valo'] },
            }),
        })
        customGames[0]!.name = 'MUTATED'

        const allMerged = await merged.query('games').limit(50)
        expect(allMerged).toHaveLength(15)
        const [val] = await merged.query('games').fields('name', 'rating').search('valo')
        expect(val).toEqual({ id: 126459, name: 'VALORANT Custom', rating: 99 })

        // Mutating the returned object must not affect subsequent queries.
        val!.name = 'TAMPERED'
        const [valAgain] = await merged.query('games').fields('name').search('val')
        expect(valAgain?.name).toBe('VALORANT Custom')

        const emptyReplaced = createIgdbClient({ emulator: createIgdbEmulator({ mode: 'replace' }) })
        expect(await emptyReplaced.query('games')).toEqual([])
    })

    it('enforces delayMs, AbortSignal, timeoutMs, and onQuery error injection with IgdbError', async () => {
        vi.useFakeTimers()
        const contexts: IgdbEmulatorQueryContext[] = []
        const delayed = createIgdbClient({
            emulator: createIgdbEmulator({
                delayMs: 100,
                onQuery: (ctx) => {
                    contexts.push(ctx)
                },
            }),
            timeoutMs: 1_000,
        })

        // Timeout
        const timedOut = delayed
            .query('games')
            .limit(1)
            .execute({ timeoutMs: 25 })
            .catch((cause: unknown) => cause)
        await vi.advanceTimersByTimeAsync(25)
        const timeoutErr = await timedOut
        expect(timeoutErr).toBeInstanceOf(IgdbError)
        expect(timeoutErr).toMatchObject({ code: 'TIMEOUT', phase: 'request' })
        expect(vi.getTimerCount()).toBe(0)

        // Abort
        const controller = new AbortController()
        const aborted = delayed
            .query('games')
            .limit(1)
            .execute({ signal: controller.signal })
            .catch((cause: unknown) => cause)
        await vi.advanceTimersByTimeAsync(10)
        controller.abort()
        const abortErr = await aborted
        expect(abortErr).toBeInstanceOf(IgdbError)
        expect(abortErr).toMatchObject({ code: 'ABORTED', phase: 'request' })
        expect(vi.getTimerCount()).toBe(0)

        // Successful completion after delay
        const okPromise = delayed.query('games').fields('slug').limit(1).execute({ timeoutMs: 500 })
        await vi.advanceTimersByTimeAsync(100)
        expect(await okPromise).toHaveLength(1)
        expect(contexts).toHaveLength(1)
        expect(contexts[0]?.endpoint).toBe('games')
        expect(contexts[0]?.query).toBe('fields slug; limit 1;')
        expect(contexts[0]?.options).toEqual({ timeoutMs: 500 })

        // onQuery error injection
        const failing = createIgdbClient({
            emulator: createIgdbEmulator({
                onQuery: () => {
                    throw new IgdbError('HTTP_ERROR', 'request', { status: 429, retryAfter: 3 })
                },
            }),
        })
        await expect(failing.query('games').limit(1)).rejects.toMatchObject({
            code: 'HTTP_ERROR',
            phase: 'request',
            status: 429,
            retryAfter: 3,
        })
    })

    it('rejects forged emulator adapters and mixed credential/emulator options', () => {
        expect(() =>
            createIgdbClient({
                emulator: {} as unknown as IgdbEmulator,
            }),
        ).toThrow(TypeError)

        const emulator = createIgdbEmulator()
        expect(() =>
            createIgdbClient({
                emulator,
                clientId: 'client',
            } as unknown as IgdbClientOptions),
        ).toThrow(TypeError)
    })

    it('preserves first-seen ID order on duplicate overrides and handles lazy where pagination and deep offsets', async () => {
        const queries: string[] = []
        const initial = Array.from({ length: 2_000 }, (_, i) => ({
            id: i + 1,
            slug: `game-${i + 1}`,
            name: `Game ${i + 1}`,
            rating: i % 100,
        }))
        const overrides = [
            { id: 1, slug: 'game-1-v2', name: 'Game 1 Updated', rating: 99 },
            { id: 500, slug: 'game-500-v2', name: 'Game 500 Updated', rating: 99 },
        ]
        const igdb = createIgdbClient({
            emulator: createIgdbEmulator({
                mode: 'replace',
                data: { games: [...initial, ...overrides] },
                onQuery: (ctx) => {
                    queries.push(ctx.query)
                },
            }),
        })

        // First-seen order preserved with last-seen record winning.
        const firstTwo = await igdb.query('games').fields('slug', 'name', 'rating').limit(2)
        expect(firstTwo).toEqual([
            { id: 1, slug: 'game-1-v2', name: 'Game 1 Updated', rating: 99 },
            { id: 2, slug: 'game-2', name: 'Game 2', rating: 1 },
        ])

        // Lazy where pagination with offset + limit.
        const highRatedPage = await igdb
            .query('games')
            .fields('id', 'rating')
            .where((g) => eq(g.rating, 99))
            .offset(2)
            .limit(3)
        expect(highRatedPage.map((row) => row.id)).toEqual([200, 300, 400])

        // Large inArray candidate list (1,000 IDs).
        const candidateIds = Array.from({ length: 1_000 }, (_, i) => i * 2 + 1)
        const matched = await igdb
            .query('games')
            .fields('id')
            .where((g) => inArray(g.id, candidateIds))
            .offset(10)
            .limit(5)
        expect(matched.map((row) => row.id)).toEqual([21, 23, 25, 27, 29])

        // Deep offset beyond dataset length returns [] while still invoking onQuery.
        const countBefore = queries.length
        expect(await igdb.query('games').offset(5_000).limit(10)).toEqual([])
        expect(queries.length).toBe(countBefore + 1)
    })

    it('sorts records with large numeric relation arrays iteratively without stack overflow', async () => {
        const releaseDates = Array.from({ length: 150_000 }, (_, i) => ({
            id: i + 1,
            date: 2_000_000_000 - i,
        }))
        const igdb = createIgdbClient({
            emulator: createIgdbEmulator({
                mode: 'replace',
                data: {
                    games: [
                        { id: 1, name: 'Large', release_dates: releaseDates },
                        { id: 2, name: 'Older', release_dates: [{ id: 999_999, date: 1_000_000_000 }] },
                        { id: 3, name: 'Missing' },
                    ],
                },
            }),
        })

        const ascIds = (await igdb.query('games').orderBy((g) => asc(g.release_dates.date))).map((row) => row.id)
        const descIds = (await igdb.query('games').orderBy((g) => desc(g.release_dates.date))).map((row) => row.id)
        expect(ascIds).toEqual([2, 1, 3])
        expect(descIds).toEqual([1, 2, 3])
    })
})
