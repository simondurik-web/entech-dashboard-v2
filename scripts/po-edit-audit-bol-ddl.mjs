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

// ── ATOMIC EDIT + AUDIT: po_automation.apply_po_edit ───────────────────────
// One function body (implicitly a single transaction): UPDATE processed_pos
// from p_updates AND INSERT the po_audit_log row from p_audit so both commit or
// neither. The PATCH route calls it via supabase-js
// `.schema('po_automation').rpc('apply_po_edit', {...})`. Returns the updated
// processed_pos row as jsonb so the route can echo it back.
const APPLY_EDIT_FN_SQL = `
create or replace function po_automation.apply_po_edit(
  p_id uuid,
  p_updates jsonb,
  p_audit jsonb
) returns jsonb
language plpgsql
security definer
set search_path = po_automation, public
as $$
declare
  v_row jsonb;
begin
  -- Apply the column updates (jsonb -> column assignments) when present.
  if p_updates is not null and p_updates <> '{}'::jsonb then
    update po_automation.processed_pos p
    set
      party               = case when p_updates ? 'party' then (p_updates->>'party') else p.party end,
      po_number           = case when p_updates ? 'po_number' then (p_updates->>'po_number') else p.po_number end,
      status              = case when p_updates ? 'status' then (p_updates->>'status') else p.status end,
      so_numbers          = case when p_updates ? 'so_numbers' then (p_updates->>'so_numbers') else p.so_numbers end,
      filemaker_record_id = case when p_updates ? 'filemaker_record_id' then (p_updates->>'filemaker_record_id') else p.filemaker_record_id end,
      entered_via         = case when p_updates ? 'entered_via' then (p_updates->>'entered_via') else p.entered_via end,
      po_pdf_url          = case when p_updates ? 'po_pdf_url' then (p_updates->>'po_pdf_url') else p.po_pdf_url end,
      payload             = case when p_updates ? 'payload' then (p_updates->'payload') else p.payload end,
      updated_at          = case when p_updates ? 'updated_at' then (p_updates->>'updated_at')::timestamptz else now() end
    where p.id = p_id
    returning to_jsonb(p.*) into v_row;

    if v_row is null then
      raise exception 'PO % not found', p_id;
    end if;
  else
    select to_jsonb(p.*) into v_row from po_automation.processed_pos p where p.id = p_id;
    if v_row is null then
      raise exception 'PO % not found', p_id;
    end if;
  end if;

  -- Always insert the audit row (caller decides whether to call at all).
  insert into po_automation.po_audit_log
    (po_id, po_number, changed_by, changed_by_name, changes, note)
  values (
    p_id,
    p_audit->>'po_number',
    p_audit->>'changed_by',
    p_audit->>'changed_by_name',
    coalesce(p_audit->'changes', '[]'::jsonb),
    p_audit->>'note'
  );

  return v_row;
end;
$$;
`

// Grants — the service-role client (supabase-js) needs explicit table grants in
// the non-public po_automation schema, otherwise SELECT/INSERT 42501 "permission
// denied". usage on schema for anon/authenticated keeps parity with processed_pos.
const GRANTS_SQL = `
grant usage on schema po_automation to service_role, anon, authenticated;
grant all on po_automation.po_audit_log to service_role;
grant all on po_automation.order_documents to service_role;
grant execute on function po_automation.apply_po_edit(uuid, jsonb, jsonb) to service_role;
`

await runSql('po_audit_log', AUDIT_SQL)
await runSql('order_documents', DOCS_SQL)
await runSql('apply_po_edit fn', APPLY_EDIT_FN_SQL)
await runSql('grants', GRANTS_SQL)
await runSql('po-documents bucket', BUCKET_SQL)
console.log('All DDL applied.')
