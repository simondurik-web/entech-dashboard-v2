import { NextResponse } from 'next/server'
import { fetchIncomeStatement } from '@/lib/income-statement/fetcher'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const skipCache = url.searchParams.get('refresh') === '1'
  try {
    const payload = await fetchIncomeStatement({ skipCache })
    return NextResponse.json(payload)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
