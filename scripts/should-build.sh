#!/bin/bash
# Vercel Ignored Build Step — skip builds for review/* branches to save build minutes.
# Exit 1 = DON'T build (skip), Exit 0 = proceed with build.
# Docs: https://vercel.com/docs/projects/overview#ignored-build-step

BRANCH="$VERCEL_GIT_COMMIT_REF"

# Skip review branches — these are PR previews we don't need since we test on staging
if [[ "$BRANCH" == review/* ]]; then
  echo "⏭️  Skipping build for review branch: $BRANCH (saves build minutes)"
  exit 1
fi

# Build everything else (main, staging, feature branches)
echo "✅ Building branch: $BRANCH"
exit 0
