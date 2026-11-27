import type { EmulatorExecutor, IgdbEmulator, OrderAst, PredicateAst, QueryPlan, Scalar } from './emulator-bridge.js'
import type { Cover, Endpoint, EndpointMap, Game, Platform } from './schema.js'
import type { RequestOptions } from './transport.js'

export type { IgdbEmulator } from './emulator-bridge.js'

const EMULATOR_TRANSPORT: symbol = /* @__PURE__ */ Symbol.for('@liry24/igdb/emulator-transport')

export type EmulatorDataset = Partial<{
    [E in Endpoint]: readonly EndpointMap[E][]
}>

export interface IgdbEmulatorQueryContext {
    readonly endpoint: Endpoint
    readonly query: string
    readonly options?: RequestOptions
}

export interface IgdbEmulatorOptions {
    /**
     * Custom records keyed by endpoint name.
     * Example: { games: [{ id: 1, slug: 'my-game', name: 'My Game' }] }
     */
    data?: EmulatorDataset
    /**
     * How `data` interacts with built-in fixtures.
     * - 'merge' (default): starts from built-in fixtures and merges/overrides records by `id`.
     * - 'replace': uses only `data` (empty if omitted).
     */
    mode?: 'merge' | 'replace'
    /**
     * Additional search aliases keyed by game ID (e.g. { 191692: ['sf6'] }).
     * Merged with built-in aliases in 'merge' mode.
     */
    aliases?: Readonly<Record<number, readonly string[]>>
    /** Optional artificial latency in milliseconds to simulate network round-trip. */
    delayMs?: number
    /**
     * Optional interceptor invoked before resolving each query.
     * Throw an IgdbError here to simulate 429 / 502 / 503 / network failures.
     */
    onQuery?: (context: IgdbEmulatorQueryContext) => void | Promise<void>
}

type EntityRecord = Record<string, unknown>
type TableIndex = ReadonlyMap<number, EntityRecord>

interface CompiledPathStep {
    readonly segment: string
    readonly targetIndex: TableIndex | undefined
}

interface CompiledPath {
    readonly singleSegment: string | undefined
    readonly steps: readonly CompiledPathStep[]
}

interface ProjectionNode {
    wildcard: boolean
    readonly endpoint: string | undefined
    readonly targetIndex: TableIndex | undefined
    readonly children: Map<string, ProjectionNode>
}

function isRecord(value: unknown): value is EntityRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function deepClone<T>(value: T): T {
    if (Array.isArray(value)) {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Recursive clone preserves array element types.
        return value.map((item: unknown) => deepClone(item)) as unknown as T
    }
    if (isRecord(value)) {
        const copy: EntityRecord = {}
        for (const [key, entry] of Object.entries(value)) {
            if (entry !== undefined) copy[key] = deepClone(entry)
        }
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Recursive clone preserves object shape.
        return copy as unknown as T
    }
    return value
}

function deepFreeze<T>(value: T): T {
    if (Array.isArray(value)) {
        for (const item of value) deepFreeze(item)
        return Object.freeze(value)
    }
    if (isRecord(value)) {
        for (const entry of Object.values(value)) deepFreeze(entry)
        return Object.freeze(value)
    }
    return value
}

const builtInCovers: readonly Cover[] = [
    { id: 1001, game: 126459, image_id: 'co2mvt', width: 600, height: 800 },
    { id: 1002, game: 114795, image_id: 'co1wzo', width: 600, height: 800 },
    { id: 1003, game: 191692, image_id: 'co5vmg', width: 600, height: 800 },
    { id: 1004, game: 115, image_id: 'co49wj', width: 600, height: 800 },
    { id: 1005, game: 125174, image_id: 'co530b', width: 600, height: 800 },
    { id: 1006, game: 242408, image_id: 'co670h', width: 600, height: 800 },
    { id: 1007, game: 119133, image_id: 'co4jni', width: 600, height: 800 },
    { id: 1008, game: 279661, image_id: 'co904o', width: 600, height: 800 },
    { id: 1009, game: 143613, image_id: 'co4s11', width: 600, height: 800 },
    { id: 1010, game: 121, image_id: 'co8fu7', width: 600, height: 800 },
    { id: 1011, game: 386, image_id: 'co670k', width: 600, height: 800 },
    { id: 1012, game: 115289, image_id: 'co3p2d', width: 600, height: 800 },
    { id: 1013, game: 217590, image_id: 'co7lbb', width: 600, height: 800 },
]

