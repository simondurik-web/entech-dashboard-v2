// Node-side SQL validator for the /api/codex-query endpoint.
//
// This is defense-in-depth — the codex_reader Postgres role already
// can't write because it has no INSERT/UPDATE/DELETE/DDL grants. The
// validator catches things earlier with a clearer error and prevents
// expensive plans (e.g. cross joins on huge tables) before they hit
// the DB.

export type ValidateResult =
  | { ok: true; statementCount: number }
  | { ok: false; reason: string }

// Strip line comments + block comments + string literals (so the
// keyword scan doesn't false-positive on a customer name like
// "UPDATE Co LLC"). We replace with single spaces to keep tokens
// separable.
function stripCommentsAndStrings(sql: string): string {
  let out = ''
  let i = 0
  const len = sql.length
  while (i < len) {
    const c = sql[i]
    const next = sql[i + 1]
    // Line comment --
    if (c === '-' && next === '-') {
      while (i < len && sql[i] !== '\n') i++
      continue
    }
    // Block comment /* */
    if (c === '/' && next === '*') {
      i += 2
      while (i < len - 1 && !(sql[i] === '*' && sql[i + 1] === '/')) i++
      i += 2
      out += ' '
      continue
    }
    // Single-quoted string with '' escape
    if (c === "'") {
      i++
      while (i < len) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue }
        if (sql[i] === "'") { i++; break }
        i++
      }
      out += "''"
      continue
    }
    // Dollar-quoted string $tag$...$tag$
    if (c === '$') {
      const tagMatch = sql.slice(i).match(/^\$([A-Za-z_][A-Za-z_0-9]*)?\$/)
      if (tagMatch) {
        const tag = tagMatch[0]
        i += tag.length
        const endIdx = sql.indexOf(tag, i)
        if (endIdx === -1) { i = len; break }
        i = endIdx + tag.length
        out += '$$$$'
        continue
      }
    }
    // Identifier with double quotes — keep as-is (column/table names
    // can contain anything; we don't want to strip the identifier text
    // from forbidden-keyword consideration).
    if (c === '"') {
      out += c
      i++
      while (i < len) {
        if (sql[i] === '"' && sql[i + 1] === '"') { out += '""'; i += 2; continue }
        out += sql[i]
        if (sql[i] === '"') { i++; break }
        i++
      }
      continue
    }
    out += c
    i++
  }
  return out
}

// Forbidden keywords — keep this list strict. Even though the DB role
// can't write, blocking these gives clearer errors and prevents the
// caller from doing things like wrapping a write in a CTE that we'd
// rather not let through.
const FORBIDDEN = [
  'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'UPSERT',
  'DROP', 'TRUNCATE', 'ALTER', 'CREATE', 'COMMENT',
  'GRANT', 'REVOKE',
  'COPY',           // server-side file I/O
  'CALL', 'DO',     // executes arbitrary procedures
  'VACUUM', 'ANALYZE', 'CLUSTER', 'REINDEX',
  'LOCK',
  'NOTIFY', 'LISTEN', 'UNLISTEN',
  'SET ',           // session-level changes (extra space so it doesn't false-positive on SET in UPDATE)
  'RESET',
  'PREPARE', 'EXECUTE', 'DEALLOCATE',
  'BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT',
  'SECURITY DEFINER',
  'pg_read_server_files', 'pg_write_server_files',
  'pg_read_binary_file', 'lo_export', 'lo_import',
  'dblink', 'COPY_TO_PROGRAM',
]

export function validateSql(sql: string): ValidateResult {
  if (typeof sql !== 'string') return { ok: false, reason: 'query must be a string' }
  const trimmed = sql.trim()
  if (!trimmed) return { ok: false, reason: 'query is empty' }
  if (trimmed.length > 10_000) return { ok: false, reason: 'query too long (max 10000 chars)' }

  const stripped = stripCommentsAndStrings(trimmed)

  // Must start with SELECT or WITH (the only read-shaped statements).
  if (!/^\s*(SELECT|WITH)\b/i.test(stripped)) {
    return { ok: false, reason: 'only SELECT or WITH ... SELECT queries are allowed' }
  }

  // Reject statement-chaining. Split on `;` and require at most one
  // non-empty piece (allows trailing semicolon).
  const pieces = stripped.split(';').map((p) => p.trim()).filter(Boolean)
  if (pieces.length > 1) {
    return { ok: false, reason: 'only a single statement is allowed (no semicolons)' }
  }

  // Forbidden-keyword scan (whole-word, case-insensitive).
  const upper = stripped.toUpperCase()
  for (const kw of FORBIDDEN) {
    if (kw.endsWith(' ')) {
      if (upper.includes(kw)) return { ok: false, reason: `forbidden keyword: ${kw.trim()}` }
      continue
    }
    const re = new RegExp(`\\b${kw.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i')
    if (re.test(stripped)) return { ok: false, reason: `forbidden keyword: ${kw}` }
  }

  return { ok: true, statementCount: 1 }
}
