import type { EmulatorExecutor, IgdbEmulator, QueryPlan } from './emulator-bridge.js'
import { IgdbError, type IgdbErrorPhase } from './errors.js'

const EMULATOR_TRANSPORT: symbol = /* @__PURE__ */ Symbol.for('@liry24/igdb/emulator-transport')
const MAX_MEMORY_CACHE_ENTRIES = 64

export interface IgdbToken {
    readonly accessToken: string
    /** Epoch milliseconds after which the token must not be reused. */
    readonly expiresAt: number
}

export interface IgdbTokenCache {
    get(key: string): IgdbToken | undefined | Promise<IgdbToken | undefined>
    set(key: string, token: IgdbToken): void | Promise<void>
    delete(key: string): void | Promise<void>
}

export type IgdbClientOptions = {
    /** Total time for one request, including authentication and the optional 401 retry. */
    timeoutMs?: number
} & (
    | {
          clientId: string
          accessToken: string
          clientSecret?: never
          tokenCache?: never
          dedupeAuth?: never
          fetch?: typeof globalThis.fetch
          emulator?: never
      }
    | {
          clientId: string
          clientSecret: string
          accessToken?: never
          tokenCache?: IgdbTokenCache
          dedupeAuth?: boolean
          fetch?: typeof globalThis.fetch
          emulator?: never
      }
    | {
          /**
           * In-memory IGDB emulator adapter from `@liry24/igdb/emulator`.
           * Skips Twitch OAuth and all network requests.
           */
          emulator: IgdbEmulator
          clientId?: never
          clientSecret?: never
          accessToken?: never
          tokenCache?: never
          dedupeAuth?: never
          fetch?: never
      }
)

export interface RequestOptions {
    signal?: AbortSignal
    timeoutMs?: number
}

/** @internal */
export interface Transport {
    request(endpoint: string, body: string, options?: RequestOptions, plan?: QueryPlan): Promise<unknown>
}

type Deadline = {
    signal: AbortSignal
    error(phase: IgdbErrorPhase): IgdbError
    dispose(): void
}

interface ResolvedToken {
    readonly token: IgdbToken
    readonly cacheKey?: string
}

/** Create a lightweight synchronous in-memory token cache safe to share across requests in workerd. */
export function createMemoryTokenCache(): IgdbTokenCache {
    const entries = new Map<string, IgdbToken>()
    return {
        get(key: string): IgdbToken | undefined {
            const token = entries.get(key)
            if (!token) return undefined
            if (token.expiresAt <= Date.now()) {
                entries.delete(key)
                return undefined
            }
            return { accessToken: token.accessToken, expiresAt: token.expiresAt }
        },
        set(key: string, token: IgdbToken): void {
            if (entries.has(key)) {
                entries.delete(key)
            } else if (entries.size >= MAX_MEMORY_CACHE_ENTRIES) {
                const oldestKey = entries.keys().next().value
                if (oldestKey !== undefined) entries.delete(oldestKey)
            }
            entries.set(key, { accessToken: token.accessToken, expiresAt: token.expiresAt })
        },
        delete(key: string): void {
            entries.delete(key)
        },
    }
}

function validateTimeout(value: number): number {
    if (!Number.isFinite(value) || value <= 0 || value > 2_147_483_647) {
        throw new TypeError('timeoutMs must be a positive number no greater than 2147483647.')
    }
    return value
}

function isTokenCache(value: unknown): value is IgdbTokenCache {
    if (typeof value !== 'object' || value === null) return false
    return (
        typeof Reflect.get(value, 'get') === 'function' &&
        typeof Reflect.get(value, 'set') === 'function' &&
        typeof Reflect.get(value, 'delete') === 'function'
    )
}

