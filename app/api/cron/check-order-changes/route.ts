import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

const SHEET_ID = '1bK0Ne-vX3i5wGoqyAklnyFDUNdE-WaN4Xs5XjggBSXw'
const MAIN_DATA_GID = '290032634'

// Column indices from Main Data sheet
const COLS = {
  line: 0, category: 1, urgentOverride: 4,
  ifNumber: 5, ifStatus: 6, internalStatus: 7,
  customer: 9, partNumber: 11, orderQty: 15,
}

function cellValue(row: { c: Array<{ v: unknown } | null> }, col: number): string {
  const cell = row.c?.[col]
  if (!cell || cell.v == null) return ''
  return String(cell.v).trim()
}

function normalizeStatus(status: string, ifStatus: string): string {
  const s = (status || ifStatus || '').toLowerCase()
  if (s.includes('cancel') || s.includes('closed') || s.includes('void')) return 'cancelled'
  if (s.includes('shipped') || s.includes('invoiced') || s.includes('to bill')) return 'shipped'
  if (s.includes('staged')) return 'staged'
  if (s.includes('work in progress') || s.includes('wip') || s.includes('in production')) return 'wip'
  if (s.includes('pending') || s.includes('approved') || s.includes('released')) return 'pending'
  return s || 'unknown'
}

function getCategory(cat: string): string {
  const c = (cat || '').toLowerCase()
  if (c.includes('roll') || c.includes('rt')) return 'Roll Tech'
  if (c.includes('mold')) return 'Molding'
  if (c.includes('snap')) return 'SnapPad'
  return 'Other'
}

async function fetchCurrentOrders() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${MAIN_DATA_GID}`
  const res = await fetch(url, { cache: 'no-store' })
  const text = await res.text()
  const jsonStr = text.replace(/^[^(]*\(/, '').replace(/\);?\s*$/, '')
  const data = JSON.parse(jsonStr)
  const rows = data.table.rows as Array<{ c: Array<{ v: unknown } | null> }>

  const orders: Array<{
    line: string; urgent: boolean; status: string;
    customer: string; partNumber: string; ifNumber: string; category: string; qty: string
  }> = []

  for (const row of rows) {
    if (!row.c) continue
    const line = cellValue(row, COLS.line)
    const customer = cellValue(row, COLS.customer)
    if (!line || !customer) continue
    const status = normalizeStatus(cellValue(row, COLS.internalStatus), cellValue(row, COLS.ifStatus))
    if (status === 'cancelled') continue

    const urgentRaw = cellValue(row, COLS.urgentOverride).toLowerCase()
    const urgent = urgentRaw === 'true' || urgentRaw === '1' || urgentRaw === 'yes'

    orders.push({
      line, urgent, status, customer,
      partNumber: cellValue(row, COLS.partNumber),
      ifNumber: cellValue(row, COLS.ifNumber),
      category: getCategory(cellValue(row, COLS.category)),
      qty: cellValue(row, COLS.orderQty),
    })
  }
  return orders
}

async function sendNotificationsForEvent(
  eventType: string,
  title: string,
  body: string,
  url: string
) {
  // Get users subscribed to this event
  const { data: rules } = await supabaseAdmin
    .from('notification_rules')
    .select('user_id')
    .eq('event_type', eventType)
    .eq('enabled', true)

  if (!rules?.length) return 0

  const userIds = rules.map(r => r.user_id)

  // Get push subscriptions for these users
  const { data: subs } = await supabaseAdmin
    .from('push_subscriptions')
    .select('*')
    .in('user_id', userIds)

  if (!subs?.length) return 0

  // Lazy-load web-push
  const webpush = await import('web-push')
  webpush.setVapidDetails(
    'mailto:simon.durik@4entech.com',
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '',
    process.env.VAPID_PRIVATE_KEY || ''
  )

  const payload = JSON.stringify({ title, body, url, tag: `auto-${eventType}-${Date.now()}` })

  let sent = 0
  const stale: string[] = []
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      )
      sent++
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number })?.statusCode
      if (statusCode === 410 || statusCode === 404) stale.push(sub.id)
    }
  }

  if (stale.length) {
    await supabaseAdmin.from('push_subscriptions').delete().in('id', stale)
  }

  // Log it
  await supabaseAdmin.from('notification_log').insert({
    title, body,
    sent_by: null,
    target_role: 'auto',
    target_user_id: null,
    sent_count: sent,
  })

  return sent
}

export async function GET(req: NextRequest) {
  try {
    // Verify cron secret (Vercel cron sends this header)
    const authHeader = req.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 1. Fetch current orders from Google Sheets
    const currentOrders = await fetchCurrentOrders()

    // 2. Fetch last known state from Supabase
    const { data: snapshots } = await supabaseAdmin
      .from('order_state_snapshot')
      .select('*')

    const snapshotMap = new Map(
      (snapshots || []).map(s => [s.line_number, s])
    )

    // 3. Detect changes
    const newUrgent: typeof currentOrders = []
    const newStaged: typeof currentOrders = []

    for (const order of currentOrders) {
      const prev = snapshotMap.get(order.line)

      if (order.urgent && (!prev || !prev.urgent_override)) {
        newUrgent.push(order)
      }
      if (order.status === 'staged' && (!prev || prev.status !== 'staged')) {
        newStaged.push(order)
      }
    }

    // 4. Send notifications
    let urgentSent = 0
    let stagedSent = 0

    for (const order of newUrgent) {
      urgentSent += await sendNotificationsForEvent(
        'order_urgent',
        `🚨 URGENT: ${order.customer}`,
        `Order #${order.line} (${order.partNumber}) — ${order.qty} units marked URGENT`,
        `/need-to-package`
      )
    }

    for (const order of newStaged) {
      stagedSent += await sendNotificationsForEvent(
        'order_staged',
        `📦 Staged: ${order.customer}`,
        `Order #${order.line} (${order.partNumber}) — ${order.qty} units ready to ship`,
        `/staged`
      )
    }

    // 5. Update snapshot (upsert all current orders)
    const upsertRows = currentOrders.map(o => ({
      line_number: o.line,
      urgent_override: o.urgent,
      status: o.status,
      customer: o.customer,
      part_number: o.partNumber,
      if_number: o.ifNumber,
      category: o.category,
      updated_at: new Date().toISOString(),
    }))

    // Batch upsert in chunks of 500
    for (let i = 0; i < upsertRows.length; i += 500) {
      const chunk = upsertRows.slice(i, i + 500)
      await supabaseAdmin
        .from('order_state_snapshot')
        .upsert(chunk, { onConflict: 'line_number' })
    }

    // Clean up old snapshots (orders no longer in sheet)
    const currentLines = new Set(currentOrders.map(o => o.line))
    const staleLines = (snapshots || [])
      .filter(s => !currentLines.has(s.line_number))
      .map(s => s.line_number)

    if (staleLines.length) {
      await supabaseAdmin
        .from('order_state_snapshot')
        .delete()
        .in('line_number', staleLines)
    }

    return NextResponse.json({
      checked: currentOrders.length,
      changes: {
        newUrgent: newUrgent.length,
        newStaged: newStaged.length,
      },
      notifications: { urgentSent, stagedSent },
      staleRemoved: staleLines.length,
    })
  } catch (err) {
    console.error('Cron check-order-changes error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
