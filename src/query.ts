import { IgdbError } from './errors.js'
import {
    createFields,
    escapeString,
    serializeOrder,
    serializePredicate,
    type OrderExpr,
    type Predicate,
} from './expressions.js'
import type { Endpoint } from './schema.js'
import type { RequestOptions, Transport } from './transport.js'
import type { EndpointFields, QueryResult, ValidateFields } from './types.js'

interface QueryState {
    readonly fields: readonly string[]
    readonly where?: string | undefined
    readonly orderBy?: string | undefined
    readonly search?: string | undefined
    readonly limit?: number | undefined
    readonly offset?: number | undefined
}

const fieldPathPattern: RegExp = /^(?:\*|[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*(?:\.\*)?)$/

// Searchable endpoints listed at https://api-docs.igdb.com/, plus Search itself.
const searchableEndpoints = ['characters', 'collections', 'games', 'platforms', 'search', 'themes'] as const
type SearchableEndpoint = (typeof searchableEndpoints)[number]

/** A reusable, immutable query. Only request() performs network I/O. */
export class IgdbQuery<E extends Endpoint, Selection extends string = 'id'> {
    readonly #endpoint: E
    readonly #transport: Transport
    readonly #state: QueryState

    /** @internal Construct queries with createIgdbClient().query(). */
    constructor(endpoint: E, transport: Transport, state: QueryState) {
        this.#endpoint = endpoint
        this.#transport = transport
        this.#state = state
    }

    /** Replace the selected fields. Dotted paths expand related records. */
    fields<const P extends readonly [string, ...string[]]>(
        ...paths: P & ValidateFields<E, P>
    ): IgdbQuery<E, P[number]> {
        if (paths.length === 0 || paths.some((path) => typeof path !== 'string' || !fieldPathPattern.test(path))) {
            throw new TypeError('fields() requires valid, nonempty IGDB field paths.')
        }
        return new IgdbQuery<E, P[number]>(this.#endpoint, this.#transport, {
            ...this.#state,
            fields: [...new Set(paths)],
        })
    }

    /** Replace the filter. Returning undefined removes the existing filter. */
    where(callback: (fields: EndpointFields<E>) => Predicate<E> | undefined): IgdbQuery<E, Selection> {
        if (typeof callback !== 'function') throw new TypeError('where() requires a callback.')
        return this.#with({
            where: serializePredicate(callback(createFields(this.#endpoint)), this.#endpoint),
        })
    }

    /** Replace the sort with one field expression. */
    orderBy(callback: (fields: EndpointFields<E>) => OrderExpr<E>): IgdbQuery<E, Selection> {
        if (typeof callback !== 'function') throw new TypeError('orderBy() requires a callback.')
        return this.#with({
            orderBy: serializeOrder(callback(createFields(this.#endpoint)), this.#endpoint),
        })
    }

    /** Search by name on an endpoint that supports IGDB search. */
    search(text: [E] extends [SearchableEndpoint] ? string : never): IgdbQuery<E, Selection> {
        if (!(searchableEndpoints as readonly Endpoint[]).includes(this.#endpoint)) {
            throw new TypeError('This IGDB endpoint does not support search().')
        }
        if (typeof text !== 'string') throw new TypeError('search() requires a string.')
        return this.#with({ search: escapeString(text) })
    }

    /** Set the page size, from 1 to 500. */
    limit(count: number): IgdbQuery<E, Selection> {
        if (!Number.isSafeInteger(count) || count < 1 || count > 500) {
            throw new RangeError('limit() must be an integer from 1 to 500.')
        }
        return this.#with({ limit: count })
    }

    /** Set the zero-based page offset. */
    offset(count: number): IgdbQuery<E, Selection> {
        if (!Number.isSafeInteger(count) || count < 0) {
            throw new RangeError('offset() must be a nonnegative safe integer.')
        }
        return this.#with({ offset: count })
    }

    /** Serialize the query without fetching or acquiring a token. */
    build(): string {
        const { fields, where, orderBy, search, limit, offset } = this.#state
        const clauses = [`fields ${fields.join(',')};`]
        if (search !== undefined) clauses.push(`search ${search};`)
        if (where !== undefined) clauses.push(`where ${where};`)
        if (orderBy !== undefined) clauses.push(`sort ${orderBy};`)
        if (limit !== undefined) clauses.push(`limit ${limit};`)
        if (offset !== undefined) clauses.push(`offset ${offset};`)
        return clauses.join(' ')
    }

    /** Fetch one page. The response is not mapped or fully schema-validated. */
    async request(options?: RequestOptions): Promise<QueryResult<E, Selection>[]> {
        const result = await this.#transport.request(this.#endpoint, this.build(), options)
        if (
            !Array.isArray(result) ||
            result.some((record: unknown) => record === null || typeof record !== 'object' || Array.isArray(record))
        ) {
            throw new IgdbError('INVALID_RESPONSE', 'request')
        }
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- IGDB owns the selected entity shapes; only the response envelope is checked here.
        return result as QueryResult<E, Selection>[]
    }

    #with(update: Partial<QueryState>): IgdbQuery<E, Selection> {
        return new IgdbQuery<E, Selection>(this.#endpoint, this.#transport, {
            ...this.#state,
            ...update,
        })
    }
}

/** @internal */
export function createQuery<E extends Endpoint>(endpoint: E, transport: Transport): IgdbQuery<E> {
    return new IgdbQuery<E>(endpoint, transport, { fields: ['id'] })
}
