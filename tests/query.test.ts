import { describe, expect, it, vi } from 'vitest'

import { endpoints } from '../src/endpoints.js'
import { and, arrayOverlaps, createIgdbClient, desc, eq, gte, IgdbError } from '../src/index.js'

function mockFetch(value: unknown = []): ReturnType<typeof vi.fn<typeof fetch>> {
    return vi.fn<typeof fetch>().mockImplementation(async () => Response.json(value))
}

describe('fluent queries', () => {
    it('builds a filter and sort against fields that are not selected without any I/O', () => {
        const fetch = mockFetch()
        const client = createIgdbClient({ clientId: 'client', clientSecret: 'secret', fetch })
        const query = client
            .query('games')
            .fields('id', 'name', 'cover.image_id')
            .where((g) => and(gte(g.rating, 80), arrayOverlaps(g.platforms, [6])))
            .orderBy((g) => desc(g.rating))
            .limit(20)
            .offset(40)

        const text = query.build()
        expect(text).toContain('fields id,name,cover.image_id;')
        expect(text).toContain('rating >= 80')
        expect(text).toContain('platforms = (6)')
        expect(text).toContain('sort rating desc;')
        expect(text).toContain('limit 20;')
        expect(text).toContain('offset 40;')
        expect(fetch).not.toHaveBeenCalled()
    })

    it('preserves reusable queries across concurrent branches and repeated requests', async () => {
        const fetch = mockFetch([{ id: 7, name: 'Game' }])
        const client = createIgdbClient({ clientId: 'client', accessToken: 'token', fetch })
        const base = client.query('games').fields('id', 'name')
        const search = base.search('Zelda').limit(10)
        const byId = base.where((g) => eq(g.id, 7)).limit(1)

        await Promise.all([search.request(), byId.request(), byId.request()])

        expect(base.build()).toBe('fields id,name;')
        expect(search.build()).toBe('fields id,name; search "Zelda"; limit 10;')
        expect(byId.build()).toBe('fields id,name; where id = 7; limit 1;')
        expect(fetch.mock.calls.map(([, options]) => options?.body)).toEqual([
            search.build(),
            byId.build(),
            byId.build(),
        ])
    })

    it('posts the query to its endpoint and keeps the returned JSON shape', async () => {
        const data = [{ id: 1, name: 'Game', cover: { id: 9, image_id: 'co_123' } }]
        const fetch = mockFetch(data)
        const client = createIgdbClient({ clientId: 'client', accessToken: 'token', fetch })

        const result = await client.query('games').fields('name', 'cover.image_id').request()

        expect(result).toEqual(data)
        expect(fetch.mock.calls[0]?.[0]).toBe('https://api.igdb.com/v4/games')
        const init = fetch.mock.calls[0]?.[1]
        expect(init?.method).toBe('POST')
        expect(init?.body).toBe('fields name,cover.image_id;')
        const headers = new Headers(init?.headers)
        expect(headers.get('Client-ID')).toBe('client')
        expect(headers.get('Authorization')).toBe('Bearer token')
        expect(headers.get('Content-Type')).toBe('text/plain')
    })

    it('supports all documented endpoints and rejects arbitrary request paths', () => {
        const client = createIgdbClient({
            clientId: 'client',
            accessToken: 'token',
            fetch: mockFetch(),
        })
        for (const endpoint of endpoints) expect(client.query(endpoint).build()).toBe('fields id;')
        for (const endpoint of ['../games', 'games/count', 'games?access_token=token', 'unknown', '']) {
            expect(() => client.query(endpoint as never)).toThrow(TypeError)
        }
    })

    it('allows search only on documented searchable endpoints', () => {
        const fetch = mockFetch()
        const client = createIgdbClient({ clientId: 'client', accessToken: 'token', fetch })
        for (const endpoint of ['characters', 'collections', 'games', 'platforms', 'search', 'themes'] as const) {
            expect(client.query(endpoint).search('Zelda').build()).toBe('fields id; search "Zelda";')
        }
        expect(() => client.query('covers').search('Zelda' as never)).toThrow(TypeError)
        expect(fetch).not.toHaveBeenCalled()
    })

    it('replaces each setting explicitly and removes a filter when it becomes undefined', () => {
        const client = createIgdbClient({
            clientId: 'client',
            accessToken: 'token',
            fetch: mockFetch(),
        })
        const query = client
            .query('games')
            .fields('name')
            .fields('slug', 'slug')
            .where((g) => eq(g.id, 1))
            .where(() => undefined)
            .search('first')
            .search('second')
            .limit(3)
            .limit(5)
            .offset(9)
            .offset(0)
        expect(query.build()).toBe('fields slug; search "second"; limit 5; offset 0;')
    })

    it('quotes a search value as data instead of accepting injected clauses', () => {
        const client = createIgdbClient({
            clientId: 'client',
            accessToken: 'token',
            fetch: mockFetch(),
        })
        const value = 'a"; limit 500; search "b\\c'
        const text = client.query('games').search(value).build()
        expect(text).toBe(`fields id; search ${JSON.stringify(value)};`)
    })

    it('rejects malformed field paths and noninteger pagination from JavaScript callers', () => {
        const query = createIgdbClient({ clientId: 'client', accessToken: 'token' }).query('games')
        for (const path of ['name; limit 500', 'cover..image_id', 'name,slug', '*.*', '']) {
            expect(() => query.fields(path as never)).toThrow(TypeError)
        }
        for (const limit of [-1, 0, 501, 1.5, NaN, Infinity]) {
            expect(() => query.limit(limit)).toThrow(RangeError)
        }
        for (const offset of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
            expect(() => query.offset(offset)).toThrow(RangeError)
        }
    })

    it.each([null, {}, [null], [42], [[]]])('rejects an unexpected query result shape: %j', async (data) => {
        const client = createIgdbClient({
            clientId: 'client',
            accessToken: 'token',
            fetch: mockFetch(data),
        })
        await expect(client.query('games').request()).rejects.toMatchObject({
            name: 'IgdbError',
            code: 'INVALID_RESPONSE',
            phase: 'request',
        })
    })

    it('returns an empty page as an empty array', async () => {
        const client = createIgdbClient({
            clientId: 'client',
            accessToken: 'token',
            fetch: mockFetch(),
        })
        await expect(client.query('platforms').fields('name').request()).resolves.toEqual([])
    })

    it('provides structured errors without exposing request credentials', async () => {
        const fetch = vi
            .fn<typeof globalThis.fetch>()
            .mockImplementation(
                async () => new Response('Bearer secret-token / a confidential response', { status: 403 }),
            )
        const client = createIgdbClient({ clientId: 'client', accessToken: 'secret-token', fetch })
        const error = await client
            .query('games')
            .request()
            .catch((cause: unknown) => cause)
        expect(error).toBeInstanceOf(IgdbError)
        expect(error).toMatchObject({ status: 403, phase: 'request' })
        expect(String(error)).not.toContain('secret-token')
        expect(JSON.stringify(error)).not.toContain('confidential')
    })
})
