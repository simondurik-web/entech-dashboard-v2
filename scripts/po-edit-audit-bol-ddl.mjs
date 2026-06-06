// DDL for FEATURE 1 (po_audit_log) + FEATURE 2 (order_documents) + the
// po-documents storage bucket. Run once with: node scripts/po-edit-audit-bol-ddl.mjs
//
// Uses the Supabase Management API with the sbp_ token at
// ~/clawd/secrets/supabase-access-token.json. Cloudflare blocks bare/curl UAs
// with a 1010, so a browser User-Agent header is required.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PROJECT_REF = 'mqfjmzqeccufqhisqpij'
const tokenFile = join(homedir(), 'clawd/secrets/supabase-access-token.json')
const { token } = JSON.parse(readFileSync(tokenFile, 'utf8'))

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

async function runSql(label, sql) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': UA,
      },
      body: JSON.stringify({ query: sql }),
    }
  )
  const text = await res.text()
  if (!res.ok) {
    console.error(`[${label}] FAILED ${res.status}: ${text}`)
    process.exit(1)
  }
  console.log(`[${label}] OK -> ${text.slice(0, 300)}`)
}

// ── FEATURE 1: po_automation.po_audit_log ──────────────────────────────────
const AUDIT_SQL = `
create table if not exists po_automation.po_audit_log (
  id uuid primary key default gen_random_uuid(),
  po_id uuid,
  po_number text,
  changed_by text,
  changed_by_name text,
  changed_at timestamptz not null default now(),
  changes jsonb,
  note text
);
create index if not exists po_audit_log_po_id_changed_at_idx
  on po_automation.po_audit_log (po_id, changed_at desc);
`

// ── FEATURE 2: po_automation.order_documents ───────────────────────────────
const DOCS_SQL = `
create table if not exists po_automation.order_documents (
  id uuid primary key default gen_random_uuid(),
  customer text,
  po_number text,
  doc_type text not null default 'bol',
  doc_number text,
  file_url text,
  file_name text,
  uploaded_by text,
  uploaded_by_name text,
  source text not null default 'manual',
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists order_documents_customer_po_idx
  on po_automation.order_documents (customer, po_number);
`

// ── Storage bucket: po-documents (public) ──────────────────────────────────
// storage.buckets insert is idempotent via on conflict do nothing.
const BUCKET_SQL = `
insert into storage.buckets (id, name, public)
values ('po-documents', 'po-documents', true)
on conflict (id) do update set public = true;
`

// Grants — the service-role client (supabase-js) needs explicit table grants in
// the non-public po_automation schema, otherwise SELECT/INSERT 42501 "permission
// denied". usage on schema for anon/authenticated keeps parity with processed_pos.
const GRANTS_SQL = `
grant usage on schema po_automation to service_role, anon, authenticated;
grant all on po_automation.po_audit_log to service_role;
grant all on po_automation.order_documents to service_role;
`

await runSql('po_audit_log', AUDIT_SQL)
await runSql('order_documents', DOCS_SQL)
await runSql('grants', GRANTS_SQL)
await runSql('po-documents bucket', BUCKET_SQL)
console.log('All DDL applied.')
