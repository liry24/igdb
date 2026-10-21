# Third-party notices

## IGDB API Node and Node Apicalypse

This package is an independent TypeScript implementation of the IGDB HTTP API.
The following MIT-licensed projects were consulted as references:

- [twitchtv/igdb-api-node](https://github.com/twitchtv/igdb-api-node), reference
  commit `6d94b04a1d010329b1102943209aa10975f80552`.
- [twitchtv/node-apicalypse](https://github.com/twitchtv/node-apicalypse), reference
  commit `46b0075ae0ae33f2298aa3ff857a67a1a1e30c92`.

Their copyright and permission notices are retained below. This client does
not depend on either package at runtime and does not promise API compatibility.

### twitchtv/igdb-api-node

MIT License

Copyright (c) 2019 8 Dudes in a Garage

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

### twitchtv/node-apicalypse

MIT License

Copyright (c) 2019 IGDB.com

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Official IGDB API schema

`src/schema.ts` contains generated JSON response type declarations derived from
the official [IGDB v4 protobuf schema](https://api.igdb.com/v4/igdbapi.proto).
Public endpoint names come from the [official API documentation](https://api-docs.igdb.com/).

The source snapshot, retrieval date, SHA-256 fingerprints, and endpoint mapping
are recorded in `schema/`. Run `node scripts/generate-schema.ts --check` to
verify the generated output, or use `--update` to refresh both official sources.
Protocol buffer codecs and API data are not bundled with this package.

This package is not affiliated with or endorsed by IGDB or Twitch. Access to the
IGDB service and use of its data are governed by the service's own terms.
