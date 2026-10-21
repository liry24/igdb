import { afterEach, describe, expect, it, vi } from 'vitest'

import { IgdbError } from '../src/errors.js'
import { createTransport, type IgdbClientOptions } from '../src/transport.js'

const tokenUrl = 'https://id.twitch.tv/oauth2/token'
const secret = 'synthetic-private-secret'
const tokenResponse = (value = 'token', seconds = 3600) =>
    Response.json({ access_token: value, expires_in: seconds, token_type: 'bearer' })

function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((done) => {
        resolve = done
    })
    return { promise, resolve }
}

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

describe('transport authentication', () => {
    it('uses a supplied access token without fetching or refreshing credentials', async () => {
        const fetch = vi
            .fn<typeof globalThis.fetch>()
            .mockResolvedValueOnce(Response.json([{ id: 1 }]))
            .mockResolvedValueOnce(new Response(secret, { status: 401 }))
        const transport = createTransport({ clientId: 'client', accessToken: 'external-token', fetch })
        expect(await transport.request('games', 'fields id;')).toEqual([{ id: 1 }])
        expect(fetch.mock.calls[0]?.[0]).toBe('https://api.igdb.com/v4/games')
        const init = fetch.mock.calls[0]?.[1]
        expect(init).toMatchObject({ method: 'POST', body: 'fields id;', redirect: 'error' })
        expect(new Headers(init?.headers).get('Client-ID')).toBe('client')
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer external-token')
        await expect(transport.request('games', 'fields id;')).rejects.toMatchObject({
            code: 'HTTP_ERROR',
            phase: 'request',
            status: 401,
        })
        expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('acquires tokens lazily with a single shared request and caches the result', async () => {
        const authentication = deferred<Response>()
        const fetch = vi.fn<typeof globalThis.fetch>(async (url) =>
            url === tokenUrl ? authentication.promise : Response.json([{ id: 1 }]),
        )
        const transport = createTransport({ clientId: 'client', clientSecret: secret, fetch })
        expect(fetch).not.toHaveBeenCalled()
        const first = transport.request('games', 'first')
        const second = transport.request('games', 'second')
        expect(fetch).toHaveBeenCalledTimes(1)
        const init = fetch.mock.calls[0]?.[1]
        expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
        expect(init?.body).toBeInstanceOf(URLSearchParams)
        const body = init!.body as URLSearchParams
        expect(body.get('client_secret')).toBe(secret)
        expect(body.get('grant_type')).toBe('client_credentials')
        expect(fetch.mock.calls[0]?.[0]).toBe(tokenUrl)
        authentication.resolve(tokenResponse())
        await Promise.all([first, second])
        await transport.request('games', 'third')
        expect(fetch.mock.calls.filter(([url]) => url === tokenUrl)).toHaveLength(1)
    })

    it('refreshes before expiry without discarding short-lived tokens immediately', async () => {
        vi.useFakeTimers()
        const fetch = vi.fn<typeof globalThis.fetch>(async (url) =>
            url === tokenUrl ? tokenResponse('short-lived', 2) : Response.json([]),
        )
        const transport = createTransport({ clientId: 'client', clientSecret: secret, fetch })
        await transport.request('games', 'first')
        await vi.advanceTimersByTimeAsync(1700)
        await transport.request('games', 'second')
        expect(fetch.mock.calls.filter(([url]) => url === tokenUrl)).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(101)
        await transport.request('games', 'third')
        expect(fetch.mock.calls.filter(([url]) => url === tokenUrl)).toHaveLength(2)
    })

    it('clears a failed shared authentication promise so a later request can recover', async () => {
        const fetch = vi
            .fn<typeof globalThis.fetch>()
            .mockResolvedValueOnce(new Response(secret, { status: 503 }))
            .mockResolvedValueOnce(tokenResponse())
            .mockResolvedValueOnce(Response.json([]))
        const transport = createTransport({ clientId: 'client', clientSecret: secret, fetch })
        await expect(transport.request('games', 'first')).rejects.toMatchObject({
            code: 'HTTP_ERROR',
            phase: 'auth',
            status: 503,
        })
        expect(await transport.request('games', 'second')).toEqual([])
        expect(fetch).toHaveBeenCalledTimes(3)
    })

    it('does not evict a refreshed token when an older concurrent request returns a late 401', async () => {
        const slow = deferred<Response>()
        let authentications = 0
        const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
            if (url === tokenUrl) return tokenResponse(++authentications === 1 ? 'old' : 'new')
            if (new Headers(init?.headers).get('Authorization') === 'Bearer old') {
                return init?.body === 'slow' ? slow.promise : new Response(null, { status: 401 })
            }
            return Response.json([{ id: 1 }])
        })
        const transport = createTransport({ clientId: 'client', clientSecret: secret, fetch })
        const fastRequest = transport.request('games', 'fast')
        const slowRequest = transport.request('games', 'slow')
        await fastRequest
        expect(authentications).toBe(2)
        slow.resolve(new Response(null, { status: 401 }))
        expect(await slowRequest).toEqual([{ id: 1 }])
        expect(authentications).toBe(2)
    })

    it('retries an unauthorized IGDB request only once in secret mode', async () => {
        const fetch = vi.fn<typeof globalThis.fetch>(async (url) =>
            url === tokenUrl ? tokenResponse() : new Response(secret, { status: 401 }),
        )
        const transport = createTransport({ clientId: 'client', clientSecret: secret, fetch })
        await expect(transport.request('games', 'fields id;')).rejects.toMatchObject({
            code: 'HTTP_ERROR',
            phase: 'request',
            status: 401,
        })
        expect(fetch.mock.calls.filter(([url]) => url === tokenUrl)).toHaveLength(2)
        expect(fetch.mock.calls.filter(([url]) => url !== tokenUrl)).toHaveLength(2)
    })
})

