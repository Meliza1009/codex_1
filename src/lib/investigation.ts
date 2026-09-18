// Pure investigation policy; no repository execution or model access.
export const issueKinds = ["module_resolution", "package_exports", "type_declaration", "logic_bug", "validation", "ui_state", "config", "api_change", "build_config", "documentation", "test_related", "unknown"] as const;
export type IssueAnalysis = {
  kinds: (typeof issueKinds)[number][];
  summary: string;
  expectedBehavior: string;
  observedBehavior: string;
  importantSymbols: string[];
  importantPaths: string[];
  errorMessages: string[];
  likelyEvidenceSurfaces: string[];
  maintainerClarifications: string[];
  reproductionDetails: string[];
  proposedApproaches: string[];
  constraints: string[];
};
export type MissingEvidence = { fact: string; whyNeeded: string };
export const stringList = { type: "array", maxItems: 20, items: { type: "string", maxLength: 2000 } };
export const analysisSchema = {
  type: "object", additionalProperties: false,
  required: ["kinds", "summary", "expectedBehavior", "observedBehavior", "importantSymbols", "importantPaths", "errorMessages", "likelyEvidenceSurfaces", "maintainerClarifications", "reproductionDetails", "proposedApproaches", "constraints"],
  properties: {
    kinds: { type: "array", minItems: 1, maxItems: 5, items: { type: "string", enum: issueKinds } },
    summary: { type: "string", minLength: 1 }, expectedBehavior: { type: "string", minLength: 1 }, observedBehavior: { type: "string" },
    importantSymbols: stringList, importantPaths: stringList, errorMessages: stringList, likelyEvidenceSurfaces: stringList,
    maintainerClarifications: stringList, reproductionDetails: stringList, proposedApproaches: stringList, constraints: stringList,
  },
};
type Schema = { type?: string; enum?: readonly unknown[]; required?: readonly string[]; properties?: Record<string, Schema>; additionalProperties?: boolean; items?: Schema; minItems?: number; maxItems?: number; minLength?: number; maxLength?: number; minimum?: number; maximum?: number };
export function conforms(value: unknown, schema: Schema): boolean {
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === "string") return typeof value === "string" && value.length >= (schema.minLength ?? 0) && value.length <= (schema.maxLength ?? 50000);
  if (schema.type === "number") return typeof value === "number" && Number.isFinite(value) && value >= (schema.minimum ?? -Infinity) && value <= (schema.maximum ?? Infinity);
  if (schema.type === "boolean") return typeof value === "boolean";
  if (schema.type === "array") return Array.isArray(value) && value.length >= (schema.minItems ?? 0) && value.length <= (schema.maxItems ?? 100) && value.every((item) => !schema.items || conforms(item, schema.items));
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const object = value as Record<string, unknown>;
    return (schema.required ?? []).every((key) => Object.hasOwn(object, key)) && Object.entries(object).every(([key, item]) => schema.properties?.[key] ? conforms(item, schema.properties[key]) : schema.additionalProperties !== false);
  }
  return true;
}
export function normalizeQuery(value: string): string | null {
  const query = value.trim().replace(/^["'`]|["'`]$/g, "").replace(/\((?:\.\.\.)?\)$/, "").replace(/\s+/g, " ");
  if (!query || query.length > 80 || query.split(" ").length > 8) return null;
  if (/^(index|package|source|src|file|code|test|build|config|readme)$/i.test(query)) return null;
  if (/[|\n\r]/.test(query)) return null;
  if (/^(search|inspect|read|find|locate|check|understand|the|whether|more|please)\b/i.test(query) || /\b(to understand|would|should|because|already|and then|need to)\b/i.test(query)) return null;
  return query;
}

export function proposedDiff(path: string, before: string, after: string) {
  const lines = (text: string) => text === "" ? [] : text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  const old = lines(before); const next = lines(after);
  let prefix = 0;
  while (prefix < old.length && prefix < next.length && old[prefix] === next[prefix]) prefix++;
  // Include the final line when only EOF newline changes.
  if (prefix === old.length && prefix === next.length && before.endsWith("\n") !== after.endsWith("\n")) prefix = Math.max(0, prefix - 1);
  let suffix = 0;
  while (before.endsWith("\n") === after.endsWith("\n") && suffix < old.length - prefix && suffix < next.length - prefix && old[old.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++;
  const start = Math.max(0, prefix - 3); const oldEnd = Math.min(old.length, old.length - suffix + 3); const newEnd = Math.min(next.length, next.length - suffix + 3);
  const output = [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, `@@ -${oldEnd - start ? start + 1 : start},${oldEnd - start} +${newEnd - start ? start + 1 : start},${newEnd - start} @@`];
  const push = (sign: string, text: string, finalWithoutNewline: boolean) => { output.push(sign + text); if (finalWithoutNewline) output.push("\\ No newline at end of file"); };
  for (let i = start; i < prefix; i++) push(" ", old[i], i === old.length - 1 && !before.endsWith("\n"));
  for (let i = prefix; i < old.length - suffix; i++) push("-", old[i], i === old.length - 1 && !before.endsWith("\n"));
  for (let i = prefix; i < next.length - suffix; i++) push("+", next[i], i === next.length - 1 && !after.endsWith("\n"));
  for (let i = old.length - suffix; i < oldEnd; i++) push(" ", old[i], i === old.length - 1 && !before.endsWith("\n"));
  return { diff: output.join("\n") + "\n", additions: next.length - prefix - suffix, deletions: old.length - prefix - suffix };
}
const surfaces: Record<string, RegExp> = {
  module_resolution: /package\.json$|tsconfig|\.d\.[cm]?ts$|(?:index|entry|lite)\.[cm]?[jt]s$|resolve|readme/i,
  package_exports: /package\.json$|\.d\.[cm]?ts$|rollup|tsup|exports|readme/i,
  type_declaration: /\.d\.[cm]?ts$|types|tsconfig|package\.json$/i,
  ui_state: /hook|provider|context|state|storage|component/i,
  validation: /schema|parser|validat|request|model/i,
  config: /config|package\.json$|\.ya?ml$/i,
  build_config: /config|package\.json$|rollup|webpack|vite|tsup/i,
  documentation: /readme|docs?\/|\.mdx?$/i,
  test_related: /test|spec|fixture/i,
  api_change: /api|routes?|index|\.d\.[cm]?ts$/i,
  logic_bug: /src\/|lib\/|test|spec/i,
};
export function repositoryStructure(paths: string[]) {
  const packages = paths.filter((path) => /(^|\/)package\.json$/.test(path));
  return { kind: packages.length > 1 ? "monorepo" : "single package", packages, source: paths.filter((p) => /(^|\/)(src|lib)\//.test(p)), tests: paths.filter((p) => /test|spec|fixture/i.test(p)), declarations: paths.filter((p) => /\.d\.[cm]?ts$/.test(p)), configuration: paths.filter((p) => /config|package\.json$|\.ya?ml$/.test(p)), generated: paths.filter((p) => /(^|\/)(dist|build|generated)\//.test(p)) };
}
export function relatedPaths(path: string, content: string, paths: string[]): string[] {
  const related = new Set<string>();
  for (const match of content.matchAll(/(?:from\s*|require\s*\(|import\s*\(|export\s*[^\n]*from\s*)["']([^"']+)["']/g)) {
    const reference = match[1];
    if (!reference.startsWith(".")) continue;
    const parts = [...path.split("/").slice(0, -1), ...reference.split("/")]; const normalized: string[] = [];
    for (const part of parts) { if (part === "..") normalized.pop(); else if (part !== ".") normalized.push(part); }
    const target = normalized.join("/").replace(/\.[cm]?js$/, "");
    paths.filter((p) => p === target || p.replace(/\.[cm]?[jt]sx?$/, "") === target || p.replace(/\/index\.[cm]?[jt]sx?$/, "") === target).forEach((p) => related.add(p));
  }
  const stem = path.split("/").pop()!.replace(/(?:\.d)?\.[^.]+$/, "");
  paths.filter((p) => p !== path && !/(^|\/)(bench|benchmark|bin|scripts)\//.test(p) && p.split("/").pop()!.replace(/(?:\.test|\.spec|\.d)?\.[^.]+$/, "") === stem).forEach((p) => related.add(p));
  // Package exports, declaration paths, and build entry points are observable references too.
  for (const match of content.matchAll(/["'](?:\.\/)?([^"'\s]+\.[cm]?[jt]sx?)["']/g)) {
    const prefix = path.split("/").slice(0, -1).join("/"); const candidate = [prefix, match[1]].filter(Boolean).join("/");
    if (paths.includes(candidate)) related.add(candidate);
  }
  return [...related];
}
export function candidateScore(path: string, analysis: IssueAnalysis, related: Set<string>, content = "") {
  let score = /(^|\/)(dist|build|generated)\//.test(path) ? -20 : 1;
  if (/(^|\/)(src|lib)\//.test(path)) score += 16;
  if (/\.d\.[cm]?ts$/.test(path)) score += 8;
  if (/(^|\/)package\.json$/.test(path)) score += 8;
  if (/(^|\/)(test|tests|__tests__)\//.test(path)) score += 5;
  if (/(^|\/)(bench|benchmark|bin|scripts)\//.test(path)) score -= 12;
  for (const mentioned of analysis.importantPaths) { if (path === mentioned || path.endsWith("/" + mentioned)) score += 25; else if (path.split("/").pop() === mentioned.split("/").pop()) score += 10; }
  for (const symbol of analysis.importantSymbols) { if (path.toLowerCase().includes(symbol.toLowerCase())) score += 10; if (content.includes(symbol)) score += 5; }
  for (const kind of analysis.kinds) if (surfaces[kind]?.test(path)) score += 8;
  if (related.has(path)) score += 20;
  if (/test|spec/i.test(path) && related.has(path)) score += 6;
  if (analysis.importantPaths.some((p) => p.includes("/") && path.startsWith(p.split("/").slice(0, -1).join("/") + "/"))) score += 4;
  return score;
}

// Normalize only harmless repository-relative spelling differences. Never guess by basename.
export function canonicalPath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^(\.\/)+/, "");
}