const builtInPlatforms: readonly Platform[] = [
    { id: 6, slug: 'win', name: 'PC (Microsoft Windows)', abbreviation: 'PC' },
    { id: 48, slug: 'ps4--1', name: 'PlayStation 4', abbreviation: 'PS4' },
    { id: 130, slug: 'switch', name: 'Nintendo Switch', abbreviation: 'Switch' },
    { id: 167, slug: 'ps5', name: 'PlayStation 5', abbreviation: 'PS5' },
    { id: 169, slug: 'series-x-s', name: 'Xbox Series X|S', abbreviation: 'Series X|S' },
]

const builtInGames: readonly Game[] = [
    { id: 126459, slug: 'valorant', name: 'VALORANT', cover: 1001, platforms: [6, 167, 169], rating: 78 },
    {
        id: 114795,
        slug: 'apex-legends',
        name: 'Apex Legends',
        cover: 1002,
        platforms: [6, 48, 130, 167, 169],
        rating: 81,
    },
    {
        id: 191692,
        slug: 'street-fighter-6',
        name: 'Street Fighter 6',
        cover: 1003,
        platforms: [6, 48, 167, 169],
        rating: 89,
    },
    { id: 115, slug: 'league-of-legends', name: 'League of Legends', cover: 1004, platforms: [6], rating: 80 },
    {
        id: 125174,
        slug: 'overwatch-2',
        name: 'Overwatch 2',
        cover: 1005,
        platforms: [6, 48, 130, 167, 169],
        rating: 72,
    },
    { id: 242408, slug: 'counter-strike-2', name: 'Counter-Strike 2', cover: 1006, platforms: [6], rating: 82 },
    { id: 119133, slug: 'elden-ring', name: 'Elden Ring', cover: 1007, platforms: [6, 48, 167, 169], rating: 95 },
    {
        id: 279661,
        slug: 'monster-hunter-wilds',
        name: 'Monster Hunter Wilds',
        cover: 1008,
        platforms: [6, 167, 169],
        rating: 87,
    },
    { id: 143613, slug: 'splatoon-3', name: 'Splatoon 3', cover: 1009, platforms: [130], rating: 84 },
    { id: 121, slug: 'minecraft', name: 'Minecraft', cover: 1010, platforms: [6, 48, 130, 167, 169], rating: 91 },
    { id: 27789, slug: 'vrchat', name: 'VRChat', platforms: [6], rating: 76 },
    {
        id: 386,
        slug: 'final-fantasy-xiv-online',
        name: 'Final Fantasy XIV Online',
        cover: 1011,
        platforms: [6, 48, 167, 169],
        rating: 88,
    },
    {
        id: 115289,
        slug: 'hollow-knight-silksong',
        name: 'Hollow Knight: Silksong',
        cover: 1012,
        platforms: [6, 130, 167, 169],
        rating: 92,
    },
    { id: 217590, slug: 'tekken-8', name: 'Tekken 8', cover: 1013, platforms: [6, 167, 169], rating: 88 },
    { id: 228530, slug: 'hades-ii', name: 'Hades II', platforms: [6], rating: 93 },
]

export const defaultEmulatorDataset: Readonly<EmulatorDataset> = /* @__PURE__ */ deepFreeze({
    games: builtInGames,
    covers: builtInCovers,
    platforms: builtInPlatforms,
})

export const defaultEmulatorAliases: Readonly<Record<number, readonly string[]>> = /* @__PURE__ */ deepFreeze({
    126459: ['val'],
    114795: ['apex'],
    191692: ['sf6'],
    115: ['lol'],
    125174: ['ow2'],
    242408: ['cs2'],
    119133: [],
    279661: ['mhw', 'mh wilds'],
    143613: ['spla3'],
    121: ['mc'],
    27789: ['vrc'],
    386: ['ff14', 'ffxiv'],
    115289: ['silksong'],
    217590: [],
    228530: ['hades 2'],
})

