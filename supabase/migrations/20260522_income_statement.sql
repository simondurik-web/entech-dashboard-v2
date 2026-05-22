-- Income Statement — monthly P&L snapshot.
--
-- One row per month. Source of truth is the Google Sheet
-- (1lhFbJc8...P_E); this table is a denormalised cache that Phil can
-- query via SQL. Refreshed on every successful fetcher cache-miss
-- (max once per 5 min) and on manual ?refresh=1.
--
-- Schema notes
-- - `line_items` jsonb keeps the raw account-level detail so Phil can
--   roll up subsets ("show me labour costs" → filter where account
--   starts with '5600' or contains 'Labor').
-- - All amounts in USD. Negative values are real (e.g. discounts on
--   the income side, or losses on net income).
-- - `percent_*` columns are derived (amount / revenue). Stored as
--   plain floats so SQL queries can sort/filter without recomputing.

create table if not exists public.income_statement_months (
  month_iso          text primary key,                  -- "2026-01"
  label              text not null,                     -- "Jan 26"

  revenue            numeric(14,2) not null,            -- Total - Income
  cogs               numeric(14,2) not null,            -- Total - Cost Of Sales
  expense            numeric(14,2) not null,            -- Total - Expense (op-ex)
  other_expense      numeric(14,2) not null default 0,  -- Total - Other Expense

  gross_profit       numeric(14,2) not null,
  net_ordinary_income numeric(14,2) not null,
  net_other_income   numeric(14,2) not null default 0,
  net_income         numeric(14,2) not null,
  interest           numeric(14,2) not null default 0,
  depreciation       numeric(14,2) not null default 0,
  ebitda             numeric(14,2) not null,

  -- Common % of revenue ratios (handy for SQL filters without dividing).
  gross_margin_pct   numeric(8,5),
  net_margin_pct     numeric(8,5),
  ebitda_margin_pct  numeric(8,5),

  -- Per-section line items (account, amount, percentOfRevenue).
  line_items         jsonb not null default '{}'::jsonb,

  updated_at         timestamptz not null default now()
);

create index if not exists income_statement_months_label_idx
  on public.income_statement_months (label);

-- RLS: any signed-in user can read; only service role writes.
alter table public.income_statement_months enable row level security;

drop policy if exists income_statement_select on public.income_statement_months;
create policy income_statement_select
  on public.income_statement_months for select
  using (auth.role() = 'authenticated');

comment on table public.income_statement_months is
  'Monthly Compression Molding P&L snapshot. Mirrored from the Google '
  'Sheet by the Next.js fetcher on cache miss. Phil queries this table '
  'directly. See lib/income-statement/fetcher.ts for the upsert path.';
