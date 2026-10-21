// Compiled against package.json exports and dist/index.d.ts, never src/index.ts.
// This file is checked in both NodeNext and Bundler mode without @types/node.
import { and, arrayOverlaps, createIgdbClient, desc, eq, gte } from '@liry24/igdb'
import type { Endpoint, Game } from '@liry24/igdb'

const fetchMock: typeof fetch = async () => new Response('[]', { headers: { 'Content-Type': 'application/json' } })

const client = createIgdbClient({
    clientId: 'consumer-check',
    accessToken: 'consumer-token',
    fetch: fetchMock,
})

const endpoint: Endpoint = 'games'
const query = client
    .query(endpoint)
    .fields('name', 'cover.image_id')
    .where((game) => and(gte(game.rating, 80), arrayOverlaps(game.platforms, [6])))
    .orderBy((game) => desc(game.rating))
    .limit(1)
const rows = await query
const pending = query.execute({ signal: new AbortController().signal })
const mapped = query.then((page) => page.map((game) => game.name))

// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- Exact type equality requires two independent generic signatures.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Expect<T extends true> = T
type Row = Awaited<typeof query>[number]

export type DirectAwait = Expect<Equal<typeof rows, Row[]>>
export type ExplicitExecution = Expect<Equal<Awaited<typeof pending>, Row[]>>
export type ThenMapping = Expect<Equal<typeof mapped, Promise<(string | undefined)[]>>>
export type ImplicitId = Expect<Equal<Row['id'], number>>
export type SelectedName = Expect<Equal<Row['name'], string | undefined>>
export type PublicEntityId = Expect<Equal<Game['id'], number>>

declare const row: Row
const imageId: string | undefined = row.cover?.image_id
void imageId

// @ts-expect-error Unselected fields are not promised by the result type.
void row.rating

// @ts-expect-error Unknown endpoints are rejected.
client.query('not_an_endpoint')

// @ts-expect-error Nested field names are checked against the endpoint.
client.query('games').fields('cover.not_a_field')

// @ts-expect-error The comparison value cannot widen a numeric column to string.
client.query('games').where((game) => eq(game.rating, '80'))

// @ts-expect-error An absent response field does not make undefined a comparison value.
client.query('games').where((game) => gte(game.rating, undefined))

// @ts-expect-error Relation collection filters compare numeric IDs.
client.query('games').where((game) => arrayOverlaps(game.platforms, ['6']))

createIgdbClient({ clientId: 'consumer-check', clientSecret: 'consumer-secret', fetch: fetchMock })

// @ts-expect-error Exactly one credential mode is required.
createIgdbClient({ clientId: 'consumer-check' })

// @ts-expect-error Credential modes are mutually exclusive.
createIgdbClient({ clientId: 'consumer-check', accessToken: 'token', clientSecret: 'secret' })
