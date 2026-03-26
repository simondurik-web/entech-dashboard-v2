const DEFAULT_MAIN_SPREADSHEET_ID = '1bK0Ne-vX3i5wGoqyAklnyFDUNdE-WaN4Xs5XjggBSXw'

function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

export const MAIN_SPREADSHEET_ID = envValue('GOOGLE_SHEET_ID') ?? DEFAULT_MAIN_SPREADSHEET_ID

export const SPREADSHEET_IDS = {
  main: MAIN_SPREADSHEET_ID,
  inventoryCosts: '1yASi9Ot4GLBw2iQLfODAvOFHBWrNE8qqYfzvUTjhrz8',
  scheduling: '1SqQeBkgzQPUqdMcOR-gIlPRk85renzqnV1bgn2C10lg',
} as const
