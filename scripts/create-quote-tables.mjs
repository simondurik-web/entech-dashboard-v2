import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

const envPath = path.resolve(process.cwd(), '.env.local')
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim()
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const sql = `
-- Customers table
CREATE TABLE IF NOT EXISTS customers (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text UNIQUE NOT NULL,
  payment_terms text DEFAULT 'Net 30',
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Parts master
CREATE TABLE IF NOT EXISTS parts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  part_number text UNIQUE NOT NULL,
  description text,
  category text,
  created_at timestamptz DEFAULT now()
);

-- Customer part mappings with tier pricing
CREATE TABLE IF NOT EXISTS customer_part_mappings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  customer_part_number text,
  internal_part_number text NOT NULL,
  category text,
  package_quantity text,
  packaging text,
  tier1_range text, tier1_price numeric(12,4),
  tier2_range text, tier2_price numeric(12,4),
  tier3_range text, tier3_price numeric(12,4),
  tier4_range text, tier4_price numeric(12,4),
  tier5_range text, tier5_price numeric(12,4),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(customer_id, internal_part_number, customer_part_number)
);

-- Enable RLS
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_part_mappings ENABLE ROW LEVEL SECURITY;

-- Public read policies
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'public_read_customers') THEN
    CREATE POLICY public_read_customers ON customers FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'public_read_parts') THEN
    CREATE POLICY public_read_parts ON parts FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'public_read_customer_part_mappings') THEN
    CREATE POLICY public_read_customer_part_mappings ON customer_part_mappings FOR SELECT USING (true);
  END IF;
END $$;

-- Service role insert/update policies
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_insert_customers') THEN
    CREATE POLICY service_insert_customers ON customers FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_update_customers') THEN
    CREATE POLICY service_update_customers ON customers FOR UPDATE USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_insert_parts') THEN
    CREATE POLICY service_insert_parts ON parts FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_insert_cpm') THEN
    CREATE POLICY service_insert_cpm ON customer_part_mappings FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_update_cpm') THEN
    CREATE POLICY service_update_cpm ON customer_part_mappings FOR UPDATE USING (true);
  END IF;
END $$;
`

async function main() {
  console.log('Creating tables...')
  const { error } = await supabase.rpc('exec_sql', { sql_text: sql })
  if (error) {
    // If rpc doesn't exist, use pg directly
    console.log('RPC not available, trying direct pg...')
    const pg = await import('pg')
    // Extract connection info from supabase URL
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const projectRef = url.replace('https://', '').replace('.supabase.co', '')
    const client = new pg.default.Client({
      host: `db.${projectRef}.supabase.co`,
      port: 5432,
      database: 'postgres',
      user: 'postgres',
      password: 'pe&.jE5dR5+*yX&',
      ssl: { rejectUnauthorized: false }
    })
    await client.connect()
    await client.query(sql)
    await client.end()
    console.log('✅ Tables created via pg')
    return
  }
  console.log('✅ Tables created via rpc')
}

main().catch(e => { console.error(e); process.exit(1) })
