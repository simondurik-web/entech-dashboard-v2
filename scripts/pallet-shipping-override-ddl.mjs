// DDL for the pallet-photo Production->Shipping gate override table.
// Run once with: node scripts/pallet-shipping-override-ddl.mjs
//
// Mirrors scripts/po-edit-audit-bol-ddl.mjs: Supabase Management API with the
// sbp_ token at ~/clawd/secrets/supabase-access-token.json. Cloudflare blocks
// bare/curl UAs with a 1010, so a browser User-Agent header is required.
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

const OVERRIDES_SQL = `
create table if not exists public.pallet_shipping_overrides (
  line_number    text primary key,
  forced_by      uuid,
  forced_by_name text,
  forced_at      timestamptz not null default now()
);
alter table public.pallet_shipping_overrides enable row level security;
revoke all on public.pallet_shipping_overrides from anon, authenticated;
grant all on public.pallet_shipping_overrides to service_role;
comment on table public.pallet_shipping_overrides is
  'Admin "Force to Shipping" overrides for the pallet-photo gate. A row here forces its line_number to Shipping even if not all pallets are photographed. Service-role only. Managed via Pallet Records > Production.';
`

await runSql('pallet_shipping_overrides', OVERRIDES_SQL)
console.log('All DDL applied.')
