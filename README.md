This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Google Sheets Access

This app reads Google Sheets through the authenticated Sheets API, not public `gviz` or public CSV exports.

Required server env vars:

```bash
# Preferred: base64-encoded full service account JSON
GOOGLE_SERVICE_ACCOUNT_BASE64=...

# Alternative: raw JSON string
GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'

# Alternative: filesystem path to the JSON key file
GOOGLE_SERVICE_ACCOUNT_JSON_PATH=/absolute/path/to/service-account.json
```

Setup requirements:

1. Enable Google Sheets API in the Google Cloud project that owns the service account.
2. Create a service account with read access.
3. Share the spreadsheet with the service account email as a viewer.
4. Add one of the env vars above to local `.env.local` and to Vercel.
5. If you use `GOOGLE_SERVICE_ACCOUNT_JSON_PATH`, make sure the file exists on the runtime filesystem.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