function isValidToken(value: unknown): value is IgdbToken {
    if (typeof value !== 'object' || value === null) return false
    const accessToken: unknown = Reflect.get(value, 'accessToken')
    const expiresAt: unknown = Reflect.get(value, 'expiresAt')
    return (
        typeof accessToken === 'string' &&
        accessToken.trim().length > 0 &&
        !/[\r\n]/.test(accessToken) &&
        typeof expiresAt === 'number' &&
        Number.isFinite(expiresAt) &&
        expiresAt > Date.now()
    )
}

function resolveEmulatorExecutor(value: unknown): EmulatorExecutor {
    if (typeof value !== 'object' || value === null) {
        throw new TypeError('emulator must be created with createIgdbEmulator().')
    }
    const executor: unknown = Reflect.get(value, EMULATOR_TRANSPORT)
    if (typeof executor !== 'function') {
        throw new TypeError('emulator must be created with createIgdbEmulator().')
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Only createIgdbEmulator() attaches this symbol-keyed executor.
    return executor as EmulatorExecutor
}

async function deriveTokenCacheKey(clientId: string, clientSecret: string): Promise<string> {
    const subtle = globalThis.crypto?.subtle
    if (!subtle) {
        throw new IgdbError('NETWORK_ERROR', 'auth')
    }
    const bytes = new TextEncoder().encode(`${clientId}\0${clientSecret}`)
    const digest = await subtle.digest('SHA-256', bytes)
    const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
    return `igdb:token:v1:${hex}`
}

function deadline(timeoutMs: number, external?: AbortSignal): Deadline {
    const controller = new AbortController()
    let timedOut = false
    const abort = () => controller.abort()
    if (external?.aborted) abort()
    else external?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => {
        if (!controller.signal.aborted) {
            timedOut = true
            controller.abort()
        }
    }, timeoutMs)
    return {
        signal: controller.signal,
        error: (phase) => new IgdbError(timedOut ? 'TIMEOUT' : 'ABORTED', phase),
        dispose() {
            clearTimeout(timer)
            external?.removeEventListener('abort', abort)
        },
    }
}

/** Also bounds custom fetch implementations that do not honor AbortSignal. */
function within<T>(promise: Promise<T>, budget: Deadline, phase: IgdbErrorPhase): Promise<T> {
    return new Promise((resolve, reject) => {
        const abort = () => {
            budget.signal.removeEventListener('abort', abort)
            reject(budget.error(phase))
        }
        budget.signal.addEventListener('abort', abort, { once: true })
        if (budget.signal.aborted) abort()
        promise.then(
            (value) => {
                budget.signal.removeEventListener('abort', abort)
                resolve(value)
            },
            (error: unknown) => {
                budget.signal.removeEventListener('abort', abort)
                reject(error)
            },
        )
    })
}

function retryAfter(response: Response): number | undefined {
    const value = response.headers.get('retry-after')?.trim()
    if (!value) return undefined
    if (/^\d+(?:\.\d+)?$/.test(value)) {
        const seconds = Number(value)
        return Number.isFinite(seconds) ? seconds : undefined
    }
    // Date.parse also accepts inputs such as "-1" that are not HTTP dates.
    if (!/[A-Za-z]/.test(value)) return undefined
    const date = Date.parse(value)
    return Number.isFinite(date) ? Math.max(0, (date - Date.now()) / 1000) : undefined
}

