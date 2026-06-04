# Research — 2026-04-17

## Topic: Next.js 15 instrumentation.js for dashboard observability
Project: Entech Dashboard V2

### What is actually new and useful
The useful answer is **not** “turn on OpenTelemetry everywhere.” It is:
**use `instrumentation.ts` as a tiny startup hook for trace registration, then add a few custom spans around the slow business paths Simon actually cares about: Google Sheets reads, Supabase queries, and heavy dashboard API routes.**

That matters because `register()` runs once per new server instance before the app is ready, so it is the wrong place for business logic, warmup fetches, or anything fragile. For V2, the best win is better visibility into route latency and downstream calls, not a big observability subsystem.

### Specific findings for Simon’s stack

#### 1. `instrumentation.ts` is now stable and runs once at server startup
Next.js documents `instrumentation.ts|js` as a root-level file exporting `register()`, called once when a new server instance starts and before it handles requests.

Why this matters:
- safe place to register tracing only
- bad place for anything that can block startup unnecessarily
- if Simon adds it, keep it tiny and deterministic

Best use in V2:
- register OpenTelemetry once
- branch by runtime if needed (`nodejs` vs `edge`)
- avoid loading dashboard-specific business code in startup

#### 2. Vercel’s `@vercel/otel` is the cleanest fit for this app
Vercel supports OpenTelemetry out of the box, and the current recommended setup is minimal:
- install `@opentelemetry/api` and `@vercel/otel`
- call `registerOTel({ serviceName: 'entech-dashboard-v2' })` from `instrumentation.ts`

Why this fits:
- the app is already on Vercel
- no custom collector is needed just to start getting trace structure
- lower integration risk than hand-rolling a full OTel bootstrap

#### 3. The highest-value config is fetch context propagation, not blanket instrumentation
Vercel’s current docs make `instrumentationConfig.fetch` the practical control point:
- `propagateContextUrls`
- `dontPropagateContextUrls`
- `ignoreUrls`

For V2, the smart move is to propagate only to domains we own or actually analyze.

Recommended allowlist shape:
- `*.supabase.co`
- Google APIs used for Sheets reads
- internal dashboard URLs if route-to-route tracing becomes relevant

Recommendation:
- do **not** propagate tracing headers to every third-party URL by default
- explicitly ignore noisy or irrelevant endpoints

#### 4. Next.js 15’s less-cache-by-default behavior makes route tracing more valuable now
Next.js 15 changed defaults so `fetch`, `GET` route handlers, and client navigations are less cache-forgiving by default.

Practical consequence for V2:
- route latency is more likely to surface directly in user navigation
- a slow Google Sheets or Supabase path will now be easier for users to feel
- this makes targeted spans on expensive routes materially more useful than before

#### 5. The first spans should wrap business bottlenecks, not every component
OpenTelemetry is useful when spans describe expensive operations users care about.
For this dashboard, the best first custom spans are:
- Google Sheets API fetch + transform
- Supabase query groups for orders / inventory / BOM / rolltech actions
- heavy API route work like sales aggregation, BOM calculations, and queue enrichment
- export generation paths (CSV/Excel/PDF) if they are slow enough to matter

Bad first target:
- trying to span every React component or every tiny helper

#### 6. Runtime-specific imports matter if Simon later mixes Node and Edge handlers
Next.js now explicitly recommends runtime-conditional imports in `register()` using `process.env.NEXT_RUNTIME`.

Why this matters:
- some tracing code or SDKs may be Node-only
- this avoids breaking Edge handlers later
- V2 can stay safe by isolating any Node-only tracing customization in `instrumentation-node.ts`

#### 7. Startup work should stay light because `register()` blocks readiness
The docs are explicit that `register()` completes before the server is ready.

So for V2, do **not** use `instrumentation.ts` for:
- startup data fetches
- cache priming from Sheets/Supabase
- large imports with side effects unless truly necessary
- anything that might flap deployments or cold starts

### Recommended implementation path

#### Phase 1 — tiny registration only
- add root `instrumentation.ts`
- install `@opentelemetry/api` + `@vercel/otel`
- register service name `entech-dashboard-v2`
- keep startup code minimal

#### Phase 2 — targeted spans where latency matters
Add custom spans around:
- `/api/orders`
- `/api/inventory`
- `/api/sales`
- `/api/rolltech-actions/*`
- BOM-heavy mutation/read paths if they are still hot

Track attributes like:
- data source (`sheets` / `supabase`)
- row count or item count
- cache hit/miss
- operation name (`fetch_orders`, `sales_aggregate`, `queue_detail`)

#### Phase 3 — propagation hygiene
- propagate tracing context only to Supabase + Google APIs + owned services
- ignore noisy internal/private tooling endpoints if they add no value

### Concrete recommendation
For Entech Dashboard V2, the best next observability move is:
**add a minimal `instrumentation.ts` for `@vercel/otel`, then instrument only the slow API/data paths Simon actually feels in the dashboard.**

Not recommended:
- big startup hooks
- tracing every component
- broad third-party context propagation
- putting cache warmup or business logic inside `register()`

### Sources
- Next.js instrumentation guide: https://nextjs.org/docs/app/guides/instrumentation
- Next.js 15 release notes: https://nextjs.org/blog/next-15
- Vercel instrumentation docs: https://vercel.com/docs/tracing/instrumentation
- OpenTelemetry JS Node guide: https://opentelemetry.io/docs/languages/js/getting-started/nodejs/
