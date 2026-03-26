# Coding Policy — MANDATORY (Simon, 2026-03-01)

**This policy is NON-NEGOTIABLE. Read before ANY coding work on this project.**

## 1) Model Routing
- Simple edits (small UI/style/text/minor logic) → GPT-5.3 Codex
- Medium/complex coding (multi-file/behavior/data changes) → GPT-5.3 Codex executes + Opus 4.6 architecture/review
- High-risk paths (auth, financial logic, production-critical) → Opus 4.6 plans/reviews first, then Codex executes
- Very large files (400KB+) → Gemini 3.1 Pro fallback

## 2) Pre-Coding Recon (MANDATORY before writing any spec)
- Run `gitnexus status` on the target repo — re-index if stale (`gitnexus analyze`)
- Query GitNexus for dependencies of the code you're changing — know the blast radius
- Include dependency info in agent specs ("this function is called by X, Y, Z — do not break these callers")
- Use grep-then-edit pattern for large files (never ask agents to read entire files >500 lines)

## 3) Workflow Guardrails (ALWAYS)
- Plan first with clear acceptance criteria (3+ steps = written plan, get OK)
- **Delegate implementation to coding agents via `.clawdbot/spawn-agent.sh`** — DO NOT CODE DIRECTLY
- TDD required for testable behavior: agent writes failing test FIRST, verifies it fails, then implements
- Inter-task verification: for chained tasks, verify output between each before spawning the next — no blind chaining
- Run multi-agent review before merge (`review-pr.sh`)
- Verify in staging with proof
- Ask Simon for explicit approval before production push

## 4) When Things Break
- Follow `~/clawd/DEBUG-PROTOCOL.md` — 4-phase: observe → trace root cause → fix ONE thing → verify
- NEVER chain speculative fixes — if first fix fails, REVERT and re-analyze
- Production broken → revert to last working commit FIRST, then debug
- After any fix: document pattern in `~/clawd/ERRORS.md`

## 5) Quality Constraints
- Prefer surgical diffs, reversible changes
- If ambiguity exists, ask before coding
- Don't break existing working flows
- Use GSD-style structured phases: Plan/Spec → Implement → Verify

## 6) References
- `~/clawd/MODEL-ROUTING-POLICY-v1.md`
- `~/clawd/SKILLS-BASELINE-STACK.md`
- `~/clawd/CLAUDE-CODE-STRATEGY.md`
- `~/clawd/DEBUG-PROTOCOL.md`
- `~/clawd/PLAN-FIRST.md`
- `~/clawd/.clawdbot/README.md`
