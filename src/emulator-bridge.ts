import type { Endpoint } from './schema.js'
import type { RequestOptions } from './transport.js'

export type Scalar = string | number | boolean

export type PredicateAst =
    | {
          readonly kind: 'compare'
          readonly path: string
          readonly op: '=' | '!=' | '>' | '>=' | '<' | '<='
          readonly value: Scalar
      }
    | {
          readonly kind: 'and' | 'or'
          readonly children: readonly PredicateAst[]
      }
    | {
          readonly kind: 'in' | 'notIn' | 'arrayContains' | 'arrayOverlaps'
          readonly path: string
          readonly values: readonly Scalar[]
      }
    | {
          readonly kind: 'isNull' | 'isNotNull'
          readonly path: string
      }
    | {
          readonly kind: 'const'
          readonly value: boolean
      }

export interface OrderAst {
    readonly path: string
    readonly direction: 'asc' | 'desc'
}

export interface QueryPlan {
    readonly endpoint: Endpoint
    readonly fields: readonly string[]
    readonly where?: PredicateAst | undefined
    readonly orderBy?: OrderAst | undefined
    readonly search?: string | undefined
    readonly limit?: number | undefined
    readonly offset?: number | undefined
}

export type EmulatorExecutor = (
    plan: QueryPlan,
    query: string,
    options: RequestOptions | undefined,
    signal: AbortSignal,
) => Promise<unknown>

declare const emulatorBrand: unique symbol

/** Opaque emulator adapter accepted by createIgdbClient({ emulator }). */
export interface IgdbEmulator {
    readonly [emulatorBrand]: true
}
