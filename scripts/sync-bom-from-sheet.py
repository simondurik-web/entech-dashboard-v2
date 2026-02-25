#!/usr/bin/env python3
"""Sync BOM Final Assembly data from Google Sheet to Supabase"""
import csv, json, io, urllib.request

SHEET_URL = "https://docs.google.com/spreadsheets/d/1bK0Ne-vX3i5wGoqyAklnyFDUNdE-WaN4Xs5XjggBSXw/export?format=csv&gid=74377031"

def parse_pct(v):
    if not v: return 0.0
    v = v.strip().replace('%','')
    try: return float(v) / 100.0
    except: return 0.0

def parse_dollar(v):
    if not v: return 0.0
    v = v.strip().replace('$','').replace(',','')
    try: return float(v)
    except: return 0.0

def parse_num(v):
    if not v: return 0.0
    v = v.strip().replace(',','')
    try: return float(v)
    except: return 0.0

# Fetch Sheet
resp = urllib.request.urlopen(SHEET_URL)
reader = csv.DictReader(io.TextIOWrapper(resp, encoding='utf-8'))

sheet_data = {}
for row in reader:
    pn = row.get('Part name ', '').strip()
    if not pn: continue
    sheet_data[pn] = {
        'parts_per_package': int(parse_num(row.get('Parts per package', ''))),
        'parts_per_hour': parse_num(row.get('Parts per hour', '')),
        'labor_rate_per_hour': parse_dollar(row.get('Labor Cost/hr', '')),
        'num_employees': parse_num(row.get('number of employees ', '')),
        'labor_cost_per_part': parse_dollar(row.get('Labor cost / finished part', '')),
        'shipping_labor_cost': parse_dollar(row.get('Shipping/staging/QA labor cost ', '')),
        'subtotal_cost': parse_dollar(row.get('Sub total cost', '')),
        'overhead_pct': parse_pct(row.get('Overhead %', '')),
        'overhead_cost': parse_dollar(row.get('Overhead cost', '')),
        'admin_pct': parse_pct(row.get('Administrative expense %', '')),
        'admin_cost': parse_dollar(row.get('Administrative expense cost', '')),
        'depreciation_pct': parse_pct(row.get('Depreciation %', '')),
        'depreciation_cost': parse_dollar(row.get('Depreciation Cost', '')),
        'repairs_pct': parse_pct(row.get('Repairs & Supplies COGS%', '')),
        'repairs_cost': parse_dollar(row.get('Repairs & Supplies COGS Cost', '')),
        'variable_cost': parse_dollar(row.get('Variable Cost', '')),
        'total_cost': parse_dollar(row.get('Total Cost', '')),
        'profit_target_pct': parse_pct(row.get('Profit Target', '')),
        'profit_amount': parse_dollar(row.get('Profit Total', '')),
        'sales_target': parse_dollar(row.get('Sales target', '')),
    }

print(f"Sheet: {len(sheet_data)} parts")

# Load Supabase creds
with open('/Users/simondurik/clawd/secrets/supabase-credentials.json') as f:
    creds = json.load(f)

base_url = creds['projectUrl']
headers = {
    'apikey': creds['serviceRoleKey'],
    'Authorization': f"Bearer {creds['serviceRoleKey']}",
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal',
}

# Update each part
updated = 0
errors = 0
for pn, vals in sheet_data.items():
    url = f"{base_url}/rest/v1/bom_final_assemblies?part_number=eq.{urllib.parse.quote(pn)}"
    data = json.dumps(vals).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method='PATCH')
    try:
        urllib.request.urlopen(req)
        updated += 1
    except Exception as e:
        print(f"  ERROR {pn}: {e}")
        errors += 1

print(f"Updated: {updated}, Errors: {errors}")
