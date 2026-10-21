import { endpoints } from "./endpoints.js";
import { createQuery, type IgdbQuery } from "./query.js";
import type { Endpoint } from "./schema.js";
import { createTransport, type IgdbClientOptions } from "./transport.js";

export interface IgdbClient {
  /** Choose an IGDB v4 endpoint. This does not perform any network I/O. */
  query<E extends Endpoint>(endpoint: E): IgdbQuery<E>;
}

/** Create a zero-dependency IGDB client using a token or Twitch client secret. */
export function createIgdbClient(options: IgdbClientOptions): IgdbClient {
  const transport = createTransport(options);
  return {
    query<E extends Endpoint>(endpoint: E): IgdbQuery<E> {
      if (typeof endpoint !== "string" || !endpoints.includes(endpoint)) {
        throw new TypeError("Unknown IGDB endpoint.");
      }
      return createQuery(endpoint, transport);
    },
  };
}
