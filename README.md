# @liry24/igdb

Type-safe, zero-dependency IGDB v4 API client for Node.js 22+ and Web runtimes.

## Install

```sh
npm install @liry24/igdb --save-prefix='~'
```

Major versions track the IGDB API (`v4` → `4.x`). Minor releases may include breaking changes, so pinning with `~` is recommended.

## Usage

Create a client on the server with Twitch credentials (tokens are acquired, cached, and refreshed on `401` automatically) or an existing access token:

```ts
import { createIgdbClient } from '@liry24/igdb'

const igdb = createIgdbClient({ clientId, clientSecret })
// or: createIgdbClient({ clientId, accessToken })

const games = await igdb.query('games').fields('id', 'name', 'slug', 'cover.image_id').search('Zelda').limit(10)
```

`createIgdbClient` also accepts `timeoutMs` (default `10_000`) and a custom `fetch` implementation. Never expose Twitch credentials in browser code.

### Cloudflare Workers (`workerd`)

On Cloudflare Workers, `createIgdbClient({ clientId, clientSecret })` automatically shares fetched tokens across clients in the same isolate (scoped per `fetch` function) with `dedupeAuth` disabled by default so no in-flight I/O crosses requests. Overlapping requests on a cold cache may each fetch a token.

```ts
import { createIgdbClient } from '@liry24/igdb'

export async function searchGames(clientId: string, clientSecret: string, q: string) {
    const igdb = createIgdbClient({ clientId, clientSecret, timeoutMs: 5_000 })
    return await igdb.query('games').fields('id', 'slug', 'name', 'cover.image_id').search(q).limit(10)
}
```

Pass `tokenCache` (such as a module-scope `createMemoryTokenCache()`, or a custom store) to control caching explicitly—this is also required if your Worker disables global `navigator`. Supplying `tokenCache` also defaults `dedupeAuth` to `false`.

### Local development and testing (emulator)

Use `@liry24/igdb/emulator` to run queries in memory with built-in fixtures and no Twitch credentials or network requests:

```ts
import { createIgdbClient } from '@liry24/igdb'
import { createIgdbEmulator } from '@liry24/igdb/emulator'

const igdb = createIgdbClient({ emulator: createIgdbEmulator() })
const games = await igdb.query('games').fields('id', 'slug', 'name', 'cover.image_id').search('sf6').limit(10)
```

Pass `{ data, mode: 'merge' | 'replace', aliases, delayMs, onQuery }` to customize fixtures or inject `IgdbError` failures. Loading it with `await import('@liry24/igdb/emulator')` splits the emulator and fixtures into a separate on-demand chunk instead of bundling them into the main entry.

## Filters, sorting, and execution

Queries are immutable and reusable. Awaiting a query executes a fresh request; call `.build()` to inspect the APICalypse string or `.execute()` to pass per-request options:

```ts
import { and, arrayOverlaps, desc, eq, gte } from '@liry24/igdb'

const games = await igdb
    .query('games')
    .fields('name', 'rating', 'cover.image_id')
    .where((g) => and(gte(g.rating, 80), arrayOverlaps(g.platforms, [6])))
    .orderBy((g) => desc(g.rating))
    .limit(20)
    .offset(0)

const controller = new AbortController()
const [game] = await igdb
    .query('games')
    .fields('name', 'slug')
    .where((g) => eq(g.id, gameId))
    .limit(1)
    .execute({ signal: controller.signal, timeoutMs: 5_000 })
```

Available helpers: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `and`, `or`, `inArray`, `notInArray`, `isNull`, `isNotNull`, `arrayContains`, `arrayOverlaps`, `asc`, and `desc`.

Upstream and network failures throw `IgdbError` with `code` (`HTTP_ERROR`, `NETWORK_ERROR`, `INVALID_RESPONSE`, `TIMEOUT`, `ABORTED`), `phase` (`auth` | `request`), `status`, and `retryAfter` (seconds), without leaking response bodies or credentials.

See the [IGDB API documentation](https://api-docs.igdb.com/) for endpoints and fields.

## Development

```sh
upm install --frozen-lockfile
upm run check
```

Refresh the committed IGDB v4 schema snapshot and generated types with `upm run schema:update`.

Releases are automated with [uppt](https://github.com/danielroe/uppt): pushes to `main` open a draft release PR, and squash-merging it tags, verifies CI and the packed tarball, and stages an npm OIDC publish. If a breaking change targets IGDB v4, edit `version` in `package.json` on the `release/v*` branch to keep major `4`.

## License

[MIT](./LICENSE)