const FIELD_RELATION_TARGETS: Readonly<Record<string, Endpoint>> = {
    age_ratings: 'age_ratings',
    alternative_names: 'alternative_names',
    artwork_type: 'artwork_types',
    artworks: 'artworks',
    bundles: 'games',
    character: 'characters',
    character_gender: 'character_genders',
    character_species: 'character_species',
    collection: 'collections',
    collections: 'collections',
    company: 'companies',
    company_logo: 'company_logos',
    company_size: 'company_sizes',
    company_status: 'company_statuses',
    company_type: 'company_types',
    content_descriptions: 'age_rating_content_descriptions',
    cover: 'covers',
    date_format: 'date_formats',
    developed: 'games',
    dlcs: 'games',
    event_logo: 'event_logos',
    event_networks: 'event_networks',
    expanded_games: 'games',
    expansions: 'games',
    external_game_source: 'external_game_sources',
    external_games: 'external_games',
    forks: 'games',
    franchise: 'franchises',
    franchises: 'franchises',
    game: 'games',
    game_engine: 'game_engines',
    game_engines: 'game_engines',
    game_localizations: 'game_localizations',
    game_modes: 'game_modes',
    game_status: 'game_statuses',
    game_type: 'game_types',
    games: 'games',
    genres: 'genres',
    image_type: 'image_types',
    involved_companies: 'involved_companies',
    keywords: 'keywords',
    language: 'languages',
    language_support_type: 'language_support_types',
    language_supports: 'language_supports',
    logo: 'logos',
    mug_shot: 'character_mug_shots',
    multiplayer_modes: 'multiplayer_modes',
    network_type: 'network_types',
    organization: 'age_rating_organizations',
    parent: 'companies',
    parent_game: 'games',
    platform: 'platforms',
    platform_family: 'platform_families',
    platform_logo: 'platform_logos',
    platform_type: 'platform_types',
    platform_version: 'platform_versions',
    platforms: 'platforms',
    player_perspectives: 'player_perspectives',
    ports: 'games',
    published: 'games',
    rating_category: 'age_rating_categories',
    rating_content_descriptions: 'age_rating_content_descriptions_v2',
    region: 'regions',
    release_date_region: 'release_date_regions',
    release_dates: 'release_dates',
    remakes: 'games',
    remasters: 'games',
    screenshots: 'screenshots',
    similar_games: 'games',
    standalone_expansions: 'games',
    status: 'release_date_statuses',
    theme: 'themes',
    themes: 'themes',
    version_parent: 'games',
    versions: 'platform_versions',
    videos: 'game_videos',
    websites: 'websites',
}

const CONTEXT_RELATION_TARGETS: Readonly<Record<string, Readonly<Record<string, Endpoint>>>> = {
    companies: { logo: 'company_logos', status: 'company_statuses' },
    company_websites: { type: 'website_types' },
    events: { event_logo: 'event_logos', games: 'games' },
    game_engines: { companies: 'companies', logo: 'game_engine_logos', platforms: 'platforms' },
    platform_websites: { type: 'website_types' },
    reports: { type: 'report_types' },
    websites: { type: 'website_types' },
}

function resolveRelationEndpoint(
    currentEndpoint: string,
    field: string,
    tables: ReadonlyMap<string, readonly EntityRecord[]>,
): string | undefined {
    const contextual = CONTEXT_RELATION_TARGETS[currentEndpoint]?.[field]
    if (contextual) return contextual
    const direct = FIELD_RELATION_TARGETS[field]
    if (direct) return direct
    if (tables.has(field)) return field
    if (tables.has(`${field}s`)) return `${field}s`
    if (field.endsWith('y') && tables.has(`${field.slice(0, -1)}ies`)) return `${field.slice(0, -1)}ies`
    return undefined
}

