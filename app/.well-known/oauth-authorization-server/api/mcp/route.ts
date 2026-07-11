// RFC 8414 path-suffix variant: clients discovering the AS for the resource
// /api/mcp probe /.well-known/oauth-authorization-server/api/mcp.
import { NextRequest } from "next/server"
import { authorizationServerMetadata, corsPreflight, jsonWithCors } from "@/lib/mcp/oauth-metadata"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  return jsonWithCors(authorizationServerMetadata(req))
}

export async function OPTIONS() {
  return corsPreflight()
}
