#!/bin/bash
# Vercel Ignored Build Step — skip builds for review/* branches to save build minutes.
# Vercel convention (inverted from normal shell):
#   Exit 1 = PROCEED with build
#   Exit 0 = SKIP the build
# Docs: https://vercel.com/docs/projects/overview#ignored-build-step

BRANCH="$VERCEL_GIT_COMMIT_REF"

# Skip review branches — these are PR previews we don't need since we test on staging
if [[ "$BRANCH" == review/* ]]; then
  echo "⏭️  Skipping build for review branch: $BRANCH (saves build minutes)"
  exit 0
fi

# Build everything else (main, staging, feature branches)
echo "✅ Building branch: $BRANCH"
exit 1