function buildTables(
    data: EmulatorDataset | undefined,
    mode: 'merge' | 'replace',
): {
    tables: Map<string, readonly EntityRecord[]>
    indexes: Map<string, TableIndex>
} {
    const indexes = new Map<string, Map<number, EntityRecord>>()

    const ingest = (source: EmulatorDataset | undefined, cloneRecords: boolean): void => {
        if (!source) return
        for (const [endpoint, records] of Object.entries(source)) {
            if (!Array.isArray(records)) continue
            let byId = indexes.get(endpoint)
            if (!byId) {
                byId = new Map()
                indexes.set(endpoint, byId)
            }
            for (const raw of records) {
                if (!isRecord(raw) || typeof raw.id !== 'number') continue
                // Map preserves first-seen key order while overwriting duplicate IDs in O(1).
                byId.set(raw.id, cloneRecords ? deepClone(raw) : raw)
            }
        }
    }

    if (mode === 'merge') ingest(defaultEmulatorDataset, false)
    ingest(data, true)

    const tables = new Map<string, readonly EntityRecord[]>()
    for (const [endpoint, byId] of indexes) {
        tables.set(endpoint, [...byId.values()])
    }
    return { tables, indexes }
}

function buildAliases(
    custom: Readonly<Record<number, readonly string[]>> | undefined,
    mode: 'merge' | 'replace',
): Map<number, readonly string[]> {
    const sets = new Map<number, Set<string>>()
    const add = (source: Readonly<Record<number, readonly string[]>> | undefined): void => {
        if (!source) return
        for (const [rawId, list] of Object.entries(source)) {
            const id = Number(rawId)
            if (!Number.isSafeInteger(id) || !Array.isArray(list)) continue
            let current = sets.get(id)
            if (!current) {
                current = new Set()
                sets.set(id, current)
            }
            for (const alias of list) {
                if (typeof alias === 'string') current.add(alias)
            }
        }
    }
    if (mode === 'merge') add(defaultEmulatorAliases)
    add(custom)

    const map = new Map<number, readonly string[]>()
    for (const [id, set] of sets) {
        if (set.size > 0) map.set(id, [...set])
    }
    return map
}

function compilePath(
    endpoint: string,
    path: string,
    tables: ReadonlyMap<string, readonly EntityRecord[]>,
    indexes: ReadonlyMap<string, TableIndex>,
): CompiledPath {
    if (!path.includes('.')) {
        return { singleSegment: path, steps: [] }
    }
    const segments = path.split('.')
    const steps: CompiledPathStep[] = []
    let currentEndpoint: string | undefined = endpoint
    for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index]!
        const isLast = index === segments.length - 1
        let targetIndex: TableIndex | undefined
        if (!isLast && currentEndpoint !== undefined) {
            const nextEndpoint = resolveRelationEndpoint(currentEndpoint, segment, tables)
            targetIndex = nextEndpoint !== undefined ? indexes.get(nextEndpoint) : undefined
            currentEndpoint = nextEndpoint
        } else {
            currentEndpoint = undefined
        }
        steps.push({ segment, targetIndex })
    }
    return { singleSegment: undefined, steps }
}

function resolveCompiledPathValues(record: EntityRecord, path: CompiledPath): unknown[] {
    if (path.singleSegment !== undefined) {
        const raw: unknown = record[path.singleSegment]
        return raw === undefined ? [] : [raw]
    }
    const { steps } = path
    const lastIndex = steps.length - 1
    let currentValues: unknown[] = [record]

    for (let index = 0; index <= lastIndex; index += 1) {
        const step = steps[index]!
        const isLast = index === lastIndex
        const nextValues: unknown[] = []

        for (const item of currentValues) {
            if (!isRecord(item)) continue
            const raw: unknown = item[step.segment]
            if (isLast) {
                if (raw !== undefined) nextValues.push(raw)
                continue
            }
            if (Array.isArray(raw)) {
                for (const element of raw) {
                    if (isRecord(element)) nextValues.push(element)
                    else if (typeof element === 'number') {
                        const resolved = step.targetIndex?.get(element)
                        if (resolved) nextValues.push(resolved)
                    }
                }
            } else if (isRecord(raw)) {
                nextValues.push(raw)
            } else if (typeof raw === 'number') {
                const resolved = step.targetIndex?.get(raw)
                if (resolved) nextValues.push(resolved)
            }
        }
        if (nextValues.length === 0) return nextValues
        currentValues = nextValues
    }
    return currentValues
}

function resolveLeaves(record: EntityRecord, path: CompiledPath): unknown[] {
    if (path.singleSegment !== undefined) {
        const raw: unknown = record[path.singleSegment]
        if (raw === undefined) return []
        return Array.isArray(raw) ? raw : [raw]
    }
    const values = resolveCompiledPathValues(record, path)
    const out: unknown[] = []
    for (const value of values) {
        if (Array.isArray(value)) {
            for (const element of value) out.push(element)
        } else {
            out.push(value)
        }
    }
    return out
}

