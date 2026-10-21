# @liry24/igdb

Type-safe IGDB queries with zero dependencies.

```sh
npm install @liry24/igdb
```

## Usage

```ts
import { createIgdbClient } from '@liry24/igdb'

const igdb = createIgdbClient({ clientId, clientSecret })

const games = await igdb
    .query('games')
    .fields('id', 'name', 'slug', 'cover.image_id')
    .search('Zelda')
    .limit(10)
    .request()
```

Use an existing access token:

```ts
const igdb = createIgdbClient({ clientId, accessToken })
```

## Filters and sorting

```ts
import { and, arrayOverlaps, desc, eq, gte } from '@liry24/igdb'

const games = await igdb
    .query('games')
    .fields('name', 'rating', 'cover.image_id')
    .where((g) => and(gte(g.rating, 80), arrayOverlaps(g.platforms, [6])))
    .orderBy((g) => desc(g.rating))
    .limit(20)
    .offset(0)
    .request()

const [game] = await igdb
    .query('games')
    .fields('name', 'slug')
    .where((g) => eq(g.id, gameId))
    .limit(1)
    .request()
```

## Other endpoints

```ts
const platforms = await igdb.query('platforms').fields('name', 'abbreviation').limit(100).request()

const companies = await igdb.query('companies').fields('name', 'country').limit(20).request()
```

## Request options

```ts
const controller = new AbortController()

const games = await igdb.query('games').fields('name').request({ signal: controller.signal, timeoutMs: 5_000 })
```

[IGDB API reference](https://api-docs.igdb.com/)
