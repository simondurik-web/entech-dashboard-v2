# Entech Dashboard v2

Next.js dashboard for operations, orders, inventory, BOM, scheduling, quotes, and reporting. Google Sheets reads now go through the authenticated Sheets API v4 on the server side; the app no longer depends on public `gviz` or CSV endpoints.

## Getting Started

```bash
npm install
npm run dev
```

The app runs at `http://localhost:3000`.

## Google Sheets Access

Configure one server-side credential source:

```bash
# Preferred for Vercel and other hosted runtimes
GOOGLE_SERVICE_ACCOUNT_BASE64=...

# Raw JSON string
GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'

# Local filesystem path
GOOGLE_SERVICE_ACCOUNT_JSON_PATH=/absolute/path/to/service-account.json
```

Setup requirements:

1. Enable the Google Sheets API in the Google Cloud project that owns the service account.
2. Create a service account with read access.
3. Share each required spreadsheet with the service account `client_email`.
4. Add one of the env vars above to `.env.local` and to the deployment environment.
5. If you use `GOOGLE_SERVICE_ACCOUNT_JSON_PATH`, make sure the file exists on the runtime filesystem.

If credentials are missing or malformed, Sheets-backed API routes will fail server-side with a configuration error.

## Useful Commands

```bash
npm run lint
npm run typecheck
```

