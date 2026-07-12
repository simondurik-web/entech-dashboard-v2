import { validateSql } from "@/lib/codex-api/validate-sql"

/**
 * MCP-specific SQL guard. The dedicated read-only role (mcp_query_reader) is
 * the real boundary; this is defense-in-depth that (a) reuses the shared
 * codex validator and (b) blocks a few extra function-call vectors a reviewer
 * flagged — set_config/query_to_xml can smuggle role changes or dynamic SQL
 * past a keyword-only scan.
 */
// Exact-name blocks.
const EXTRA_FORBIDDEN = [
  "set_config", // set_config('role', …) — role reversion
  "database_to_xml",
  "schema_to_xml",
  "to_regclass", // probing object existence past the grant
  "to_regprocedure",
  "current_setting", // can read GUCs; pair of set_config
]

// Pattern blocks — whole families via prefix, so variants can't slip an
// exact-name list (a reviewer showed pg_try_advisory_lock_shared and
// dblink_connect evading `\bname\b`). Trailing `\w*` catches name-prefixed
// variants.
const FORBIDDEN_PATTERNS: RegExp[] = [
  /\bpg_\w*advisory\w*/i, // all pg_advisory* / pg_try_advisory* variants
  /\bpg_sleep\w*/i,
  /\bpg_\w*(read_file|read_binary_file|ls_dir|stat_file|ls_logdir|ls_waldir)\w*/i,
  /\bpg_(terminate|cancel)_backend\w*/i,
  /\bpg_logical\w*/i,
  /\bpg_read_server_files\w*/i,
  /\blo_\w+/i, // lo_import/export/get/put/from_bytea/… (large-object API)
  /\bdblink\w*/i, // dblink, dblink_connect, dblink_exec, …
  /\bquery_to_xml\w*/i, // query_to_xml / _and_xmlschema — runs arbitrary SQL text
  /\bhttp\w*\s*\(/i, // http / http_get / http_post (http extension: SSRF/exfil)
  /\bpg_net\w*/i, // pg_net async HTTP
  // System-catalog probing: role/password catalogs + function-source.
  // pg_authid/pg_shadow are also DB-denied; this stops role mapping and
  // reading SECURITY DEFINER bodies.
  /\bpg_(authid|shadow|proc|roles|user|auth_members|user_mappings|statistic|largeobject|settings)\w*/i,
  /\bpg_catalog\b/i,
  /\binformation_schema\s*\.\s*(routines|parameters|role_\w+)\b/i, // fn source / role grants
  // Server-side value/array bombs — no legit business query needs these; they
  // build a huge value/array in DB memory before any output cap applies
  // (statement_timeout is the only backstop). Block outright.
  /\brepeat\s*\(/i,
  /\b(lpad|rpad)\s*\(/i,
  /\barray_fill\s*\(/i,
]

// A single Postgres-aware lexical pass that yields ONLY the code tokens the
// pattern scan should see — with string/dollar-quote CONTENTS removed, line
// and NESTED block comments removed, and whitespace collapsed. Doing all of it
// in one scanner is the only correct way: piecemeal regexes get fooled by a
// comment marker inside a string (`SELECT '--', repeat(…)`) or a nested block
// comment (`repeat/*a/*b*/c*/(…)`), both of which PG treats very differently
// from a naive stripper. Identifiers (incl. double-quoted) are KEPT so table
// and function names remain scannable.
function normalizeForScan(sql: string): string {
  let out = ""
  let i = 0
  const n = sql.length
  let commentDepth = 0
  while (i < n) {
    const c = sql[i]
    const d = sql[i + 1]
    if (commentDepth > 0) {
      if (c === "/" && d === "*") { commentDepth++; i += 2; continue }
      if (c === "*" && d === "/") { commentDepth--; i += 2; if (commentDepth === 0) out += " "; continue }
      i++
      continue
    }
    // Enter block comment (nesting tracked above).
    if (c === "/" && d === "*") { commentDepth = 1; i += 2; continue }
    // Line comment → skip to newline.
    if (c === "-" && d === "-") { while (i < n && sql[i] !== "\n") i++; out += " "; continue }
    // Unicode-escaped identifier: U&"\0072\0065..." resolves to "repeat".
    // Decode \XXXX / \+XXXXXX so the real name is scanned. A trailing
    // `UESCAPE 'x'` clause changes the escape char from \ to x.
    if ((c === "U" || c === "u") && d === "&" && sql[i + 2] === '"') {
      i += 3
      let ident = ""
      while (i < n) {
        if (sql[i] === '"' && sql[i + 1] === '"') { ident += '"'; i += 2; continue }
        if (sql[i] === '"') { i++; break }
        ident += sql[i]
        i++
      }
      // Optional UESCAPE 'x'.
      let esc = "\\"
      const rest = sql.slice(i)
      const uesc = rest.match(/^\s*UESCAPE\s*'(.)'/i)
      if (uesc) {
        esc = uesc[1]
        i += uesc[0].length
      }
      const e = esc.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")
      const decoded = ident
        .replace(new RegExp(`${e}\\+([0-9A-Fa-f]{6})`, "g"), (_m, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(new RegExp(`${e}([0-9A-Fa-f]{4})`, "g"), (_m, h) => String.fromCodePoint(parseInt(h, 16)))
      out += ` ${decoded} `
      continue
    }
    // Unicode-escaped string U&'…' → drop contents (it's string data).
    if ((c === "U" || c === "u") && d === "&" && sql[i + 2] === "'") {
      i += 3
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue }
        if (sql[i] === "'") { i++; break }
        i++
      }
      out += " '' "
      continue
    }
    // Double-quoted identifier ("" escapes the quote). DECODE it to its real
    // name and emit that — `"repeat"(…)` is a valid call to repeat(), so an
    // opaque placeholder would hide it. Contents can't be re-interpreted as
    // comments here because we're emitting into the already-lexed output.
    if (c === '"') {
      i++
      let ident = ""
      while (i < n) {
        if (sql[i] === '"' && sql[i + 1] === '"') { ident += '"'; i += 2; continue }
        if (sql[i] === '"') { i++; break }
        ident += sql[i]
        i++
      }
      out += ` ${ident} `
      continue
    }
    // Single-quoted string literal → drop contents. Handles both standard
    // strings ('' escapes the quote) and escape strings (E'…' where a
    // backslash also escapes), detected by a preceding e/E word char.
    if (c === "'") {
      const isEscapeString = /[eE]$/.test(out) && !/[A-Za-z0-9_][eE]$/.test(out)
      i++
      while (i < n) {
        if (isEscapeString && sql[i] === "\\") { i += 2; continue }
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue }
        if (sql[i] === "'") { i++; break }
        i++
      }
      out += " '' "
      continue
    }
    // Dollar-quoted string ($tag$ … $tag$) → drop contents.
    if (c === "$") {
      const tag = sql.slice(i).match(/^\$[A-Za-z_0-9]*\$/)
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length)
        i = end === -1 ? n : end + tag[0].length
        out += " '' "
        continue
      }
    }
    out += c
    i++
  }
  return out
    .replace(/\s+/g, " ")
    .replace(/\s*\(/g, "(") // tighten "fn ( args" → "fn(args"
    .toLowerCase()
}

export function guardQuery(sql: string): { ok: true } | { ok: false; reason: string } {
  const base = validateSql(sql)
  if (!base.ok) return base
  const scan = normalizeForScan(sql)
  for (const fn of EXTRA_FORBIDDEN) {
    const re = new RegExp(`\\b${fn.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i")
    if (re.test(scan)) return { ok: false, reason: `forbidden function: ${fn}` }
  }
  for (const re of FORBIDDEN_PATTERNS) {
    const m = scan.match(re)
    if (m) return { ok: false, reason: `forbidden function: ${m[0]}` }
  }
  return { ok: true }
}

/**
 * Postgres errors can leak object names, paths, or attacker-chosen values
 * embedded in cast/function errors. Return a short, safe category to the AI
 * plus a targeted hint — never the raw driver message.
 */
export function sanitizeQueryError(raw: string): { error: string; hint: string } {
  const m = raw.toLowerCase()
  if (/permission denied/.test(m)) {
    return {
      error: "Query rejected: that table or column is not readable by this connector.",
      hint: "Auth, token, user and audit tables are intentionally invisible. Use business tables — call describe_tables to see what's available.",
    }
  }
  if (/invalid input syntax for type (numeric|integer|bigint|double|date|timestamp)/.test(m)) {
    return {
      error: "Query failed: a value could not be cast to a number/date.",
      hint: "Many dashboard_orders columns are TEXT and blanks are EMPTY STRINGS, so a direct cast fails. Wrap the column: NULLIF(col,'')::numeric (or ::date), then retry — the data IS there.",
    }
  }
  if (/(relation|column) .* does not exist/.test(m)) {
    return {
      error: "Query failed: unknown table or column.",
      hint: "Call describe_tables for exact names (and its sqlGotchas). po_number is TEXT. Then retry — do not conclude the data is missing.",
    }
  }
  if (/(statement timeout|canceling statement)/.test(m)) {
    return {
      error: "Query failed: it took too long and was cancelled.",
      hint: "Add a WHERE clause or aggregate — avoid scanning or cross-joining whole tables.",
    }
  }
  if (/syntax error/.test(m)) {
    return { error: "Query failed: SQL syntax error.", hint: "Check the statement; single read-only SELECT/WITH only." }
  }
  return {
    error: "Query failed.",
    hint: "Rework the query (single read-only SELECT). Call describe_tables for the schema. The data is available — don't tell the user it's missing.",
  }
}