describe('request budgets', () => {
    it('does not let one caller abort shared authentication needed by another', async () => {
        const authentication = deferred<Response>()
        const fetch = vi.fn<typeof globalThis.fetch>(async (url) =>
            url === tokenUrl ? authentication.promise : Response.json([]),
        )
        const transport = createTransport({ clientId: 'client', clientSecret: secret, fetch })
        const controller = new AbortController()
        const cancelled = transport.request('games', 'cancelled', { signal: controller.signal })
        const rejection = cancelled.catch((cause: unknown) => cause)
        const surviving = transport.request('games', 'surviving')
        controller.abort(new Error(secret))
        expect(await rejection).toMatchObject({ code: 'ABORTED', phase: 'auth' })
        expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(false)
        authentication.resolve(tokenResponse())
        expect(await surviving).toEqual([])
        expect(fetch.mock.calls.map(([, init]) => init?.body)).not.toContain('cancelled')
    })

    it('keeps authentication, IGDB work and the 401 retry inside a single request deadline', async () => {
        vi.useFakeTimers()
        let authentications = 0
        const fetch = vi.fn<typeof globalThis.fetch>((url, init) => {
            if (url === tokenUrl) {
                const first = ++authentications === 1
                return new Promise((resolve) =>
                    setTimeout(() => resolve(tokenResponse(first ? 'old' : 'new')), first ? 30 : 60),
                )
            }
            if (new Headers(init?.headers).get('Authorization') === 'Bearer old') {
                return new Promise((resolve) => setTimeout(() => resolve(new Response(null, { status: 401 })), 30))
            }
            return Promise.resolve(Response.json([]))
        })
        const transport = createTransport({
            clientId: 'client',
            clientSecret: secret,
            fetch,
            timeoutMs: 1000,
        })
        const request = transport.request('games', 'fields id;', { timeoutMs: 100 })
        const rejection = request.catch((cause: unknown) => cause)
        await vi.advanceTimersByTimeAsync(100)
        expect(await rejection).toMatchObject({ code: 'TIMEOUT', phase: 'auth' })
        expect(authentications).toBe(2)
        expect(fetch.mock.calls.filter(([url]) => url !== tokenUrl)).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(20)
        expect(await transport.request('games', 'next')).toEqual([])
        expect(authentications).toBe(2)
        expect(vi.getTimerCount()).toBe(0)
    })

    it('bounds shared authentication independently even when custom fetch ignores its signal', async () => {
        vi.useFakeTimers()
        const fetch = vi
            .fn<typeof globalThis.fetch>()
            .mockImplementationOnce(() => new Promise(() => {}))
            .mockResolvedValueOnce(tokenResponse())
            .mockResolvedValueOnce(Response.json([]))
        const transport = createTransport({
            clientId: 'client',
            clientSecret: secret,
            fetch,
            timeoutMs: 50,
        })
        const request = transport.request('games', 'first', { timeoutMs: 1000 })
        const rejection = request.catch((cause: unknown) => cause)
        await vi.advanceTimersByTimeAsync(50)
        expect(await rejection).toMatchObject({ code: 'TIMEOUT', phase: 'auth' })
        expect(await transport.request('games', 'second')).toEqual([])
        expect(fetch).toHaveBeenCalledTimes(3)
        expect(vi.getTimerCount()).toBe(0)
    })

    it('includes reading the response body in the deadline', async () => {
        vi.useFakeTimers()
        const response = new Response('[]')
        vi.spyOn(response, 'json').mockImplementation(() => new Promise(() => {}))
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response)
        const transport = createTransport({
            clientId: 'client',
            accessToken: 'token',
            fetch,
            timeoutMs: 20,
        })
        const rejection = transport.request('games', 'fields id;').catch((cause: unknown) => cause)
        await vi.advanceTimersByTimeAsync(20)
        expect(await rejection).toMatchObject({ code: 'TIMEOUT', phase: 'request' })
        expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
        expect(vi.getTimerCount()).toBe(0)
    })

    it('does not make network calls for an already aborted request or expose its abort reason', async () => {
        const fetch = vi.fn<typeof globalThis.fetch>()
        const transport = createTransport({ clientId: 'client', clientSecret: secret, fetch })
        const controller = new AbortController()
        controller.abort(new Error(secret))
        const error = await transport
            .request('games', 'fields id;', { signal: controller.signal })
            .catch((cause: unknown) => cause)
        expect(error).toBeInstanceOf(IgdbError)
        expect(error).toMatchObject({ code: 'ABORTED', phase: 'auth' })
        expect(String(error) + JSON.stringify(error)).not.toContain(secret)
        expect(fetch).not.toHaveBeenCalled()
    })
})

