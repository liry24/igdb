import type { Endpoint } from './schema.js'
import type { EndpointFields } from './types.js'

declare const fieldBrand: unique symbol
declare const predicateBrand: unique symbol
declare const orderBrand: unique symbol

/** A typed reference, not the value returned by IGDB. */
export interface FieldRef<E extends Endpoint = Endpoint, Value = unknown, Many extends boolean = false> {
    readonly [fieldBrand]: {
        readonly endpoint: E
        readonly value: Value
        readonly many: Many
    }
}

/** An opaque, endpoint-specific APICalypse condition. */
export interface Predicate<E extends Endpoint = Endpoint> {
    readonly [predicateBrand]: E
}

/** An opaque, endpoint-specific sort expression. */
export interface OrderExpr<E extends Endpoint = Endpoint> {
    readonly [orderBrand]: E
}

type Scalar = string | number | boolean
type AnyField = FieldRef<Endpoint, unknown, boolean>

interface Reference<E extends Endpoint = Endpoint> {
    readonly endpoint: E
    readonly path: string
}

interface Expression<E extends Endpoint = Endpoint> {
    readonly endpoint: E
    readonly text: string
}

const references: WeakMap<object, Reference> = new WeakMap()
const predicates: WeakMap<object, Expression> = new WeakMap()
const orders: WeakMap<object, Expression> = new WeakMap()
const fieldNamePattern: RegExp = /^[a-z][a-z0-9_]*$/

function isObject(value: unknown): value is object {
    return typeof value === 'object' && value !== null
}

function getReference<E extends Endpoint>(value: FieldRef<E, unknown, boolean>): Reference<E> {
    const reference = isObject(value) ? references.get(value) : undefined
    if (!reference || reference.path.length === 0) {
        throw new TypeError('Expected an IGDB field reference.')
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The registry preserves the endpoint used to create each opaque reference.
    return reference as Reference<E>
}

function getExpression<E extends Endpoint>(
    value: Predicate<E> | OrderExpr<E>,
    registry: WeakMap<object, Expression>,
): Expression<E> {
    const expression = isObject(value) ? registry.get(value) : undefined
    if (!expression) throw new TypeError('Expected an IGDB expression.')
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Only the matching opaque factory can add an expression to its registry.
    return expression as Expression<E>
}

function createReference(endpoint: Endpoint, path: string): object {
    const children = new Map<string, object>()
    const reference = new Proxy(Object.freeze({}), {
        get(_target, key): unknown {
            // Field references must not become thenables when returned by a callback.
            if (typeof key !== 'string' || key === 'then') return undefined
            if (!fieldNamePattern.test(key)) throw new TypeError('Invalid IGDB field name.')
            let child = children.get(key)
            if (!child) {
                child = createReference(endpoint, path ? `${path}.${key}` : key)
                children.set(key, child)
            }
            return child
        },
    })
    references.set(reference, { endpoint, path })
    return reference
}

/** @internal Creates only the field paths accessed by the caller. */
export function createFields<E extends Endpoint>(endpoint: E): EndpointFields<E> {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The Proxy constructs typed field paths lazily instead of materializing the schema.
    return createReference(endpoint, '') as EndpointFields<E>
}

/** @internal The shared serializer for APICalypse string values. */
export function escapeString(value: string): string {
    if (typeof value !== 'string') throw new TypeError('Expected a string.')
    return JSON.stringify(value)
}

function scalar(value: unknown): string {
    if (typeof value === 'string') return escapeString(value)
    if (typeof value === 'boolean') return String(value)
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    throw new TypeError('IGDB values must be strings, booleans, or finite numbers.')
}

function predicate<E extends Endpoint>(endpoint: E, text: string): Predicate<E> {
    const result = Object.freeze({})
    predicates.set(result, { endpoint, text })
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The private registry supplies the opaque brand without a runtime symbol.
    return result as Predicate<E>
}

function comparison<E extends Endpoint>(
    field: FieldRef<E, unknown, boolean>,
    operator: string,
    value: unknown,
): Predicate<E> {
    const reference = getReference(field)
    return predicate<E>(reference.endpoint, `${reference.path} ${operator} ${scalar(value)}`)
}

function numericComparison<E extends Endpoint>(
    field: FieldRef<E, unknown, boolean>,
    operator: string,
    value: number,
): Predicate<E> {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError('Numeric comparisons require a finite number.')
    }
    return comparison(field, operator, value)
}