function normalizeLeaf(value: unknown, allowNumericEntityId: boolean): unknown {
    if (allowNumericEntityId && isRecord(value) && typeof value.id === 'number') {
        return value.id
    }
    return value
}

function isScalar(value: unknown): value is Scalar {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function compilePredicate(
    endpoint: string,
    ast: PredicateAst,
    tables: ReadonlyMap<string, readonly EntityRecord[]>,
    indexes: ReadonlyMap<string, TableIndex>,
): (record: EntityRecord) => boolean {
    switch (ast.kind) {
        case 'const': {
            const result = ast.value
            return () => result
        }
        case 'and': {
            const children = ast.children.map((child) => compilePredicate(endpoint, child, tables, indexes))
            return (record) => {
                for (const fn of children) {
                    if (!fn(record)) return false
                }
                return true
            }
        }
        case 'or': {
            const children = ast.children.map((child) => compilePredicate(endpoint, child, tables, indexes))
            return (record) => {
                for (const fn of children) {
                    if (fn(record)) return true
                }
                return false
            }
        }
        case 'isNull': {
            const path = compilePath(endpoint, ast.path, tables, indexes)
            if (path.singleSegment !== undefined) {
                const segment = path.singleSegment
                return (record) => {
                    const value: unknown = record[segment]
                    return value === undefined || value === null
                }
            }
            return (record) => {
                const values = resolveCompiledPathValues(record, path)
                return values.every((value) => value === undefined || value === null)
            }
        }
        case 'isNotNull': {
            const path = compilePath(endpoint, ast.path, tables, indexes)
            if (path.singleSegment !== undefined) {
                const segment = path.singleSegment
                return (record) => {
                    const value: unknown = record[segment]
                    return value !== undefined && value !== null
                }
            }
            return (record) => {
                const values = resolveCompiledPathValues(record, path)
                return values.some((value) => value !== undefined && value !== null)
            }
        }
        case 'compare': {
            const path = compilePath(endpoint, ast.path, tables, indexes)
            const target = ast.value
            const allowNumericId = typeof target === 'number'
            switch (ast.op) {
                case '=':
                    return (record) =>
                        resolveLeaves(record, path).some((value) => normalizeLeaf(value, allowNumericId) === target)
                case '!=':
                    return (record) => {
                        const leaves = resolveLeaves(record, path)
                        return (
                            leaves.length > 0 &&
                            leaves.every(
                                (value) =>
                                    value !== undefined &&
                                    value !== null &&
                                    normalizeLeaf(value, allowNumericId) !== target,
                            )
                        )
                    }
                case '>': {
                    if (typeof target !== 'number') return () => false
                    return (record) =>
                        resolveLeaves(record, path).some((value) => {
                            const normalized = normalizeLeaf(value, true)
                            return typeof normalized === 'number' && normalized > target
                        })
                }
                case '>=': {
                    if (typeof target !== 'number') return () => false
                    return (record) =>
                        resolveLeaves(record, path).some((value) => {
                            const normalized = normalizeLeaf(value, true)
                            return typeof normalized === 'number' && normalized >= target
                        })
                }
                case '<': {
                    if (typeof target !== 'number') return () => false
                    return (record) =>
                        resolveLeaves(record, path).some((value) => {
                            const normalized = normalizeLeaf(value, true)
                            return typeof normalized === 'number' && normalized < target
                        })
                }
                case '<=': {
                    if (typeof target !== 'number') return () => false
                    return (record) =>
                        resolveLeaves(record, path).some((value) => {
                            const normalized = normalizeLeaf(value, true)
                            return typeof normalized === 'number' && normalized <= target
                        })
                }
                default:
                    return () => false
            }
        }
        case 'in': {
            const path = compilePath(endpoint, ast.path, tables, indexes)
            const targetSet = new Set<Scalar>(ast.values)
            const hasNumericTarget = ast.values.some((value) => typeof value === 'number')
            return (record) =>
                resolveLeaves(record, path).some((value) => {
                    const normalized = normalizeLeaf(value, hasNumericTarget)
                    return isScalar(normalized) && targetSet.has(normalized)
                })
        }
        case 'notIn': {
            const path = compilePath(endpoint, ast.path, tables, indexes)
            const targetSet = new Set<Scalar>(ast.values)
            const hasNumericTarget = ast.values.some((value) => typeof value === 'number')
            return (record) => {
                const leaves = resolveLeaves(record, path)
                return (
                    leaves.length > 0 &&
                    leaves.every((value) => {
                        if (value === undefined || value === null) return false
                        const normalized = normalizeLeaf(value, hasNumericTarget)
                        return !isScalar(normalized) || !targetSet.has(normalized)
                    })
                )
            }
        }
        case 'arrayContains': {
            const path = compilePath(endpoint, ast.path, tables, indexes)
            const targetSet = new Set<Scalar>(ast.values)
            const requiredCount = targetSet.size
            const hasNumericTarget = ast.values.some((value) => typeof value === 'number')
            if (requiredCount === 1) {
                const single = ast.values[0]!
                return (record) =>
                    resolveLeaves(record, path).some((value) => normalizeLeaf(value, hasNumericTarget) === single)
            }
            return (record) => {
                const leaves = resolveLeaves(record, path)
                if (leaves.length < requiredCount) return false
                const matched = new Set<Scalar>()
                for (const value of leaves) {
                    const normalized = normalizeLeaf(value, hasNumericTarget)
                    if (isScalar(normalized) && targetSet.has(normalized)) {
                        matched.add(normalized)
                        if (matched.size === requiredCount) return true
                    }
                }
                return false
            }
        }
        case 'arrayOverlaps': {
            const path = compilePath(endpoint, ast.path, tables, indexes)
            const targetSet = new Set<Scalar>(ast.values)
            const hasNumericTarget = ast.values.some((value) => typeof value === 'number')
            return (record) =>
                resolveLeaves(record, path).some((value) => {
                    const normalized = normalizeLeaf(value, hasNumericTarget)
                    return isScalar(normalized) && targetSet.has(normalized)
                })
        }
        default:
            return () => false
    }
}

function searchScore(candidate: string, needle: string): number {
    const normalized = candidate.trim().toLowerCase()
    if (normalized.length === 0) return Number.POSITIVE_INFINITY
    if (normalized === needle) return 0
    if (normalized.startsWith(needle)) return 1
    let from = 0
    let hasSubstring = false
    for (;;) {
        const index = normalized.indexOf(needle, from)
        if (index === -1) break
        hasSubstring = true
        if (index > 0 && /[\s\-_:/.,]/.test(normalized[index - 1]!)) {
            return 2
        }
        from = index + 1
    }
    return hasSubstring ? 3 : Number.POSITIVE_INFINITY
}

function filterAndRankBySearch(
    rows: readonly EntityRecord[],
    searchText: string,
    aliases: ReadonlyMap<number, readonly string[]>,
): EntityRecord[] {
    const needle = searchText.trim().toLowerCase()
    if (needle.length === 0) return []
    const ranked: { record: EntityRecord; score: number; id: number }[] = []
    for (const record of rows) {
        let best = Number.POSITIVE_INFINITY
        if (typeof record.name === 'string') {
            const score = searchScore(record.name, needle)
            if (score < best) best = score
        }
        if (best > 0 && typeof record.slug === 'string') {
            const score = searchScore(record.slug, needle)
            if (score < best) best = score
        }
        if (best > 0 && typeof record.alternative_name === 'string') {
            const score = searchScore(record.alternative_name, needle)
            if (score < best) best = score
        }
        const id = typeof record.id === 'number' ? record.id : 0
        if (best > 0) {
            const recordAliases = aliases.get(id)
            if (recordAliases) {
                for (const alias of recordAliases) {
                    const score = searchScore(alias, needle)
                    if (score < best) {
                        best = score
                        if (best === 0) break
                    }
                }
            }
        }
        if (Number.isFinite(best)) {
            ranked.push({ record, score: best, id })
        }
    }
    ranked.sort((a, b) => (a.score !== b.score ? a.score - b.score : a.id - b.id))
    return ranked.map((entry) => entry.record)
}

function extractSortKey(record: EntityRecord, path: CompiledPath, direction: 'asc' | 'desc'): Scalar | undefined {
    const leaves = resolveLeaves(record, path)
    let firstScalar: Scalar | undefined
    let numericBest: number | undefined
    let allNumbers = true
    let count = 0

    for (const value of leaves) {
        if (typeof value === 'number') {
            if (!Number.isFinite(value)) continue
            count += 1
            if (firstScalar === undefined) firstScalar = value
            if (numericBest === undefined) {
                numericBest = value
            } else if (direction === 'asc' ? value < numericBest : value > numericBest) {
                numericBest = value
            }
        } else if (typeof value === 'string' || typeof value === 'boolean') {
            count += 1
            allNumbers = false
            if (firstScalar === undefined) firstScalar = value
        }
    }
    if (count === 0) return undefined
    if (allNumbers && numericBest !== undefined) return numericBest
    return firstScalar
}

function sortRows(
    rows: readonly EntityRecord[],
    endpoint: string,
    order: OrderAst,
    tables: ReadonlyMap<string, readonly EntityRecord[]>,
    indexes: ReadonlyMap<string, TableIndex>,
): EntityRecord[] {
    const compiledPath = compilePath(endpoint, order.path, tables, indexes)
    const factor = order.direction === 'asc' ? 1 : -1
    const decorated = rows.map((record) => ({
        record,
        key: extractSortKey(record, compiledPath, order.direction),
    }))
    decorated.sort((a, b) => {
        if (a.key === undefined && b.key === undefined) return 0
        if (a.key === undefined) return 1
        if (b.key === undefined) return -1
        if (typeof a.key === 'number' && typeof b.key === 'number') {
            return (a.key - b.key) * factor
        }
        if (typeof a.key === 'boolean' && typeof b.key === 'boolean') {
            return (Number(a.key) - Number(b.key)) * factor
        }
        const left = String(a.key)
        const right = String(b.key)
        if (left === right) return 0
        return (left < right ? -1 : 1) * factor
    })
    return decorated.map((entry) => entry.record)
}

function buildProjectionTree(
    endpoint: string,
    fields: readonly string[],
    tables: ReadonlyMap<string, readonly EntityRecord[]>,
    indexes: ReadonlyMap<string, TableIndex>,
): ProjectionNode {
    const root: ProjectionNode = { wildcard: false, endpoint, targetIndex: undefined, children: new Map() }
    for (const path of fields) {
        const segments = path.split('.')
        let node = root
        for (const segment of segments) {
            if (segment === '*') {
                node.wildcard = true
                break
            }
            let child = node.children.get(segment)
            if (!child) {
                const targetEndpoint =
                    node.endpoint !== undefined ? resolveRelationEndpoint(node.endpoint, segment, tables) : undefined
                child = {
                    wildcard: false,
                    endpoint: targetEndpoint,
                    targetIndex: targetEndpoint !== undefined ? indexes.get(targetEndpoint) : undefined,
                    children: new Map(),
                }
                node.children.set(segment, child)
            }
            node = child
        }
    }
    return root
}

function collapseUnexpandedValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((item: unknown) => (isRecord(item) && typeof item.id === 'number' ? item.id : deepClone(item)))
    }
    if (isRecord(value) && typeof value.id === 'number') {
        return value.id
    }
    return deepClone(value)
}