describe('sanitized errors', () => {
    it.each([
        { code: 'NETWORK_ERROR', response: () => Promise.reject(new Error(secret)) },
        { code: 'INVALID_RESPONSE', response: async () => new Response(`{"${secret}"`) },
        {
            code: 'HTTP_ERROR',
            response: async () => new Response(secret, { status: 429, headers: { 'retry-after': '12' } }),
        },
    ])('redacts upstream details for $code without retrying', async ({ code, response }) => {
        const fetch = vi.fn<typeof globalThis.fetch>(response)
        const transport = createTransport({ clientId: 'client', accessToken: secret, fetch })
        const error = await transport.request('games', secret).catch((cause: unknown) => cause)
        expect(error).toBeInstanceOf(IgdbError)
        expect(error).toMatchObject({
            code,
            phase: 'request',
            ...(code === 'HTTP_ERROR' ? { status: 429, retryAfter: 12 } : {}),
        })
        expect(String(error) + JSON.stringify(error)).not.toContain(secret)
        expect(error).not.toHaveProperty('cause')
        expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('normalizes Retry-After HTTP dates without echoing arbitrary header content', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-10-21T00:00:00Z'))
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
            new Response(null, {
                status: 503,
                headers: { 'retry-after': 'Wed, 21 Oct 2026 00:00:10 GMT' },
            }),
        )
        const transport = createTransport({ clientId: 'client', accessToken: 'token', fetch })
        await expect(transport.request('games', 'fields id;')).rejects.toMatchObject({
            code: 'HTTP_ERROR',
            status: 503,
            retryAfter: 10,
        })
    })

    it('classifies malformed credential responses as authentication failures', async () => {
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
            Response.json({
                access_token: secret,
                expires_in: '3600',
            }),
        )
        const transport = createTransport({ clientId: 'client', clientSecret: secret, fetch })
        const error = await transport.request('games', 'fields id;').catch((cause: unknown) => cause)
        expect(error).toMatchObject({ code: 'INVALID_RESPONSE', phase: 'auth' })
        expect(String(error) + JSON.stringify(error)).not.toContain(secret)
        expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('rejects ambiguous authentication and unsafe endpoint paths before sending credentials', async () => {
        expect(() =>
            createTransport({
                clientId: 'client',
                clientSecret: secret,
                accessToken: secret,
            } as unknown as IgdbClientOptions),
        ).toThrow(TypeError)
        const fetch = vi.fn<typeof globalThis.fetch>()
        const transport = createTransport({ clientId: 'client', accessToken: 'token', fetch })
        await expect(transport.request('//example.com', '')).rejects.toThrow(TypeError)
        await expect(transport.request('games?redirect=example.com', '')).rejects.toThrow(TypeError)
        expect(fetch).not.toHaveBeenCalled()
    })
})
