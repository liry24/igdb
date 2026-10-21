import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const schemaUrl = "https://api.igdb.com/v4/igdbapi.proto";
const docsUrl = "https://api-docs.igdb.com/";
const args = new Set(process.argv.slice(2));

if ([...args].some((arg) => arg !== "--check" && arg !== "--update")) {
  throw new Error("Usage: node scripts/generate-schema.ts [--check | --update]");
}
if (args.has("--check") && args.has("--update")) {
  throw new Error("--check cannot be combined with --update");
}

interface EndpointSource {
  entity: string;
  endpoint: string;
}

interface SourceMetadata {
  schemaUrl: string;
  docsUrl: string;
  retrievedAt: string;
  schemaSha256: string;
  endpointsSha256: string;
  notes: string[];
}

interface ProtoField {
  repeated: boolean;
  type: string;
  name: string;
  deprecated: boolean;
}

const hash = (source: string): string => createHash("sha256").update(source).digest("hex");
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Cannot fetch ${url}: HTTP ${response.status}`);
  return response.text();
}

if (args.has("--update")) {
  const [schema, docs] = await Promise.all([fetchText(schemaUrl), fetchText(docsUrl)]);
  const section = docs.match(/<h1 id=["']endpoints["']>[^]*?(?=<h1\b)/)?.[0];
  if (!section) throw new Error("Official endpoint documentation section was not found");

  const endpoints: EndpointSource[] = [];
  for (const match of section.matchAll(/<h2\b[^>]*>([^]*?)<\/h2>([^]*?)(?=<h[12]\b|$)/g)) {
    const entity = match[1]?.replace(/<[^>]*>/g, "").replace(/\s/g, "");
    const endpoint = match[2]?.match(/https:\/\/api\.igdb\.com\/v4\/([a-z0-9_]+)/)?.[1];
    if (!entity || !endpoint) throw new Error("An official endpoint could not be parsed");
    endpoints.push({ entity, endpoint });
  }
  if (endpoints.length === 0) throw new Error("Official endpoint documentation was empty");

  const endpointJson = json(endpoints);
  const metadata: SourceMetadata = {
    schemaUrl,
    docsUrl,
    retrievedAt: new Date().toISOString(),
    schemaSha256: hash(schema),
    endpointsSha256: hash(endpointJson),
    notes: [
      "Entity fields come from the official IGDB v4 protobuf schema; these are JSON response types, not protobuf codecs.",
      "Endpoint names come from the official endpoint documentation and are checked against protobuf result messages.",
      "Undocumented entity messages are retained for referenced field types but do not become supported endpoints.",
    ],
  };
  await mkdir(new URL("schema/", root), { recursive: true });
  await writeFile(new URL("schema/igdbapi.proto", root), schema);
  await writeFile(new URL("schema/endpoints.json", root), endpointJson);
  await writeFile(new URL("schema/source.json", root), json(metadata));
}

const [rawSchema, endpointJson, sourceJson] = await Promise.all([
  readFile(new URL("schema/igdbapi.proto", root), "utf8"),
  readFile(new URL("schema/endpoints.json", root), "utf8"),
  readFile(new URL("schema/source.json", root), "utf8"),
]);
const metadata = JSON.parse(sourceJson) as SourceMetadata;
const endpoints = JSON.parse(endpointJson) as EndpointSource[];
if (hash(rawSchema) !== metadata.schemaSha256 || hash(endpointJson) !== metadata.endpointsSha256) {
  throw new Error(
    "Schema snapshot fingerprint mismatch; use --update to refresh from official sources",
  );
}
if (metadata.schemaUrl !== schemaUrl || metadata.docsUrl !== docsUrl) {
  throw new Error("Schema source URLs do not match the official IGDB sources");
}

const schema = rawSchema.replace(/\/\*[^]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const messages = new Map<string, ProtoField[]>();
const enums = new Map<string, { values: number[]; deprecated: boolean }>();

// The current official schema contains flat messages and enums. Fail on new syntax
// instead of silently omitting fields when upstream introduces new constructs.
for (const match of schema.matchAll(/\b(message|enum)\s+(\w+)\s*\{([^{}]*)\}/g)) {
  const [, kind, name, body] = match;
  if (!name || !body) throw new Error("An empty protobuf declaration was encountered");
  const statements = body
    .split(";")
    .map((line) => line.trim())
    .filter(Boolean);
  if (kind === "enum") {
    const values: number[] = [];
    let deprecated = true;
    for (const statement of statements) {
      const value = statement.match(/^\w+\s*=\s*(-?\d+)\s*(?:\[\s*deprecated\s*=\s*true\s*\])?$/);
      if (!value) throw new Error(`Unsupported protobuf enum member in ${name}: ${statement}`);
      values.push(Number(value[1]));
      deprecated &&= /deprecated\s*=\s*true/.test(statement);
    }
    enums.set(name, { values: [...new Set(values)], deprecated });
    continue;
  }

  const fields: ProtoField[] = statements.map((statement) => {
    const field = statement.match(
      /^(repeated\s+)?([\w.]+)\s+(\w+)\s*=\s*\d+\s*(?:\[\s*deprecated\s*=\s*true\s*\])?$/,
    );
    if (!field?.[2] || !field[3]) {
      throw new Error(`Unsupported protobuf field in ${name}: ${statement}`);
    }
    return {
      repeated: Boolean(field[1]),
      type: field[2],
      name: field[3],
      deprecated: /deprecated\s*=\s*true/.test(statement),
    };
  });
  messages.set(name, fields);
}

const declarations = [...schema.matchAll(/\b(?:message|enum)\s+\w+\s*\{/g)].length;
if (messages.size + enums.size !== declarations) {
  throw new Error("Unsupported nested protobuf declaration; update the schema generator");
}

const entities = new Map(
  [...messages].filter(([, fields]) => fields.some((field) => field.name === "id")),
);
const documentedEntities = new Set(endpoints.map(({ entity }) => entity));
const endpointNames = new Set<string>();
for (const { entity, endpoint } of endpoints) {
  if (endpointNames.has(endpoint) || !/^[a-z][a-z0-9_]*$/.test(endpoint)) {
    throw new Error(`Duplicate or invalid endpoint: ${endpoint}`);
  }
  endpointNames.add(endpoint);
  const result = messages.get(`${entity}Result`);
  const field = result?.[0];
  if (!entities.has(entity) || result?.length !== 1 || !field?.repeated || field.type !== entity) {
    throw new Error(`Documented endpoint ${endpoint} has no matching protobuf result message`);
  }
  if (endpoint !== "search" && field.name !== endpoint.replaceAll("_", "")) {
    throw new Error(`Endpoint name ${endpoint} disagrees with protobuf result field ${field.name}`);
  }
}

const scalarTypes: Record<string, string> = {
  string: "string",
  bool: "boolean",
  bytes: "string",
  double: "number",
  float: "number",
  int32: "number",
  uint32: "number",
  int64: "number",
  uint64: "number",
  sint32: "number",
  sint64: "number",
  fixed32: "number",
  fixed64: "number",
  sfixed32: "number",
  sfixed64: "number",
  "google.protobuf.Timestamp": "number",
};

function fieldType(field: ProtoField): string {
  const scalar = scalarTypes[field.type];
  if (scalar) return field.repeated ? `${scalar}[]` : scalar;
  if (enums.has(field.type)) return field.repeated ? `${field.type}[]` : field.type;
  if (entities.has(field.type)) {
    return field.repeated ? `number[] | ${field.type}[]` : `number | ${field.type}`;
  }
  throw new Error(`Unknown referenced protobuf field type: ${field.type}`);
}

const output = [
  "// Generated by scripts/generate-schema.ts. Do not edit manually.",
  `// Source: ${schemaUrl}`,
  `// Schema SHA-256: ${metadata.schemaSha256}`,
  "// JSON timestamps are Unix seconds. Relations are IDs unless explicitly expanded.",
  "// Only id is guaranteed; other properties may be absent even when requested.",
  "",
];
for (const [name, { values, deprecated }] of enums) {
  if (deprecated)
    output.push("/** @deprecated IGDB is migrating enum fields to related entity tables. */");
  output.push(`export type ${name} = ${values.join(" | ")};`, "");
}
for (const [name, fields] of entities) {
  if (!documentedEntities.has(name)) {
    output.push("/** @internal Present in the official schema; no documented public endpoint. */");
  }
  output.push(`export interface ${name} {`);
  for (const field of fields) {
    if (field.deprecated)
      output.push("  /** @deprecated Marked deprecated in the official IGDB schema. */");
    output.push(`  ${field.name}${field.name === "id" ? "" : "?"}: ${fieldType(field)};`);
  }
  output.push("}", "");
}
output.push(
  "/** Officially documented IGDB v4 endpoints and their JSON entity types. */",
  "export interface EndpointMap {",
);
for (const { entity, endpoint } of endpoints) output.push(`  ${endpoint}: ${entity};`);
output.push("}", "", "export type Endpoint = keyof EndpointMap;", "");

