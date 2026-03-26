# Google Sheets Service Account Setup

This dashboard reads Google Sheets through the authenticated Sheets API v4 on the server. It no longer uses public `gviz` or CSV endpoints.

## Required env vars

Configure one of these in `.env.local` for local development and in your deployment environment:

```bash
# Preferred for hosted runtimes
GOOGLE_SERVICE_ACCOUNT_BASE64=...

# Raw JSON string
GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'

# Absolute or repo-relative path to a JSON file
GOOGLE_SERVICE_ACCOUNT_JSON_PATH=/absolute/path/to/google-service-account.json
```

Optional:

```bash
GOOGLE_SHEET_ID=1bK0Ne-vX3i5wGoqyAklnyFDUNdE-WaN4Xs5XjggBSXw
```

## Google Cloud setup

1. Open Google Cloud Console.
2. Select the project that will own the service account.
3. Enable the Google Sheets API for that project.
4. Create a service account with read-only access for Sheets usage.
5. Create and download a JSON key for that service account if you are using file-based credentials.

## Spreadsheet access

1. Copy the service account `client_email` from the JSON credentials.
2. Open each spreadsheet the app reads.
3. Share the spreadsheet with that service account email.
4. Grant Viewer access unless you intentionally need more.

If the spreadsheet is not shared with the service account, API calls will fail even when the credentials are valid.

## Local development

1. Copy `.env.example` to `.env.local`.
2. Fill in one credential source.
3. Start the app with `npm run dev`.
4. Verify a Sheets-backed route such as `/api/sheets` or `/api/generic-sheet?gid=fpReference`.

## Deployment notes

1. Add the same env vars to your hosting provider.
2. Do not expose these credentials through `NEXT_PUBLIC_*` variables.
3. `GOOGLE_SERVICE_ACCOUNT_JSON_PATH` only works if that file exists on the deployed filesystem.
4. `GOOGLE_SERVICE_ACCOUNT_BASE64` is the safest default for Vercel and similar platforms.

## Troubleshooting

- Missing credentials: the server will throw a configuration error from `lib/google-auth.ts`.
- Invalid base64 or JSON: re-export the credential or re-encode the JSON file.
- `Sheet title not found for gid`: confirm the spreadsheet ID and sheet `gid` are correct.
- `The caller does not have permission`: the spreadsheet has not been shared with the service account email.
