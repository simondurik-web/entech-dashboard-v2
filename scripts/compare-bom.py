#!/usr/bin/env python3
"""Compare BOM Final Assembly data: Google Sheet vs Supabase"""
import csv, json, sys, io, urllib.request, re

# Fetch Google Sheet
SHEET_URL = "https://docs.google.com/spreadsheets/d/1bK0Ne-vX3i5wGoqyAklnyFDUNdE-WaN4Xs5XjggBSXw/export?format=csv&gid=74377031"
resp = urllib.request.urlopen(SHEET_URL)
reader = csv.DictReader(io.TextIOWrapper(resp, encoding='utf-8'))

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

sheet_data = {}
for row in reader:
    pn = row.get('Part name ', '').strip()
    if not pn: continue
    sheet_data[pn] = {
        'parts_per_package': parse_num(row.get('Parts per package', '')),
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

print(f"Google Sheet: {len(sheet_data)} parts")

# Fetch Supabase
with open('/Users/simondurik/clawd/secrets/supabase-credentials.json') as f:
    creds = json.load(f)

import urllib.request
url = f"{creds['projectUrl']}/rest/v1/bom_final_assemblies?select=*"
req = urllib.request.Request(url, headers={
    'apikey': creds['serviceRoleKey'],
    'Authorization': f"Bearer {creds['serviceRoleKey']}",
})
resp = urllib.request.urlopen(req)
db_rows = json.loads(resp.read())
db_data = {r['part_number']: r for r in db_rows}
print(f"Supabase: {len(db_data)} parts")

# Compare
fields = ['parts_per_package', 'parts_per_hour', 'labor_rate_per_hour', 'num_employees',
          'labor_cost_per_part', 'shipping_labor_cost', 'subtotal_cost',
          'overhead_pct', 'admin_pct', 'depreciation_pct', 'repairs_pct',
          'variable_cost', 'total_cost', 'profit_target_pct', 'sales_target']

missing_in_db = []
missing_in_sheet = []
mismatches = {}

for pn in sheet_data:
    if pn not in db_data:
        missing_in_db.append(pn)
        continue
    diffs = {}
    for f in fields:
        sheet_val = sheet_data[pn].get(f, 0) or 0
        db_val = float(db_data[pn].get(f) or 0)
        if abs(sheet_val - db_val) > 0.001:
            diffs[f] = {'sheet': sheet_val, 'db': db_val}
    if diffs:
        mismatches[pn] = diffs

for pn in db_data:
    if pn not in sheet_data:
        missing_in_sheet.append(pn)

print(f"\nMissing in DB (in Sheet but not Supabase): {len(missing_in_db)}")
for p in sorted(missing_in_db)[:10]:
    print(f"  {p}")
if len(missing_in_db) > 10:
    print(f"  ... and {len(missing_in_db)-10} more")

print(f"\nMissing in Sheet (in Supabase but not Sheet): {len(missing_in_sheet)}")
for p in sorted(missing_in_sheet)[:10]:
    print(f"  {p}")

print(f"\nParts with mismatches: {len(mismatches)} / {len(set(sheet_data) & set(db_data))}")

# Summarize which fields mismatch most
field_counts = {}
for pn, diffs in mismatches.items():
    for f in diffs:
        field_counts[f] = field_counts.get(f, 0) + 1

print("\nMismatch frequency by field:")
for f, c in sorted(field_counts.items(), key=lambda x: -x[1]):
    print(f"  {f}: {c} parts differ")

# Show a few examples
print("\nSample mismatches (first 5):")
for i, (pn, diffs) in enumerate(sorted(mismatches.items())):
    if i >= 5: break
    print(f"\n  {pn}:")
    for f, v in diffs.items():
        print(f"    {f}: Sheet={v['sheet']:.6f}  DB={v['db']:.6f}")