const endpointOutput = [
  "// Generated by scripts/generate-schema.ts. Do not edit manually.",
  'import type { Endpoint } from "./schema.js";',
  "",
  "/** Small runtime allowlist; field schemas are type-only. */",
  "export const endpoints: readonly Endpoint[] = [",
  ...endpoints.map(({ endpoint }) => `  ${JSON.stringify(endpoint)},`),
  "];",
  "",
].join("\n");

const generatedFiles = new Map([
  ["src/schema.ts", output.join("\n")],
  ["src/endpoints.ts", endpointOutput],
]);
for (const [path, generated] of generatedFiles) {
  const target = new URL(path, root);
  if (args.has("--check")) {
    const existing = await readFile(target, "utf8");
    // oxfmt can wrap unions and add a leading | without changing their meaning.
    const normalize = (value: string): string => value.replace(/\s+/g, "").replace(/=\|/g, "=");
    if (normalize(existing) !== normalize(generated)) {
      throw new Error(`${path} is stale; run node scripts/generate-schema.ts`);
    }
  } else {
    await mkdir(new URL("src/", root), { recursive: true });
    await writeFile(target, generated);
  }
}
console.log(
  `${args.has("--check") ? "Verified" : "Generated"} ${entities.size} entity types and ${endpoints.length} documented endpoints.`,
);
