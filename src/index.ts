export { createIgdbClient, type IgdbClient } from "./client.js";
export { IgdbError, type IgdbErrorCode, type IgdbErrorPhase } from "./errors.js";
export {
  and,
  arrayContains,
  arrayOverlaps,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notInArray,
  or,
  type FieldRef,
  type OrderExpr,
  type Predicate,
} from "./expressions.js";
export type { IgdbQuery } from "./query.js";
export type * from "./schema.js";
export type { IgdbClientOptions, RequestOptions } from "./transport.js";
export type { EndpointFields, QueryResult } from "./types.js";
