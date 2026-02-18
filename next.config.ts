import type { NextConfig } from "next";
import { execSync } from "child_process";

let gitHash = "unknown";
let gitDate = "";

try {
  gitHash = execSync("git rev-parse --short HEAD").toString().trim();
  gitDate = execSync("git log -1 --format=%ci").toString().trim();
} catch {
  // Vercel provides VERCEL_GIT_COMMIT_SHA
  gitHash = (process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown").slice(0, 7);
  gitDate = new Date().toISOString();
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_GIT_HASH: gitHash,
    NEXT_PUBLIC_GIT_DATE: gitDate,
  },
};

export default nextConfig;
