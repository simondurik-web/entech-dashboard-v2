import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { requireQualityActor } from "@/lib/quality/api"

const BUCKET = "photos"
const PREFIX = "models-3d"
const URL_TTL_SECONDS = 3600
const CACHE_TTL_MS = 30 * 1000

let fileCache: Set<string> | null = null
let fileCacheTime = 0

async function listAvailableModels(): Promise<Set<string>> {
  if (fileCache && Date.now() - fileCacheTime < CACHE_TTL_MS) return fileCache
  const { data } = await supabaseAdmin.storage.from(BUCKET).list(PREFIX, { limit: 1000 })
  const names = (data || []).map((file) => file.name).filter((name) => name && /\.glb$/i.test(name))
  fileCache = new Set(names)
  fileCacheTime = Date.now()
  return fileCache
}

export async function GET(req: NextRequest) {
  const gate = await requireQualityActor(req, "view")
  if ("response" in gate) return gate.response

  const partNumber = req.nextUrl.searchParams.get("part")
  if (!partNumber) return NextResponse.json({ error: "Missing part" }, { status: 400 })

  const available = await listAvailableModels()
  const filename = `${partNumber}.glb`
  if (!available.has(filename)) return NextResponse.json({ url: null })

  const { data: signed, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(`${PREFIX}/${filename}`, URL_TTL_SECONDS)

  if (error || !signed?.signedUrl) return NextResponse.json({ url: null })
  return NextResponse.json({ url: signed.signedUrl, filename })
}