/** @internal */
export function createTransport(options: IgdbClientOptions): Transport {
    const defaultTimeout = validateTimeout(options.timeoutMs ?? 10_000)

    if ('emulator' in options && options.emulator !== undefined) {
        if (
            options.clientId !== undefined ||
            options.accessToken !== undefined ||
            options.clientSecret !== undefined ||
            options.tokenCache !== undefined ||
            options.dedupeAuth !== undefined ||
            options.fetch !== undefined
        ) {
            throw new TypeError('emulator cannot be combined with authentication, tokenCache, dedupeAuth, or fetch.')
        }
        const executor = resolveEmulatorExecutor(options.emulator)
        return {
            async request(endpoint, body, requestOptions, plan) {
                if (!/^[a-z][a-z0-9_]*$/.test(endpoint)) throw new TypeError('Invalid IGDB endpoint.')
                if (typeof body !== 'string') throw new TypeError('The query body must be a string.')
                if (!plan) throw new TypeError('Emulator requests require a structured query plan.')
                const budget = deadline(
                    validateTimeout(requestOptions?.timeoutMs ?? defaultTimeout),
                    requestOptions?.signal,
                )
                try {
                    if (budget.signal.aborted) throw budget.error('request')
                    return await within(executor(plan, body, requestOptions, budget.signal), budget, 'request')
                } finally {
                    budget.dispose()
                }
            },
        }
    }

    const { clientId, accessToken, clientSecret } = options
    if (typeof clientId !== 'string' || !clientId.trim() || /[\r\n]/.test(clientId)) {
        throw new TypeError('clientId must be a non-empty string without line breaks.')
    }
    if ((accessToken !== undefined) === (clientSecret !== undefined)) {
        throw new TypeError('Provide exactly one of accessToken or clientSecret.')
    }
    const credential = accessToken ?? clientSecret
    if (typeof credential !== 'string' || !credential.trim() || /[\r\n]/.test(credential)) {
        throw new TypeError('The authentication credential must be a non-empty string without line breaks.')
    }
    const rawTokenCache: unknown = Reflect.get(options, 'tokenCache')
    const rawDedupeAuth: unknown = Reflect.get(options, 'dedupeAuth')
    if (accessToken !== undefined && (rawTokenCache !== undefined || rawDedupeAuth !== undefined)) {
        throw new TypeError('tokenCache and dedupeAuth are only supported with clientSecret.')
    }
    if (rawTokenCache !== undefined && !isTokenCache(rawTokenCache)) {
        throw new TypeError('tokenCache must implement get(), set(), and delete().')
    }
    if (rawDedupeAuth !== undefined && typeof rawDedupeAuth !== 'boolean') {
        throw new TypeError('dedupeAuth must be a boolean.')
    }
    const tokenCache = rawTokenCache
    const dedupeAuth = rawDedupeAuth ?? tokenCache === undefined
    const configuredFetch = options.fetch
    let cached: IgdbToken | undefined
    let pending: Promise<IgdbToken> | undefined
    let pendingCached: Promise<{ readonly token: IgdbToken; readonly cacheKey: string }> | undefined
    let derivedCacheKey: string | undefined
    let pendingCacheKey: Promise<string> | undefined

    async function json(url: string, init: RequestInit, phase: IgdbErrorPhase, budget: Deadline): Promise<unknown> {
        if (budget.signal.aborted) throw budget.error(phase)
        let response: Response
        try {
            response = await within(
                (configuredFetch ?? globalThis.fetch)(url, {
                    ...init,
                    redirect: 'manual',
                    signal: budget.signal,
                }),
                budget,
                phase,
            )
        } catch {
            if (budget.signal.aborted) throw budget.error(phase)
            throw new IgdbError('NETWORK_ERROR', phase)
        }
        if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
            void response.body?.cancel().catch(() => {})
            throw new IgdbError('NETWORK_ERROR', phase)
        }
        if (!response.ok) {
            // An upstream error body can echo submitted credentials or query text.
            // Discard it instead of exposing or parsing it in a public error.
            void response.body?.cancel().catch(() => {})
            const seconds = retryAfter(response)
            throw new IgdbError('HTTP_ERROR', phase, {
                status: response.status,
                ...(seconds === undefined ? {} : { retryAfter: seconds }),
            })
        }
        try {
            return await within(response.json(), budget, phase)
        } catch {
            if (budget.signal.aborted) throw budget.error(phase)
            throw new IgdbError('INVALID_RESPONSE', phase)
        }
    }

    async function resolveCacheKey(budget: Deadline): Promise<string> {
        if (derivedCacheKey !== undefined) return derivedCacheKey
        if (!dedupeAuth) {
            const key = await within(deriveTokenCacheKey(clientId, clientSecret!), budget, 'auth')
            derivedCacheKey = key
            return key
        }
        if (!pendingCacheKey) {
            const operation = deriveTokenCacheKey(clientId, clientSecret!)
            pendingCacheKey = operation
            void operation.then(
                (key) => {
                    derivedCacheKey = key
                    if (pendingCacheKey === operation) pendingCacheKey = undefined
                },
                () => {
                    if (pendingCacheKey === operation) pendingCacheKey = undefined
                },
            )
        }
        return await within(pendingCacheKey, budget, 'auth')
    }

    async function acquireWithBudget(budget: Deadline): Promise<IgdbToken> {
        const data = await json(
            'https://id.twitch.tv/oauth2/token',
            {
                method: 'POST',
                body: new URLSearchParams({
                    client_id: clientId,
                    client_secret: clientSecret!,
                    grant_type: 'client_credentials',
                }),
            },
            'auth',
            budget,
        )
        if (
            typeof data !== 'object' ||
            data === null ||
            !('access_token' in data) ||
            typeof data.access_token !== 'string' ||
            !data.access_token.trim() ||
            /[\r\n]/.test(data.access_token) ||
            !('expires_in' in data) ||
            typeof data.expires_in !== 'number' ||
            !Number.isFinite(data.expires_in * 1000) ||
            data.expires_in <= 0
        ) {
            throw new IgdbError('INVALID_RESPONSE', 'auth')
        }
        const lifetime = data.expires_in * 1000
        return {
            accessToken: data.access_token,
            expiresAt: Date.now() + lifetime - Math.min(60_000, lifetime / 10),
        }
    }

    async function acquireShared(): Promise<IgdbToken> {
        // A caller's cancellation must not cancel shared authentication needed by other callers.
        const budget = deadline(defaultTimeout)
        try {
            return await acquireWithBudget(budget)
        } finally {
            budget.dispose()
        }
    }

    async function runSharedWithCache(
        evictAccessToken?: string,
    ): Promise<{ readonly token: IgdbToken; readonly cacheKey: string }> {
        // Keep key derivation, cache read, OAuth fetch, and cache save under one shared budget
        // so concurrent callers never race or let an older save overwrite a newer token.
        const budget = deadline(defaultTimeout)
        try {
            const cacheKey = await resolveCacheKey(budget)
            const existing = await within(Promise.resolve(tokenCache!.get(cacheKey)), budget, 'auth')
            if (isValidToken(existing)) {
                if (evictAccessToken === undefined || existing.accessToken !== evictAccessToken) {
                    return {
                        token: { accessToken: existing.accessToken, expiresAt: existing.expiresAt },
                        cacheKey,
                    }
                }
                await within(Promise.resolve(tokenCache!.delete(cacheKey)), budget, 'auth')
            } else if (evictAccessToken !== undefined) {
                await within(Promise.resolve(tokenCache!.delete(cacheKey)), budget, 'auth')
            }
            const token = await acquireWithBudget(budget)
            await within(Promise.resolve(tokenCache!.set(cacheKey, token)), budget, 'auth')
            return { token, cacheKey }
        } finally {
            budget.dispose()
        }
    }

    function startSharedWithCache(
        evictAccessToken?: string,
    ): Promise<{ readonly token: IgdbToken; readonly cacheKey: string }> {
        const operation = runSharedWithCache(evictAccessToken)
        pendingCached = operation
        const clear = () => {
            if (pendingCached === operation) pendingCached = undefined
        }
        void operation.then(clear, clear)
        return operation
    }

    async function getToken(requestBudget: Deadline, staleAccessToken?: string): Promise<ResolvedToken> {
        if (accessToken !== undefined) {
            return { token: { accessToken, expiresAt: Infinity } }
        }
        if (tokenCache !== undefined) {
            if (!dedupeAuth) {
                const cacheKey = await resolveCacheKey(requestBudget)
                const existing = await within(Promise.resolve(tokenCache.get(cacheKey)), requestBudget, 'auth')
                if (isValidToken(existing)) {
                    if (staleAccessToken === undefined || existing.accessToken !== staleAccessToken) {
                        return {
                            token: { accessToken: existing.accessToken, expiresAt: existing.expiresAt },
                            cacheKey,
                        }
                    }
                    await within(Promise.resolve(tokenCache.delete(cacheKey)), requestBudget, 'auth')
                } else if (staleAccessToken !== undefined) {
                    await within(Promise.resolve(tokenCache.delete(cacheKey)), requestBudget, 'auth')
                }
                const token = await acquireWithBudget(requestBudget)
                await within(Promise.resolve(tokenCache.set(cacheKey, token)), requestBudget, 'auth')
                return { token, cacheKey }
            }

            if (pendingCached) {
                const resolved = await within(pendingCached, requestBudget, 'auth')
                if (staleAccessToken === undefined || resolved.token.accessToken !== staleAccessToken) {
                    return resolved
                }
                // The in-flight read returned the same stale token; fall through to start or join a refresh.
            }
            const operation = pendingCached ?? startSharedWithCache(staleAccessToken)
            return await within(operation, requestBudget, 'auth')
        }

        if (cached && cached.expiresAt > Date.now()) {
            return { token: cached }
        }
        if (!dedupeAuth) {
            const token = await acquireWithBudget(requestBudget)
            cached = token
            return { token }
        }
        if (!pending) {
            const operation = acquireShared()
            pending = operation
            void operation.then(
                (token) => {
                    cached = token
                    if (pending === operation) pending = undefined
                },
                () => {
                    if (pending === operation) pending = undefined
                },
            )
        }
        return { token: await within(pending, requestBudget, 'auth') }
    }

    return {
        async request(endpoint, body, requestOptions = {}) {
            if (!/^[a-z][a-z0-9_]*$/.test(endpoint)) throw new TypeError('Invalid IGDB endpoint.')
            if (typeof body !== 'string') throw new TypeError('The query body must be a string.')
            const budget = deadline(validateTimeout(requestOptions.timeoutMs ?? defaultTimeout), requestOptions.signal)
            try {
                let staleAccessToken: string | undefined
                for (let attempt = 0; ; attempt++) {
                    const phase = clientSecret === undefined ? 'request' : 'auth'
                    if (budget.signal.aborted) throw budget.error(phase)
                    const { token } = await getToken(budget, staleAccessToken)
                    try {
                        return await json(
                            `https://api.igdb.com/v4/${endpoint}`,
                            {
                                method: 'POST',
                                headers: {
                                    'Client-ID': clientId,
                                    Authorization: `Bearer ${token.accessToken}`,
                                    'Content-Type': 'text/plain',
                                },
                                body,
                            },
                            'request',
                            budget,
                        )
                    } catch (error) {
                        if (
                            clientSecret !== undefined &&
                            error instanceof IgdbError &&
                            error.code === 'HTTP_ERROR' &&
                            error.status === 401
                        ) {
                            if (tokenCache !== undefined) {
                                if (attempt === 0) {
                                    staleAccessToken = token.accessToken
                                    continue
                                }
                                // Final 401 after retry: evict only if no shared refresh is in flight and cache still holds this token.
                                if (!dedupeAuth || !pendingCached) {
                                    const cacheKey = await resolveCacheKey(budget)
                                    const current = await within(
                                        Promise.resolve(tokenCache.get(cacheKey)),
                                        budget,
                                        'auth',
                                    )
                                    if (!isValidToken(current) || current.accessToken === token.accessToken) {
                                        await within(Promise.resolve(tokenCache.delete(cacheKey)), budget, 'auth')
                                    }
                                }
                            } else {
                                if (cached === token) {
                                    // An older in-flight request must not evict a more recently acquired token.
                                    cached = undefined
                                }
                                if (attempt === 0) continue
                            }
                        }
                        throw error
                    }
                }
            } finally {
                budget.dispose()
            }
        },
    }
}
