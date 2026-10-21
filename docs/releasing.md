# Development, packaging, and future releases

The package is `@liry24/igdb`, initially version `0.1.0`, with source intended for
`liry24/igdb`. npm publication is not enabled. The repository has no publish job,
release automation, npm credentials, or OIDC publish permissions.

## Local development

Use Node.js 24.19.0, pinned in `.node-version`, and upm 1.5.0:

```sh
npm install --global --ignore-scripts upm@1.5.0
upm install --frozen-lockfile
upm run check
```

Node.js is the development tool runtime. The built client targets Node.js 22+
and server-side Web runtimes such as Cloudflare Workers, using standard Web APIs
without Node-specific imports. IGDB credentials belong on the server.

| Command                     | Purpose                                                                  |
| --------------------------- | ------------------------------------------------------------------------ |
| `upm run schema:generate`   | Regenerate declarations from the committed source snapshot               |
| `upm run schema:check`      | Check snapshot fingerprints and generated output, without network access |
| `upm run schema:update`     | Explicitly retrieve new official sources and regenerate declarations     |
| `upm run format`            | Format source and configuration with oxfmt                               |
| `upm run lint`              | Check code with oxlint                                                   |
| `upm run typecheck`         | Check source, tooling, and `tests/**/*.test-d.ts` with tsrs              |
| `upm run test`              | Run Vitest runtime tests; type-test files are excluded                   |
| `upm run build`             | Build the ESM client and declarations with tsdown                        |
| `upm run typecheck:package` | Check emitted declarations with NodeNext and Bundler resolution          |
| `upm run pack:check`        | Create, inspect, and smoke-test a local tarball, then remove it          |
| `upm run deps:update`       | Review available dependency updates and write new ranges with taze       |
| `upm install`               | Resolve changed ranges and update `upm.lock`                             |

`check` runs the offline schema check, lint, formatting check, source type check,
runtime tests, build, declaration consumer checks, and package verification in
that order. It never publishes a package. `schema:update` is deliberately not
part of CI; review upstream changes and commit the snapshot and generated output
together.

Commit `upm.lock` whenever dependency declarations change. CI uses
`upm install --frozen-lockfile`. Dependency lifecycle scripts are disabled by
upm's default policy. Vite is an explicit development dependency for Vitest's peer
requirement. upm currently describes itself as prerelease software, so its version
is pinned and its lockfile is reviewed alongside tool updates.

### Type checking and declarations

tsrs checks source and type tests; tsdown emits declarations using Oxc isolated
declarations. Declaration generation is not a replacement for type checking.
Exported APIs need explicit annotations compatible with isolated declarations.
The pinned tsrs release follows a TypeScript 7 development snapshot and has
documented compatibility gaps; update it deliberately and run the complete check.

`scripts/consumer-types.ts` imports the package by its published name, resolving
through `exports` to `dist/index.d.ts`. It checks both NodeNext and Bundler module
resolution with `types: []` and `skipLibCheck: false`, so the declarations cannot
rely on the development environment's Node globals. Build before running
`typecheck:package` or `pack:check` independently.

### Windows

The pinned tsrs release has no native Windows binary. Use WSL for the complete
`upm run check`, or use the matching official WebAssembly checker on Windows:

```sh
upx @tsrs/wasm@0.18.0-ts7.1.0-dev.20260929 -p tsconfig.json --noEmit
upm run build
upx @tsrs/wasm@0.18.0-ts7.1.0-dev.20260929 -p tsconfig.consumer.json
upx @tsrs/wasm@0.18.0-ts7.1.0-dev.20260929 -p tsconfig.consumer.json --module ESNext --moduleResolution Bundler
```

Run the remaining schema, lint, formatting, runtime-test, and package checks with
their individual commands. The WASM checker runs on one thread, requires Node.js
22+, and does not provide watch mode or an LSP. It is a platform fallback, not an
additional runtime dependency of this library.

## CI

