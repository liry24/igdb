import { describe, expect, it } from "vitest";
import {
  and,
  arrayContains,
  arrayOverlaps,
  asc,
  createFields,
  desc,
  eq,
  escapeString,
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
  serializeOrder,
  serializePredicate,
  type FieldRef,
  type OrderExpr,
  type Predicate,
} from "../src/expressions.js";

const games = createFields("games");

describe("typed APICalypse expressions", () => {
  it("preserves logical grouping and omits optional conditions", () => {
    const condition = and(
      gte(games.rating, 80),
      undefined,
      or(eq(games.game_type, 0), arrayOverlaps(games.platforms, [6, 48])),
    );
    expect(serializePredicate(condition, "games")).toBe(
      "(rating >= 80 & (game_type = 0 | platforms = (6,48)))",
    );
    expect(serializePredicate(and(undefined, eq(games.id, 1)), "games")).toBe("id = 1");
    expect(and()).toBeUndefined();
    expect(or(undefined, undefined)).toBeUndefined();
  });

  it("serializes each comparison and null predicate", () => {
    const cases = [
      [eq(games.name, "Zelda"), 'name = "Zelda"'],
      [ne(games.id, 1), "id != 1"],
      [gt(games.rating, 85), "rating > 85"],
      [gte(games.rating, 85), "rating >= 85"],
      [lt(games.rating, 90), "rating < 90"],
      [lte(games.rating, 90), "rating <= 90"],
      [isNull(games.cover), "cover = null"],
      [isNotNull(games.genres), "genres != null"],
      [eq(games.cover.alpha_channel, false), "cover.alpha_channel = false"],
    ] as const;
    for (const [condition, expected] of cases) {
      expect(serializePredicate(condition, "games")).toBe(expected);
    }
  });

  it("escapes user text inside a single APICalypse string value", () => {
    const value = 'a"; limit 500;\\\nnext\t';
    const expected = '"a\\"; limit 500;\\\\\\nnext\\t"';
    expect(escapeString(value)).toBe(expected);
    expect(serializePredicate(eq(games.name, value), "games")).toBe(`name = ${expected}`);
  });

  it("separates scalar membership, all array values, and any array value", () => {
    expect(serializePredicate(inArray(games.id, [1, 2]), "games")).toBe("id = (1,2)");
    expect(serializePredicate(notInArray(games.id, [1, 2]), "games")).toBe("id != (1,2)");
    expect(serializePredicate(arrayContains(games.platforms, [6, 48]), "games")).toBe(
      "platforms = [6,48]",
    );
    expect(serializePredicate(arrayOverlaps(games.platforms, [6, 48]), "games")).toBe(
      "platforms = (6,48)",
    );
    expect(serializePredicate(inArray(games.name, ['a"b', "c"]), "games")).toBe(
      'name = ("a\\"b","c")',
    );
  });

  it("uses explicit tautologies and contradictions for empty scalar lists", () => {
    expect(serializePredicate(inArray(games.id, []), "games")).toBe("(id = 0 & id != 0)");
    expect(serializePredicate(notInArray(games.id, []), "games")).toBe("(id = 0 | id != 0)");
    expect(serializePredicate(and(eq(games.name, "Zelda"), inArray(games.id, [])), "games")).toBe(
      '(name = "Zelda" & (id = 0 & id != 0))',
    );
    expect(() => arrayContains(games.platforms, [])).toThrow(RangeError);
    expect(() => arrayOverlaps(games.platforms, [])).toThrow(RangeError);
  });

  it("takes a snapshot of list values when a condition is created", () => {
    const ids = [1, 2];
    const condition = inArray(games.id, ids);
    ids.push(3);
    expect(serializePredicate(condition, "games")).toBe("id = (1,2)");
  });

  it("uses relation paths and preserves the endpoint context", () => {
    const condition = and(
      eq(games.cover.image_id, "co123"),
      arrayOverlaps(games.release_dates.platform, [6]),
      gt(games.release_dates.date, 631152000),
    );
    expect(serializePredicate(condition, "games")).toBe(
      '(cover.image_id = "co123" & release_dates.platform = (6) & release_dates.date > 631152000)',
    );
    expect(serializeOrder(asc(games.name), "games")).toBe("name asc");
    expect(serializeOrder(desc(games.release_dates.date), "games")).toBe("release_dates.date desc");
  });

  it("allows conditions from another query for the same endpoint", () => {
    const anotherGames = createFields("games");
    expect(serializePredicate(and(eq(games.id, 1), eq(anotherGames.name, "Zelda")), "games")).toBe(
      '(id = 1 & name = "Zelda")',
    );
  });

  it("rejects references and conditions from another endpoint", () => {
    const platforms = createFields("platforms");
    expect(() => and(eq(games.id, 1), eq(platforms.id, 1))).toThrow(/different IGDB endpoints/);
    expect(() => serializePredicate(eq(platforms.id, 1), "games")).toThrow(
      /different IGDB endpoint/,
    );
    expect(() => serializeOrder(desc(platforms.name), "games")).toThrow(/different IGDB endpoint/);
  });

  it("rejects forged references, strings, clones, and expression kind confusion", () => {
    const reference = { endpoint: "games", path: "id" } as unknown as FieldRef<"games", number>;
    expect(() => eq(reference, 1)).toThrow(TypeError);
    expect(() => eq(games as unknown as FieldRef<"games", number>, 1)).toThrow(TypeError);
    expect(() => serializePredicate("id = 1" as unknown as Predicate<"games">, "games")).toThrow(
      TypeError,
    );
    const condition = eq(games.id, 1);
    expect(Object.isFrozen(condition)).toBe(true);
    expect(() => serializePredicate({ ...condition }, "games")).toThrow(TypeError);
    expect(() => serializeOrder(condition as unknown as OrderExpr<"games">, "games")).toThrow(
      TypeError,
    );
    expect(() => and(null as unknown as Predicate<"games">)).toThrow(TypeError);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects a non-finite value (%s) in comparisons and lists",
    (value) => {
      expect(() => eq(games.id, value)).toThrow(TypeError);
      expect(() => inArray(games.id, [1, value])).toThrow(TypeError);
      expect(() => arrayOverlaps(games.platforms, [value])).toThrow(TypeError);
    },
  );

  it("rejects values that would require implicit object coercion", () => {
    for (const value of [null, undefined, {}, 1n, Symbol("value")]) {
      expect(() => eq(games.name, value as string)).toThrow(TypeError);
    }
    expect(() => inArray(games.id, "1,2" as unknown as number[])).toThrow(TypeError);
    const sparseValues: number[] = [];
    sparseValues.length = 2;
    expect(() => inArray(games.id, sparseValues)).toThrow(TypeError);
    expect(() => escapeString(undefined as unknown as string)).toThrow(TypeError);
  });

  it("enforces numeric operators for JavaScript callers as well", () => {
    for (const compare of [gt, gte, lt, lte]) {
      for (const value of ["80", true, null, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(() => compare(games.rating, value as number)).toThrow(/finite number/);
      }
    }
  });

  it("does not turn a field tree into a thenable or allow injected field paths", () => {
    expect(Reflect.get(games, "then")).toBeUndefined();
    expect(() => Reflect.get(games, "id; limit 500")).toThrow(TypeError);
    expect(games.cover.image_id).toBe(games.cover.image_id);
  });
});
