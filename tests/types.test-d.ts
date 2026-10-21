import { expectTypeOf } from 'vitest'

import { createFields } from '../src/expressions.js'
import {
    and,
    arrayContains,
    arrayOverlaps,
    desc,
    eq,
    gte,
    inArray,
    isNotNull,
    or,
    type IgdbClient,
    type Predicate,
    type QueryResult,
} from '../src/index.js'
import type { ValidateFields } from '../src/types.js'

declare const client: IgdbClient

const defaultQuery = client.query('games')
expectTypeOf(defaultQuery.request()).toEqualTypeOf<Promise<{ id: number }[]>>()
defaultQuery.search('Zelda')
client.query('search').search('Zelda')
// @ts-expect-error Image endpoints do not support name search.
client.query('covers').search('Zelda')

const names = defaultQuery.fields('name')
expectTypeOf(names.request()).toEqualTypeOf<Promise<{ id: number; name?: string }[]>>()

const relations = defaultQuery.fields('name', 'cover', 'genres')
expectTypeOf(relations.request()).toEqualTypeOf<
    Promise<{ id: number; name?: string; cover?: number; genres?: number[] }[]>
>()

const expanded = defaultQuery.fields('name', 'cover.image_id', 'genres.name')
expectTypeOf(expanded.request()).toEqualTypeOf<
    Promise<
        {
            id: number
            name?: string
            cover?: { id: number; image_id?: string }
            genres?: { id: number; name?: string }[]
        }[]
    >
>()

const nested = defaultQuery.fields('cover.game.platforms.platform_logo.image_id')
expectTypeOf(nested.request()).toEqualTypeOf<
    Promise<
        {
            id: number
            cover?: {
                id: number
                game?: {
                    id: number
                    platforms?: {
                        id: number
                        platform_logo?: { id: number; image_id?: string }
                    }[]
                }
            }
        }[]
    >
>()

const rawAndExpanded = defaultQuery.fields('cover', 'cover.image_id')
expectTypeOf(rawAndExpanded.request()).toEqualTypeOf<
    Promise<{ id: number; cover?: { id: number; image_id?: string } }[]>
>()

expectTypeOf<QueryResult<'games', '*'>['cover']>().toEqualTypeOf<number | undefined>()
expectTypeOf<QueryResult<'games', '*'>['platforms']>().toEqualTypeOf<number[] | undefined>()
expectTypeOf<QueryResult<'games', '*' | 'cover.image_id'>['cover']>().toEqualTypeOf<
    { id: number; image_id?: string } | undefined
>()
expectTypeOf<NonNullable<QueryResult<'games', 'cover.*'>['cover']>['game']>().toEqualTypeOf<number | undefined>()

const replaced = names.fields('slug')
expectTypeOf(replaced.request()).toEqualTypeOf<Promise<{ id: number; slug?: string }[]>>()
const tuple = ['name', 'cover.image_id'] as const
defaultQuery.fields(...tuple)
defaultQuery.fields('platforms.platform_logo.*')
defaultQuery.fields('parent_game.parent_game.parent_game.name')

// @ts-expect-error Endpoint names come from the documented endpoint map.
client.query('unknown')
// @ts-expect-error A selection is nonempty.
defaultQuery.fields()
// @ts-expect-error Unknown root field.
defaultQuery.fields('naem')
// @ts-expect-error Unknown related field.
defaultQuery.fields('cover.imageId')
// @ts-expect-error Scalar fields cannot be expanded.
defaultQuery.fields('name.*')
// @ts-expect-error Scalar leaves cannot be traversed.
defaultQuery.fields('genres.name.lower')
// @ts-expect-error A wildcard must terminate its path.
defaultQuery.fields('*.name')
// @ts-expect-error Empty relation paths are not valid.
defaultQuery.fields('cover.')
declare const dynamicField: string
// @ts-expect-error Dynamic strings cannot promise an inferred response projection.
defaultQuery.fields(dynamicField)
declare const dynamicFields: [string, ...string[]]
// @ts-expect-error Use a literal tuple instead of a mutable dynamic list.
defaultQuery.fields(...dynamicFields)
declare const dynamicRelation: 'cover' | 'cover.image_id'
// @ts-expect-error One ambiguous path cannot promise ID-only or expanded output.
defaultQuery.fields(dynamicRelation)
declare const dynamicSelection: ['cover'] | ['cover.image_id']
expectTypeOf<ValidateFields<'games', typeof dynamicSelection>>().toEqualTypeOf<never>()
// @ts-expect-error A union of tuples cannot promise ID-only or expanded output.
defaultQuery.fields(...dynamicSelection)

names.where((g) => and(gte(g.rating, 80), arrayOverlaps(g.platforms, [6])))
names.where((g) => eq(g.cover.image_id, 'co123'))
names.where((g) => inArray(g.id, [1, 2]))
names.where((g) => inArray(g.name, ['one', 'two']))
names.where((g) => arrayContains(g.platforms, [6]))
names.where((g) => isNotNull(g.cover))
names.where((g) => arrayOverlaps(g.release_dates.platform, [6]))
names.where((g) => gte(g.release_dates.date, 631152000))
names.orderBy((g) => desc(g.release_dates.date))
names.where((g) => and(undefined, eq(g.id, 1), or(undefined, eq(g.id, 2))))
names.where(() => undefined)

// @ts-expect-error The right value cannot widen a numeric field into a union.
names.where((g) => eq(g.id, '1'))
// @ts-expect-error String fields require strings.
names.where((g) => eq(g.name, 1))
// @ts-expect-error Enum values cannot be widened by the supplied value.
names.where((g) => eq(g.category, 999))
// @ts-expect-error Numeric comparisons do not accept string fields.
names.where((g) => gte(g.name, 'a'))
// @ts-expect-error Scalar membership does not accept an ID array field.
names.where((g) => inArray(g.platforms, [6]))
// @ts-expect-error Array membership does not accept a scalar ID field.
names.where((g) => arrayOverlaps(g.id, [6]))
// @ts-expect-error An array's values cannot widen from number to string.
names.where((g) => arrayOverlaps(g.platforms, ['PC']))
// @ts-expect-error Scalar equality is not array membership.
names.where((g) => eq(g.platforms, [6]))
// @ts-expect-error A many-relation path has collection semantics.
names.where((g) => eq(g.release_dates.platform, 6))
// @ts-expect-error A many-relation path uses array operators for membership.
names.where((g) => inArray(g.release_dates.platform, [6]))
// @ts-expect-error Sorting by an entire ID array is unsupported.
names.orderBy((g) => desc(g.genres))
// @ts-expect-error References are not runtime response values.
names.where((g) => g.id === 1)
// @ts-expect-error SQL-shaped objects do not satisfy the opaque predicate brand.
names.where(() => ({ sql: 'id = 1' }))

const games = createFields('games')
const platforms = createFields('platforms')
names.where(() => eq(games.id, 1))
// @ts-expect-error Reusing a predicate from another endpoint is not allowed.
names.where(() => eq(platforms.id, 1))
// @ts-expect-error Combining another endpoint cannot erase the mismatch.
names.where(() => and(eq(games.id, 1), eq(platforms.id, 1)))
expectTypeOf(eq(games.id, 1)).toEqualTypeOf<Predicate<'games'>>()
