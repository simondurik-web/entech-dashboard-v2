import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { requireQualityActor } from "@/lib/quality/api"

let folderCache: string[] | null = null
let folderCacheTime = 0

async function getDrawingFolders(): Promise<string[]> {
  if (folderCache && Date.now() - folderCacheTime < 30_000) return folderCache
  const { data, error } = await supabaseAdmin.storage.from("photos").list("drawing", { limit: 300 })
  if (error || !data) {
    console.error("drawings: storage list failed:", error)
    return folderCache || []
  }
  folderCache = data.map((folder) => folder.name).filter(Boolean)
  folderCacheTime = Date.now()
  return folderCache
}

function commonPrefixLen(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

function findMatchingFolder(partNumber: string, folders: string[]): string | null {
  if (folders.includes(partNumber)) return partNumber

  const normalized = partNumber.replace(/ /g, "_")
  if (folders.includes(normalized)) return normalized

  if (!partNumber.startsWith("H")) return null

  const base = partNumber.replace(/[BGW]$/, "")
  for (const color of ["B", "G", "W", "", "-HUB"]) {
    const candidate = base + color
    if (folders.includes(candidate)) return candidate
  }

  const parts = partNumber.split(".")
  if (parts.length >= 3) {
    const prefix = `${parts[0]}.${parts[1]}`
    const candidates = folders.filter((folder) => folder.startsWith(prefix))
    if (candidates.length === 1) return candidates[0]
    if (candidates.length > 1) {
      return candidates
        .map((folder) => ({ folder, common: commonPrefixLen(partNumber, folder) }))
        .sort((a, b) => b.common - a.common)[0].folder
    }
  }

  return null
}

export async function GET(req: NextRequest) {
  const gate = await requireQualityActor(req, "view")
  if ("response" in gate) return gate.response

  const partNumber = req.nextUrl.searchParams.get("part")
  if (!partNumber) return NextResponse.json({ error: "Missing part" }, { status: 400 })

  const folders = await getDrawingFolders()
  const folder = findMatchingFolder(partNumber, folders)
  if (!folder) return NextResponse.json({ urls: [], files: [] })

  const { data: files } = await supabaseAdmin.storage
    .from("photos")
    .list(`drawing/${folder}`, { limit: 20 })

  if (!files) return NextResponse.json({ urls: [], files: [] })

  const supported = files.filter((file) => file.name && /\.(jpg|jpeg|png|webp|pdf)$/i.test(file.name))
  if (supported.length === 0) return NextResponse.json({ urls: [], files: [] })

  const paths = supported.map((file) => `drawing/${folder}/${file.name}`)
  const { data: signed } = await supabaseAdmin.storage
    .from("photos")
    .createSignedUrls(paths, 3600)

  const filesOut = (signed || [])
    .map((signedFile, i) => {
      if (!signedFile.signedUrl) return null
      const name = supported[i].name
      const type: "image" | "pdf" = /\.pdf$/i.test(name) ? "pdf" : "image"
      return { url: signedFile.signedUrl, name, type }
    })
    .filter((file): file is { url: string; name: string; type: "image" | "pdf" } => file !== null)

  const urls = filesOut.filter((file) => file.type === "image").map((file) => file.url)

  return NextResponse.json({ urls, files: filesOut, matchedFolder: folder })
}
