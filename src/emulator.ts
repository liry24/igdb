import type { EmulatorExecutor, IgdbEmulator, OrderAst, PredicateAst, QueryPlan, Scalar } from './emulator-bridge.js'
import type { Cover, Endpoint, EndpointMap, Game, Platform } from './schema.js'
import type { RequestOptions } from './transport.js'

export type { IgdbEmulator } from './emulator-bridge.js'

const EMULATOR_TRANSPORT: symbol = Symbol.for('@liry24/igdb/emulator-transport')

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

interface ProjectionNode {
    wildcard: boolean
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

export const defaultEmulatorDataset: Readonly<EmulatorDataset> = deepFreeze({
    games: builtInGames,
    covers: builtInCovers,
    platforms: builtInPlatforms,
})

export const defaultEmulatorAliases: Readonly<Record<number, readonly string[]>> = deepFreeze({
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
    tables: Map<string, EntityRecord[]>
    indexes: Map<string, Map<number, EntityRecord>>
} {
    const tables = new Map<string, EntityRecord[]>()
    const indexes = new Map<string, Map<number, EntityRecord>>()

    const ingest = (source: EmulatorDataset | undefined): void => {
        if (!source) return
        for (const [endpoint, records] of Object.entries(source)) {
            if (!Array.isArray(records)) continue
            let rows = tables.get(endpoint)
            let byId = indexes.get(endpoint)
            if (!rows || !byId) {
                rows = []
                byId = new Map()
                tables.set(endpoint, rows)
                indexes.set(endpoint, byId)
            }
            for (const raw of records) {
                if (!isRecord(raw) || typeof raw.id !== 'number') continue
                const cloned = deepClone(raw)
                const existing = byId.get(raw.id)
                if (existing) {
                    const slot = rows.indexOf(existing)
                    if (slot !== -1) rows[slot] = cloned
                } else {
                    rows.push(cloned)
                }
                byId.set(raw.id, cloned)
            }
        }
    }

    if (mode === 'merge') ingest(defaultEmulatorDataset)
    ingest(data)
    return { tables, indexes }
}

function buildAliases(
    custom: Readonly<Record<number, readonly string[]>> | undefined,
    mode: 'merge' | 'replace',
): Map<number, readonly string[]> {
    const map = new Map<number, string[]>()
    const add = (source: Readonly<Record<number, readonly string[]>> | undefined): void => {
        if (!source) return
        for (const [rawId, list] of Object.entries(source)) {
            const id = Number(rawId)
            if (!Number.isSafeInteger(id) || !Array.isArray(list)) continue
            const current = map.get(id) ?? []
            for (const alias of list) {
                if (typeof alias === 'string' && !current.includes(alias)) current.push(alias)
            }
            map.set(id, current)
        }
    }
    if (mode === 'merge') add(defaultEmulatorAliases)
    add(custom)
    return map
}

function resolveEntityById(
    id: number,
    targetEndpoint: string | undefined,
    indexes: ReadonlyMap<string, ReadonlyMap<number, EntityRecord>>,
): EntityRecord | undefined {
    if (!targetEndpoint) return undefined
    return indexes.get(targetEndpoint)?.get(id)
}

function resolvePathValues(
    record: EntityRecord,
    endpoint: string,
    path: string,
    tables: ReadonlyMap<string, readonly EntityRecord[]>,
    indexes: ReadonlyMap<string, ReadonlyMap<number, EntityRecord>>,
): unknown[] {
    const segments = path.split('.')
    let currentValues: unknown[] = [record]
    let currentEndpoint: string | undefined = endpoint

    for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index]!
        const isLast = index === segments.length - 1
        const nextValues: unknown[] = []
        const nextEndpoint: string | undefined =
            currentEndpoint !== undefined ? resolveRelationEndpoint(currentEndpoint, segment, tables) : undefined

        for (const item of currentValues) {
            if (!isRecord(item)) continue
            const raw: unknown = item[segment]
            if (isLast) {
                if (raw !== undefined) nextValues.push(raw)
                continue
            }
            if (Array.isArray(raw)) {
                for (const element of raw) {
                    if (isRecord(element)) nextValues.push(element)
                    else if (typeof element === 'number') {
                        const resolved = resolveEntityById(element, nextEndpoint, indexes)
                        if (resolved) nextValues.push(resolved)
                    }
                }
            } else if (isRecord(raw)) {
                nextValues.push(raw)
            } else if (typeof raw === 'number') {
                const resolved = resolveEntityById(raw, nextEndpoint, indexes)
                if (resolved) nextValues.push(resolved)
            }
        }
        currentValues = nextValues
        currentEndpoint = nextEndpoint
    }
    return currentValues
}