/** Compare a scalar field with a value of the same type. */
export function eq<E extends Endpoint, Value extends Scalar>(
    field: FieldRef<E, Value>,
    value: NoInfer<Value>,
): Predicate<E> {
    return comparison(field, '=', value)
}

export function ne<E extends Endpoint, Value extends Scalar>(
    field: FieldRef<E, Value>,
    value: NoInfer<Value>,
): Predicate<E> {
    return comparison(field, '!=', value)
}

/** Numeric comparisons also support numeric paths through a many relation. */
export function gt<E extends Endpoint, Value extends number>(
    field: FieldRef<E, Value, boolean>,
    value: NoInfer<Value>,
): Predicate<E> {
    return numericComparison(field, '>', value)
}

export function gte<E extends Endpoint, Value extends number>(
    field: FieldRef<E, Value, boolean>,
    value: NoInfer<Value>,
): Predicate<E> {
    return numericComparison(field, '>=', value)
}

export function lt<E extends Endpoint, Value extends number>(
    field: FieldRef<E, Value, boolean>,
    value: NoInfer<Value>,
): Predicate<E> {
    return numericComparison(field, '<', value)
}

export function lte<E extends Endpoint, Value extends number>(
    field: FieldRef<E, Value, boolean>,
    value: NoInfer<Value>,
): Predicate<E> {
    return numericComparison(field, '<=', value)
}

function combine<E extends Endpoint>(
    operator: '&' | '|',
    conditions: readonly (Predicate<E> | undefined)[],
): Predicate<E> | undefined {
    const expressions: Expression<E>[] = []
    for (const condition of conditions) {
        if (condition !== undefined) expressions.push(getExpression(condition, predicates))
    }
    const first = expressions[0]
    if (!first) return undefined
    if (expressions.some((expression) => expression.endpoint !== first.endpoint)) {
        throw new TypeError('Cannot combine conditions from different IGDB endpoints.')
    }
    const text =
        expressions.length === 1
            ? first.text
            : `(${expressions.map((expression) => expression.text).join(` ${operator} `)})`
    return predicate<E>(first.endpoint, text)
}

/** Undefined conditions are omitted; an empty conjunction is undefined. */
export function and<E extends Endpoint>(
    ...conditions: readonly (Predicate<E> | undefined)[]
): Predicate<E> | undefined {
    return combine('&', conditions)
}

/** Undefined conditions are omitted; an empty disjunction is undefined. */
export function or<E extends Endpoint>(...conditions: readonly (Predicate<E> | undefined)[]): Predicate<E> | undefined {
    return combine('|', conditions)
}

function listComparison<E extends Endpoint>(
    field: FieldRef<E, unknown, boolean>,
    operator: '=' | '!=',
    values: readonly Scalar[],
    bracket: '(' | '[',
    empty?: boolean,
): Predicate<E> {
    const reference = getReference(field)
    if (!Array.isArray(values)) throw new TypeError('Expected an array of IGDB values.')
    const serialized = Array.from(values, scalar)
    if (serialized.length === 0) {
        if (empty === undefined) throw new RangeError('Array comparisons require at least one value.')
        return predicate<E>(reference.endpoint, empty ? '(id = 0 | id != 0)' : '(id = 0 & id != 0)')
    }
    const closing = bracket === '(' ? ')' : ']'
    return predicate<E>(reference.endpoint, `${reference.path} ${operator} ${bracket}${serialized.join(',')}${closing}`)
}

