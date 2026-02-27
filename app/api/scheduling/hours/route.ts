import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { canViewHistory, forbidden, getProfileFromHeader, normalizeDateInput, unauthorized } from "../_utils"

type HourRow = {
  employee_id: string
  employee_name: string
  total_hours: number
  regular_hours: number
  ot_hours: number
  pay_rate: number
  total_pay: number
  weekly_totals: Record<string, number>
  monthly_totals: Record<string, number>
}

function mondayKey(input: string): string {
  const date = new Date(`${input}T00:00:00`)
  const day = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - day)
  return date.toISOString().slice(0, 10)
}

function monthKey(input: string): string {
  return input.slice(0, 7)
}

export async function GET(req: NextRequest) {
  const profile = await getProfileFromHeader(req)
  if (!profile) return unauthorized()
  if (!canViewHistory(profile.role)) return forbidden()

  try {
    const url = new URL(req.url)
    const from = normalizeDateInput(url.searchParams.get("from") || new Date().toISOString().slice(0, 10))
    const to = normalizeDateInput(url.searchParams.get("to") || new Date().toISOString().slice(0, 10))

    const { data, error } = await supabaseAdmin
      .from("scheduling_entries")
      .select(
        `
        employee_id,
        date,
        hours,
        scheduling_employees!inner(first_name,last_name,pay_rate)
      `
      )
      .gte("date", from)
      .lte("date", to)
      .order("date", { ascending: true })

    if (error) throw error

    const weeklyHours = new Map<string, number>()
    for (const row of data || []) {
      const week = mondayKey(row.date)
      const key = `${row.employee_id}:${week}`
      weeklyHours.set(key, (weeklyHours.get(key) || 0) + Number(row.hours || 0))
    }

    const byEmployee = new Map<string, HourRow>()

    for (const row of data || []) {
      const employee = Array.isArray(row.scheduling_employees)
        ? row.scheduling_employees[0]
        : row.scheduling_employees

      const payRate = Number(employee?.pay_rate || 0)
      const hours = Number(row.hours || 0)
      const week = mondayKey(row.date)
      const weekKey = `${row.employee_id}:${week}`
      const weekHours = weeklyHours.get(weekKey) || 0

      const weekRegular = Math.min(40, weekHours)
      const weekOt = Math.max(0, weekHours - 40)
      const proportionalRegular = weekHours > 0 ? (hours / weekHours) * weekRegular : 0
      const proportionalOt = weekHours > 0 ? (hours / weekHours) * weekOt : 0

      const employeeName = `${employee?.first_name || ""} ${employee?.last_name || ""}`.trim()
      const existing = byEmployee.get(row.employee_id)

      if (!existing) {
        byEmployee.set(row.employee_id, {
          employee_id: row.employee_id,
          employee_name: employeeName,
          total_hours: hours,
          regular_hours: proportionalRegular,
          ot_hours: proportionalOt,
          pay_rate: payRate,
          total_pay: (proportionalRegular * payRate) + (proportionalOt * payRate * 1.5),
          weekly_totals: { [week]: hours },
          monthly_totals: { [monthKey(row.date)]: hours },
        })
      } else {
        existing.total_hours += hours
        existing.regular_hours += proportionalRegular
        existing.ot_hours += proportionalOt
        existing.total_pay += (proportionalRegular * payRate) + (proportionalOt * payRate * 1.5)
        existing.weekly_totals[week] = (existing.weekly_totals[week] || 0) + hours
        const month = monthKey(row.date)
        existing.monthly_totals[month] = (existing.monthly_totals[month] || 0) + hours
      }
    }

    const rows = Array.from(byEmployee.values()).sort((a, b) => a.employee_name.localeCompare(b.employee_name))

    return NextResponse.json({
      from,
      to,
      rows,
      totals: {
        total_hours: rows.reduce((sum, row) => sum + row.total_hours, 0),
        regular_hours: rows.reduce((sum, row) => sum + row.regular_hours, 0),
        ot_hours: rows.reduce((sum, row) => sum + row.ot_hours, 0),
        total_pay: rows.reduce((sum, row) => sum + row.total_pay, 0),
      },
    })
  } catch (err) {
    console.error("Failed to fetch scheduling hours and pay:", err)
    return NextResponse.json({ error: "Failed to fetch scheduling hours and pay" }, { status: 500 })
  }
}