CI follows the shared setup and aggregate-check structure of
[nuxt-files-sdk](https://github.com/liria24/nuxt-files-sdk/blob/46b122883525549a16fc178e249fad492a24ad4b/.github/workflows/ci.yml),
using this package's Node/upm toolchain. It runs on pushes to `main`, pull requests,
merge groups, and manual dispatch. Use **`ci-ok`** as the required status check;
it succeeds only when all blocking jobs succeed.

Lint, source type checking, runtime tests, and building run independently. The
build job also checks schema generation and emitted declarations, then creates
and verifies one tarball. Consumer jobs download that same archive, verify its
SHA-256, and run the Web-API smoke test on Linux and Windows with Node.js 22 and 24. Those jobs install no development dependencies. The archive, checksum, and
size report are retained as the `igdb-packed` workflow artifact for seven days.

Workflow permissions default to none; jobs that read the repository receive only
`contents: read`. Third-party actions are pinned to commit SHAs. A shared setup
action installs the pinned tools and uses the frozen lockfile with a download
cache. Preview publishing, release automation, automatic fixes, and PR comments
from the reference repository are not enabled here.

## Package contents and zero runtime dependencies

The package ships `dist/index.js`, `dist/index.d.ts`, `package.json`, `README.md`,
`LICENSE`, and `THIRD_PARTY_NOTICES.md`. Schema snapshots, generators, tests,
configuration files, and development tools are excluded from the tarball.
The client is ESM-only with a single root export and `sideEffects: false`.

tsdown rejects bundled and external package dependencies. `pack:check` additionally
examines the actual `npm pack` tarball, rejects runtime/peer/optional/bundled
dependency declarations, verifies the published files and exports, and checks the
ESM bundle has no static imports. Its isolated VM blocks dynamic imports and runs
a fluent query with injected fetch and Web APIs, without Node-specific globals.
This is a portability smoke test; it does not emulate all Cloudflare behavior.
The verification command uses Node's `--experimental-vm-modules` flag only for
this development check; the shipped client does not require it.

The check prints the raw and gzip runtime sizes, declaration size, and tarball
size separately. These figures describe different costs; the large generated
type declarations do not become JavaScript runtime data.

## Create an artifact without publishing

After checks pass, create a tarball for local installation or review:

```sh
upm run check
npm pack --ignore-scripts
```

The second command packs the already verified build. A normal `npm pack` also
works and invokes `prepack` to rebuild first. No network credentials are needed.

The manually dispatched **Package artifact** GitHub workflow runs the same checks
and uses `danielroe/uppt/pack` v0.6.11, pinned to commit
`6ec27140623aa835e362f866d8ab0018ab057f4d`, to upload a tarball as a workflow
artifact. It has only `contents: read`; it does not create release PRs, tags,
GitHub releases, staged npm releases, or public npm releases. The action's own
installer is disabled because the workflow installs with upm first.

## Future publication, only when explicitly authorized

No publication should be performed as part of the current implementation.
When publication is separately approved:

1. Confirm the `@liry24/igdb` name and scope ownership, the repository metadata,
   version, license, README examples, and passing checks on the exact commit.
2. Create and inspect the tarball using the commands above. Authenticate with the
   npm account that owns the scope, without committing an npm token.
3. Publish that reviewed tarball with public access, completing npm's account and
   two-factor authorization prompts. Publishing is an external write and is not
   included in any current script or workflow.
4. Confirm the registry contents before tagging the matching source as `v0.1.0`.

After the first package exists, future release automation can be introduced in a
separate reviewed change. A possible setup is uppt with a dedicated workflow,
GitHub environment, and npm Trusted Publisher configured for the exact owner,
repository, workflow filename, and environment. OIDC and `npm stage publish`
permissions should be added only when that workflow is enabled. Stable staged
releases require npm-side approval before becoming public. None of that setup is
active in this repository.

## Official references

- [upm installation, lockfiles, and current limits](https://github.com/unjs/upm)
- [tsrs usage](https://github.com/oxc-project/tsrs/blob/main/docs/USAGE.md)
- [tsrs compatibility](https://github.com/oxc-project/tsrs/blob/main/docs/COMPATIBILITY.md)
- [Official tsrs WebAssembly package](https://github.com/oxc-project/tsrs/blob/main/npm/tsrs-wasm/README.md)
- [tsdown declaration generation](https://tsdown.dev/options/dts)
- [tsdown dependency restrictions](https://tsdown.dev/options/dependencies)
- [uppt packaging action](https://github.com/danielroe/uppt/tree/v0.6.11/pack)
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
- [npm staged publishing](https://docs.npmjs.com/staged-publishing/)