/** Scalar membership. An empty list matches no records. */
export function inArray<E extends Endpoint, Value extends Scalar>(
    field: FieldRef<E, Value>,
    values: readonly NoInfer<Value>[],
): Predicate<E> {
    return listComparison(field, '=', values, '(', false)
}

/** Scalar non-membership. An empty list matches every record. */
export function notInArray<E extends Endpoint, Value extends Scalar>(
    field: FieldRef<E, Value>,
    values: readonly NoInfer<Value>[],
): Predicate<E> {
    return listComparison(field, '!=', values, '(', true)
}

export function isNull<E extends Endpoint>(field: FieldRef<E, unknown, boolean>): Predicate<E> {
    const reference = getReference(field)
    return predicate<E>(reference.endpoint, `${reference.path} = null`)
}

export function isNotNull<E extends Endpoint>(field: FieldRef<E, unknown, boolean>): Predicate<E> {
    const reference = getReference(field)
    return predicate<E>(reference.endpoint, `${reference.path} != null`)
}

/** Match every supplied value in an array or a path through a many relation. */
export function arrayContains<E extends Endpoint, Value extends Scalar>(
    field: FieldRef<E, readonly Value[], boolean>,
    values: readonly NoInfer<Value>[],
): Predicate<E>
export function arrayContains<E extends Endpoint, Value extends Scalar>(
    field: FieldRef<E, Value, true>,
    values: readonly NoInfer<Value>[],
): Predicate<E>
export function arrayContains<E extends Endpoint>(
    field: FieldRef<E, unknown, boolean>,
    values: readonly Scalar[],
): Predicate<E> {
    return listComparison(field, '=', values, '[')
}

/** Match at least one supplied value. The list must be nonempty. */
export function arrayOverlaps<E extends Endpoint, Value extends Scalar>(
    field: FieldRef<E, readonly Value[], boolean>,
    values: readonly NoInfer<Value>[],
): Predicate<E>
export function arrayOverlaps<E extends Endpoint, Value extends Scalar>(
    field: FieldRef<E, Value, true>,
    values: readonly NoInfer<Value>[],
): Predicate<E>
export function arrayOverlaps<E extends Endpoint>(
    field: FieldRef<E, unknown, boolean>,
    values: readonly Scalar[],
): Predicate<E> {
    return listComparison(field, '=', values, '(')
}

function order<E extends Endpoint>(field: AnyField, direction: 'asc' | 'desc'): OrderExpr<E> {
    const reference = getReference(field)
    const result = Object.freeze({})
    orders.set(result, { endpoint: reference.endpoint, text: `${reference.path} ${direction}` })
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The private registry supplies the opaque brand without a runtime symbol.
    return result as OrderExpr<E>
}

export function asc<E extends Endpoint>(field: FieldRef<E, Scalar, boolean>): OrderExpr<E> {
    return order<E>(field, 'asc')
}

export function desc<E extends Endpoint>(field: FieldRef<E, Scalar, boolean>): OrderExpr<E> {
    return order<E>(field, 'desc')
}

/** @internal Rejects forged predicates and references to another endpoint. */
export function serializePredicate<E extends Endpoint>(
    condition: Predicate<E> | undefined,
    endpoint: E,
): string | undefined {
    if (condition === undefined) return undefined
    const expression = getExpression(condition, predicates)
    if (expression.endpoint !== endpoint) {
        throw new TypeError('The condition belongs to a different IGDB endpoint.')
    }
    return expression.text
}

/** @internal */
export function serializeOrder<E extends Endpoint>(expression: OrderExpr<E>, endpoint: E): string {
    const result = getExpression(expression, orders)
    if (result.endpoint !== endpoint) {
        throw new TypeError('The sort belongs to a different IGDB endpoint.')
    }
    return result.text
}