function normalizeLeaf(value: unknown, target: Scalar): unknown {
    if (typeof target === 'number' && isRecord(value) && typeof value.id === 'number') {
        return value.id
    }
    return value
}

function flattenLeaves(values: readonly unknown[]): unknown[] {
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

function evalPredicate(
    record: EntityRecord,
    endpoint: string,
    ast: PredicateAst,
    tables: ReadonlyMap<string, readonly EntityRecord[]>,
    indexes: ReadonlyMap<string, ReadonlyMap<number, EntityRecord>>,
): boolean {
    switch (ast.kind) {
        case 'const':
            return ast.value
        case 'and':
            return ast.children.every((child) => evalPredicate(record, endpoint, child, tables, indexes))
        case 'or':
            return ast.children.some((child) => evalPredicate(record, endpoint, child, tables, indexes))
        case 'isNull': {
            const values = resolvePathValues(record, endpoint, ast.path, tables, indexes)
            return values.every((value) => value === undefined || value === null)
        }
        case 'isNotNull': {
            const values = resolvePathValues(record, endpoint, ast.path, tables, indexes)
            return values.some((value) => value !== undefined && value !== null)
        }
        case 'compare': {
            const leaves = flattenLeaves(resolvePathValues(record, endpoint, ast.path, tables, indexes))
            const target = ast.value
            switch (ast.op) {
                case '=':
                    return leaves.some((value) => normalizeLeaf(value, target) === target)
                case '!=':
                    return (
                        leaves.length > 0 &&
                        leaves.every(
                            (value) => value !== undefined && value !== null && normalizeLeaf(value, target) !== target,
                        )
                    )
                case '>': {
                    if (typeof target !== 'number') return false
                    return leaves.some((value) => {
                        const normalized = normalizeLeaf(value, target)
                        return typeof normalized === 'number' && normalized > target
                    })
                }
                case '>=': {
                    if (typeof target !== 'number') return false
                    return leaves.some((value) => {
                        const normalized = normalizeLeaf(value, target)
                        return typeof normalized === 'number' && normalized >= target
                    })
                }
                case '<': {
                    if (typeof target !== 'number') return false
                    return leaves.some((value) => {
                        const normalized = normalizeLeaf(value, target)
                        return typeof normalized === 'number' && normalized < target
                    })
                }
                case '<=': {
                    if (typeof target !== 'number') return false
                    return leaves.some((value) => {
                        const normalized = normalizeLeaf(value, target)
                        return typeof normalized === 'number' && normalized <= target
                    })
                }
                default:
                    return false
            }
        }
        case 'in': {
            const leaves = flattenLeaves(resolvePathValues(record, endpoint, ast.path, tables, indexes))
            return leaves.some((value) => ast.values.some((target) => normalizeLeaf(value, target) === target))
        }
        case 'notIn': {
            const leaves = flattenLeaves(resolvePathValues(record, endpoint, ast.path, tables, indexes))
            return (
                leaves.length > 0 &&
                leaves.every(
                    (value) =>
                        value !== undefined &&
                        value !== null &&
                        !ast.values.some((target) => normalizeLeaf(value, target) === target),
                )
            )
        }
        case 'arrayContains': {
            const leaves = flattenLeaves(resolvePathValues(record, endpoint, ast.path, tables, indexes))
            return ast.values.every((target) => leaves.some((value) => normalizeLeaf(value, target) === target))
        }
        case 'arrayOverlaps': {
            const leaves = flattenLeaves(resolvePathValues(record, endpoint, ast.path, tables, indexes))
            return ast.values.some((target) => leaves.some((value) => normalizeLeaf(value, target) === target))
        }
        default:
            return false
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
        const candidates: string[] = []
        if (typeof record.name === 'string') candidates.push(record.name)
        if (typeof record.slug === 'string') candidates.push(record.slug)
        if (typeof record.alternative_name === 'string') candidates.push(record.alternative_name)
        const id = typeof record.id === 'number' ? record.id : 0
        const recordAliases = aliases.get(id)
        if (recordAliases) {
            for (const alias of recordAliases) candidates.push(alias)
        }
        let best = Number.POSITIVE_INFINITY
        for (const candidate of candidates) {
            const score = searchScore(candidate, needle)
            if (score < best) best = score
        }
        if (Number.isFinite(best)) {
            ranked.push({ record, score: best, id })
        }
    }
    ranked.sort((a, b) => (a.score !== b.score ? a.score - b.score : a.id - b.id))
    return ranked.map((entry) => entry.record)
}

function extractSortKey(
    record: EntityRecord,
    endpoint: string,
    order: OrderAst,
    tables: ReadonlyMap<string, readonly EntityRecord[]>,
    indexes: ReadonlyMap<string, ReadonlyMap<number, EntityRecord>>,
): Scalar | undefined {
    const leaves = flattenLeaves(resolvePathValues(record, endpoint, order.path, tables, indexes)).filter(
        (value): value is Scalar =>
            typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean',
    )
    if (leaves.length === 0) return undefined
    if (leaves.length === 1) return leaves[0]
    const numbers = leaves.filter((value): value is number => typeof value === 'number')
    if (numbers.length === leaves.length) {
        return order.direction === 'asc' ? Math.min(...numbers) : Math.max(...numbers)
    }
    return leaves[0]
}

function sortRows(
    rows: readonly EntityRecord[],
    endpoint: string,
    order: OrderAst,
    tables: ReadonlyMap<string, readonly EntityRecord[]>,
    indexes: ReadonlyMap<string, ReadonlyMap<number, EntityRecord>>,
): EntityRecord[] {
    const factor = order.direction === 'asc' ? 1 : -1
    const decorated = rows.map((record) => ({
        record,
        key: extractSortKey(record, endpoint, order, tables, indexes),
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

function buildProjectionTree(fields: readonly string[]): ProjectionNode {
    const root: ProjectionNode = { wildcard: false, children: new Map() }
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
                child = { wildcard: false, children: new Map() }
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

function projectEntity(
    record: EntityRecord,
    endpoint: string | undefined,
    node: ProjectionNode,
    tables: ReadonlyMap<string, readonly EntityRecord[]>,
    indexes: ReadonlyMap<string, ReadonlyMap<number, EntityRecord>>,
): EntityRecord {
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
        const targetEndpoint = endpoint !== undefined ? resolveRelationEndpoint(endpoint, key, tables) : undefined
        if (Array.isArray(raw)) {
            const expanded: EntityRecord[] = []
            for (const element of raw) {
                if (isRecord(element)) {
                    expanded.push(projectEntity(element, targetEndpoint, child, tables, indexes))
                } else if (typeof element === 'number') {
                    const resolved = resolveEntityById(element, targetEndpoint, indexes)
                    if (resolved) expanded.push(projectEntity(resolved, targetEndpoint, child, tables, indexes))
                }
            }
            out[key] = expanded
        } else if (isRecord(raw)) {
            out[key] = projectEntity(raw, targetEndpoint, child, tables, indexes)
        } else if (typeof raw === 'number') {
            const resolved = resolveEntityById(raw, targetEndpoint, indexes)
            if (resolved) out[key] = projectEntity(resolved, targetEndpoint, child, tables, indexes)
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

        let rows: EntityRecord[] = [...(tables.get(plan.endpoint) ?? [])]

        if (plan.search !== undefined) {
            rows = filterAndRankBySearch(rows, plan.search, aliases)
        }
        if (plan.where !== undefined) {
            const whereAst = plan.where
            rows = rows.filter((record) => evalPredicate(record, plan.endpoint, whereAst, tables, indexes))
        }
        if (plan.orderBy !== undefined) {
            rows = sortRows(rows, plan.endpoint, plan.orderBy, tables, indexes)
        }

        const offset = plan.offset ?? 0
        const limit = plan.limit ?? 10
        const page = rows.slice(offset, offset + limit)
        const projection = buildProjectionTree(plan.fields)

        return page.map((record) => projectEntity(record, plan.endpoint, projection, tables, indexes))
    }

    const adapter = Object.freeze({ [EMULATOR_TRANSPORT]: execute })
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Opaque brand hides the symbol-keyed executor from public callers.
    return adapter as unknown as IgdbEmulator
}