function projectEntity(record: EntityRecord, node: ProjectionNode): EntityRecord {
    const out: EntityRecord = {}
    if (typeof record.id === 'number') {
        out.id = record.id
    }
    if (node.wildcard) {
        for (const [key, value] of Object.entries(record)) {
            if (value === undefined) continue
            const child = node.children.get(key)
            if (child && (child.wildcard || child.children.size > 0)) continue
            out[key] = collapseUnexpandedValue(value)
        }
    }
    for (const [key, child] of node.children) {
        const raw: unknown = record[key]
        if (raw === undefined) continue
        const expand = child.wildcard || child.children.size > 0
        if (!expand) {
            out[key] = collapseUnexpandedValue(raw)
            continue
        }
        if (Array.isArray(raw)) {
            const expanded: EntityRecord[] = []
            for (const element of raw) {
                if (isRecord(element)) {
                    expanded.push(projectEntity(element, child))
                } else if (typeof element === 'number') {
                    const resolved = child.targetIndex?.get(element)
                    if (resolved) expanded.push(projectEntity(resolved, child))
                }
            }
            out[key] = expanded
        } else if (isRecord(raw)) {
            out[key] = projectEntity(raw, child)
        } else if (typeof raw === 'number') {
            const resolved = child.targetIndex?.get(raw)
            if (resolved) out[key] = projectEntity(resolved, child)
        }
    }
    return out
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
    if (ms <= 0) return Promise.resolve()
    return new Promise((resolve) => {
        if (signal.aborted) {
            resolve()
            return
        }
        const onAbort = () => {
            clearTimeout(timer)
            resolve()
        }
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort)
            resolve()
        }, ms)
        signal.addEventListener('abort', onAbort, { once: true })
    })
}

