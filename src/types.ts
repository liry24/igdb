import type { FieldRef } from './expressions.js'
import type { Endpoint, EndpointMap } from './schema.js'

type Defined<T> = Exclude<T, null | undefined>
type Element<T> = T extends readonly (infer Item)[] ? Item : T
type RelatedEntity<T> = Extract<Element<Defined<T>>, { id: number }>

/** The JSON value of a field before its related entity is expanded. */
type Unexpanded<T> = T extends readonly (infer Item)[]
    ? Item extends object
        ? never
        : T
    : T extends object
      ? never
      : T

type IsMany<T> = Defined<T> extends readonly unknown[] ? true : false
type NextMany<Many extends boolean, T> = Many extends true ? true : IsMany<T>

type FieldTree<E extends Endpoint, T, Many extends boolean> = {
    readonly [Key in keyof T]-?: FieldRef<E, Defined<Unexpanded<T[Key]>>, Many> &
        ([RelatedEntity<T[Key]>] extends [never]
            ? unknown
            : FieldTree<E, RelatedEntity<T[Key]>, NextMany<Many, T[Key]>>)
}

/**
 * References for every filterable field of an endpoint, independent of the
 * response selection. Related fields are resolved only as they are accessed.
 */
export type EndpointFields<E extends Endpoint> = FieldTree<E, EndpointMap[E], false>

type ValidatePath<T, Path extends string> = string extends Path
    ? never
    : Path extends '*'
      ? Path
      : Path extends `${infer Key}.${infer Tail}`
        ? Key extends keyof T
            ? [RelatedEntity<T[Key]>] extends [never]
                ? never
                : [ValidatePath<RelatedEntity<T[Key]>, Tail>] extends [never]
                  ? never
                  : Path
            : never
        : Path extends keyof T
          ? Path
          : never

type IsUnion<T, Whole = T> = T extends Whole ? ([Whole] extends [T] ? false : true) : never

/** Validate the supplied literal paths without enumerating every schema path. */
export type ValidateFields<E extends Endpoint, Paths extends readonly string[]> =
    IsUnion<Paths> extends true
        ? never
        : {
              [Index in keyof Paths]: IsUnion<Paths[Index]> extends true
                  ? never
                  : ValidatePath<EndpointMap[E], Paths[Index]>
          }

type Head<Path extends string> = Path extends `${infer Key}.${string}` ? Key : Path
type NestedPaths<Paths extends string, Key extends string> = Paths extends `${Key}.${infer Tail}` ? Tail : never

type SelectedKeys<T, Selection extends string> = Extract<
    '*' extends Selection ? keyof T : Head<Selection> | 'id',
    keyof T
>

type ExpandedValue<T, Selection extends string> =
    IsMany<T> extends true ? ProjectEntity<RelatedEntity<T>, Selection>[] : ProjectEntity<RelatedEntity<T>, Selection>

type SelectedValue<T, Selection extends string> = [Selection] extends [never]
    ? Unexpanded<T>
    : ExpandedValue<T, Selection>

type ProjectEntity<T, Selection extends string> = {
    [Key in keyof Pick<T, SelectedKeys<T, Selection>>]: SelectedValue<
        T[Key],
        NestedPaths<Selection, Extract<Key, string>>
    >
}

/**
 * One returned entity. IGDB includes id at each expanded object; other selected
 * properties remain optional because the API omits unavailable data.
 */
export type QueryResult<E extends Endpoint, Selection extends string = 'id'> = ProjectEntity<EndpointMap[E], Selection>