/**
 * Create an in-memory IGDB emulator adapter to pass into `createIgdbClient({ emulator })`.
 * Requires no Twitch credentials and performs no network requests.
 */
export function createIgdbEmulator(options: IgdbEmulatorOptions = {}): IgdbEmulator {
    const mode = options.mode ?? 'merge'
    if (mode !== 'merge' && mode !== 'replace') {
        throw new TypeError("emulator mode must be 'merge' or 'replace'.")
    }
    const delayMs = options.delayMs ?? 0
    if (typeof delayMs !== 'number' || !Number.isFinite(delayMs) || delayMs < 0 || delayMs > 2_147_483_647) {
        throw new TypeError('delayMs must be a non-negative finite number no greater than 2147483647.')
    }
    if (options.onQuery !== undefined && typeof options.onQuery !== 'function') {
        throw new TypeError('onQuery must be a function.')
    }
    const { onQuery } = options
    const { tables, indexes } = buildTables(options.data, mode)
    const aliases = buildAliases(options.aliases, mode)

    const execute: EmulatorExecutor = async (
        plan: QueryPlan,
        query: string,
        requestOptions: RequestOptions | undefined,
        signal: AbortSignal,
    ): Promise<unknown> => {
        if (delayMs > 0) {
            await sleep(delayMs, signal)
        }
        if (signal.aborted) return []
        if (onQuery) {
            const context: IgdbEmulatorQueryContext =
                requestOptions === undefined
                    ? { endpoint: plan.endpoint, query }
                    : { endpoint: plan.endpoint, query, options: requestOptions }
            await onQuery(context)
        }
        if (signal.aborted) return []

        const source = tables.get(plan.endpoint)
        const offset = plan.offset ?? 0
        const limit = plan.limit ?? 10
        if (!source || source.length === 0 || offset >= source.length) {
            return []
        }

        let page: readonly EntityRecord[]
        if (plan.search === undefined && plan.orderBy === undefined) {
            if (plan.where === undefined) {
                page = source.slice(offset, offset + limit)
            } else {
                const matches = compilePredicate(plan.endpoint, plan.where, tables, indexes)
                const collected: EntityRecord[] = []
                let skipped = 0
                for (const record of source) {
                    if (!matches(record)) continue
                    if (skipped < offset) {
                        skipped += 1
                        continue
                    }
                    collected.push(record)
                    if (collected.length >= limit) break
                }
                page = collected
            }
        } else {
            let rows: readonly EntityRecord[] = source
            if (plan.search !== undefined) {
                rows = filterAndRankBySearch(rows, plan.search, aliases)
            }
            if (plan.where !== undefined) {
                const matches = compilePredicate(plan.endpoint, plan.where, tables, indexes)
                rows = rows.filter(matches)
            }
            if (plan.orderBy !== undefined) {
                rows = sortRows(rows, plan.endpoint, plan.orderBy, tables, indexes)
            }
            page = rows.slice(offset, offset + limit)
        }

        if (page.length === 0) return []
        const projection = buildProjectionTree(plan.endpoint, plan.fields, tables, indexes)
        return page.map((record) => projectEntity(record, projection))
    }

    const adapter = Object.freeze({ [EMULATOR_TRANSPORT]: execute })
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Opaque brand hides the symbol-keyed executor from public callers.
    return adapter as unknown as IgdbEmulator
}
