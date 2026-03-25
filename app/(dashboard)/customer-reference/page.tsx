'use client'

import { Suspense, useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Search, Plus, Users, AlertTriangle, TrendingUp, Target,
  RefreshCw, History, Trash2, AlertCircle,
} from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { DataTable } from '@/components/data-table'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import { getContributionColor, computeContributionLevel } from '@/lib/cost-config'
import { useI18n } from '@/lib/i18n'
import { useViewFromUrl, useAutoExport } from '@/lib/use-view-from-url'
import { TableSkeleton } from "@/components/ui/skeleton-loader"

interface Customer {
  id: string
  name: string
  payment_terms: string
  notes?: string
}

interface PartMapping {
  id: string
  customer_id: string
  customer_part_number: string | null
  internal_part_number: string
  category: string | null
  packaging: string | null
  package_quantity: number | null
  tier1_range: string | null
  tier1_price: number | null
  tier2_range: string | null
  tier2_price: number | null
  tier3_range: string | null
  tier3_price: number | null
  tier4_range: string | null
  tier4_price: number | null
  tier5_range: string | null
  tier5_price: number | null
  lowest_quoted_price: number | null
  variable_cost: number | null
  total_cost: number | null
  sales_target: number | null
  contribution_level: string | null
  notes: string | null
  customers: { name: string; payment_terms: string } | null
}

type MappingFormData = Omit<PartMapping, 'id' | 'lowest_quoted_price' | 'contribution_level' | 'customers' | 'variable_cost' | 'total_cost' | 'sales_target'>

interface AuditEntry {
  id: string
  mapping_id: string | null
  action: string
  field_name: string | null
  old_value: string | null
  new_value: string | null
  performed_by_name: string | null
  performed_by_email: string | null
  created_at: string
}

const EMPTY_MAPPING: MappingFormData = {
  customer_id: '',
  customer_part_number: '',
  internal_part_number: '',
  category: '',
  packaging: '',
  package_quantity: null,
  tier1_range: '', tier1_price: null,
  tier2_range: '', tier2_price: null,
  tier3_range: '', tier3_price: null,
  tier4_range: '', tier4_price: null,
  tier5_range: '', tier5_price: null,
  notes: '',
}

export default function CustomerReferencePage() {
  return <Suspense><CustomerReferencePageContent /></Suspense>
}

function CustomerReferencePageContent() {
  const router = useRouter()
  const [mappings, setMappings] = useState<PartMapping[]>([])
  const initialView = useViewFromUrl()
  const autoExport = useAutoExport()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [bomPartNumbers, setBomPartNumbers] = useState<string[]>([])
  const [bomLoading, setBomLoading] = useState(true)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterCustomer, setFilterCustomer] = useState<string>('all')
  const [filterLevel, setFilterLevel] = useState<string>('all')
  const [showDuplicatesOnly, setShowDuplicatesOnly] = useState(false)

  // Auth
  const { profile } = useAuth()

  // Dialog states
  const [showCustomerDialog, setShowCustomerDialog] = useState(false)
  const [showMappingDialog, setShowMappingDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [editingMapping, setEditingMapping] = useState<PartMapping | null>(null)
  const [formData, setFormData] = useState<MappingFormData>(EMPTY_MAPPING)
  const [customerForm, setCustomerForm] = useState({ name: '', payment_terms: 'Net 30', notes: '' })
  const [deleteTarget, setDeleteTarget] = useState<PartMapping | null>(null)
  const [saving, setSaving] = useState(false)

  // Audit trail states
  const [showAuditPanel, setShowAuditPanel] = useState(false)
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditFilterUser, setAuditFilterUser] = useState('')
  const [auditFilterAction, setAuditFilterAction] = useState<string>('all')

  const { t } = useI18n()

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [custRes, mapRes] = await Promise.all([
        fetch('/api/customers'),
        fetch('/api/customer-part-mappings'),
      ])
      const [custData, mapData] = await Promise.all([custRes.json(), mapRes.json()])
      setCustomers(Array.isArray(custData) ? custData : [])
      setMappings(Array.isArray(mapData) ? mapData : [])
    } catch {
      console.error('Failed to fetch data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Compute duplicate internal_part_numbers per customer
  const duplicateKeys = useMemo(() => {
    const counts = new Map<string, number>()
    for (const m of mappings) {
      const key = `${m.customer_id}::${m.internal_part_number}`
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    const dupes = new Set<string>()
    for (const [key, count] of counts) {
      if (count > 1) dupes.add(key)
    }
    return dupes
  }, [mappings])

  const isDuplicate = (m: PartMapping) => duplicateKeys.has(`${m.customer_id}::${m.internal_part_number}`)

  // Fetch audit log
  const fetchAudit = useCallback(async () => {
    setAuditLoading(true)
    try {
      const params = new URLSearchParams({ limit: '200' })
      if (auditFilterUser) params.set('performed_by', auditFilterUser)
      if (auditFilterAction !== 'all') params.set('action', auditFilterAction)
      const res = await fetch(`/api/customer-part-mappings/audit?${params}`)
      const data = await res.json()
      setAuditEntries(data.entries || [])
    } catch { /* ignore */ }
    finally { setAuditLoading(false) }
  }, [auditFilterUser, auditFilterAction])

  useEffect(() => {
    if (showAuditPanel) fetchAudit()
  }, [showAuditPanel, fetchAudit])

  useEffect(() => {
    setBomLoading(true)
    fetch('/api/bom')
      .then(res => res.json())
      .then((data: Array<{ partNumber: string }>) => {
        const nextBomPartNumbers = Array.isArray(data)
          ? [...new Set(data.map((b) => b.partNumber?.trim()).filter((partNumber): partNumber is string => Boolean(partNumber)))]
              .sort((a, b) => a.localeCompare(b))
          : []
        setBomPartNumbers(nextBomPartNumbers)
      })
      .catch(() => {})
      .finally(() => setBomLoading(false))
  }, [])

  // Filter + search
  const filtered = mappings.filter((m) => {
    if (filterCustomer !== 'all' && m.customer_id !== filterCustomer) return false
    if (filterLevel !== 'all' && m.contribution_level !== filterLevel) return false
    if (search) {
      const s = search.toLowerCase()
      const match = (
        m.internal_part_number?.toLowerCase().includes(s) ||
        m.customer_part_number?.toLowerCase().includes(s) ||
        m.customers?.name?.toLowerCase().includes(s)
      )
      if (!match) return false
    }
    if (showDuplicatesOnly && !isDuplicate(m)) return false
    return true
  })

  // Convert to Record<string, unknown> for DataTable — add customerName for sorting
  type MappingRow = PartMapping & Record<string, unknown>
  const tableData: MappingRow[] = filtered.map(m => ({ ...m, customerName: m.customers?.name || '' })) as MappingRow[]

  const COLUMNS: ColumnDef<MappingRow>[] = [
    {
      key: 'customerName' as keyof MappingRow & string,
      label: 'Customer',
      sortable: true,
      filterable: true,
      render: (_, row) => {
        const m = row as unknown as PartMapping
        const dupe = isDuplicate(m)
        return (
          <span className="inline-flex items-center gap-1.5">
            {m.customers?.name || '—'}
            {dupe && (
              <span className="inline-flex items-center gap-0.5 text-amber-500" title="Duplicate internal P/N for this customer">
                <AlertCircle className="size-3.5" />
              </span>
            )}
          </span>
        )
      },
    },
    { key: 'customer_part_number' as keyof MappingRow & string, label: 'Cust P/N', sortable: true, render: (v) => (v as string) || '—' },
    {
      key: 'internal_part_number' as keyof MappingRow & string,
      label: 'Internal P/N',
      sortable: true,
      filterable: true,
      render: (v, row) => {
        const m = row as unknown as PartMapping
        const dupe = isDuplicate(m)
        return (
          <span className={`font-mono text-sm ${dupe ? 'text-amber-500 font-bold' : ''}`}>
            {v as string}
            {dupe && <span className="ml-1 text-[10px] font-normal bg-amber-500/20 text-amber-500 px-1 py-0.5 rounded">DUPLICATE</span>}
          </span>
        )
      },
    },
    { key: 'category' as keyof MappingRow & string, label: 'Category', sortable: true, filterable: true, render: (v) => (v as string) || '—' },
    { key: 'lowest_quoted_price' as keyof MappingRow & string, label: 'Lowest Price', sortable: true, render: (v) => fmt(v as number | null) },
    { key: 'variable_cost' as keyof MappingRow & string, label: 'Variable Cost', sortable: true, render: (v) => fmt(v as number | null) },
    { key: 'total_cost' as keyof MappingRow & string, label: 'Total Cost', sortable: true, render: (v) => fmt(v as number | null) },
    { key: 'sales_target' as keyof MappingRow & string, label: 'Sales Target', sortable: true, render: (v) => fmt(v as number | null) },
    {
      key: 'contribution_level' as keyof MappingRow & string,
      label: 'Contribution',
      sortable: true,
      filterable: true,
      render: (v) => v ? <Badge variant="outline" className={getContributionColor(v as string)}>{v as string}</Badge> : <span className="text-muted-foreground">—</span>,
    },
  ]

  const table = useDataTable({
    data: tableData,
    columns: COLUMNS,
    storageKey: 'customer-reference',
  })

  // Stats
  const duplicateCount = useMemo(() => mappings.filter(m => isDuplicate(m)).length, [mappings, duplicateKeys])
  const stats = {
    total: mappings.length,
    critical: mappings.filter((m) => m.contribution_level === 'Critical Loss').length,
    marginal: mappings.filter((m) => m.contribution_level === 'Marginal Coverage').length,
    profitable: mappings.filter((m) => m.contribution_level === 'Net Profitable').length,
    target: mappings.filter((m) => m.contribution_level === 'Target Achieved').length,
    duplicates: duplicateCount,
  }

  // CRUD handlers
  const handleSaveCustomer = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(customerForm),
      })
      if (!res.ok) throw new Error('Failed')
      setShowCustomerDialog(false)
      setCustomerForm({ name: '', payment_terms: 'Net 30', notes: '' })
      fetchData()
    } catch { /* ignore */ } finally { setSaving(false) }
  }

  const handleSaveMapping = async () => {
    setSaving(true)
    try {
      const url = editingMapping
        ? `/api/customer-part-mappings/${editingMapping.id}`
        : '/api/customer-part-mappings'
      const method = editingMapping ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          _performed_by_name: profile?.full_name || 'Unknown',
          _performed_by_email: profile?.email || '',
        }),
      })
      if (!res.ok) throw new Error('Failed')
      setShowMappingDialog(false)
      setEditingMapping(null)
      setFormData(EMPTY_MAPPING)
      fetchData()
    } catch { /* ignore */ } finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setSaving(true)
    try {
      await fetch(`/api/customer-part-mappings/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deleted_by_name: profile?.full_name || 'Unknown',
          deleted_by_email: profile?.email || '',
        }),
      })
      setShowDeleteDialog(false)
      setDeleteTarget(null)
      fetchData()
    } catch { /* ignore */ } finally { setSaving(false) }
  }

  const openEdit = (m: PartMapping) => {
    setEditingMapping(m)
    setFormData({
      customer_id: m.customer_id,
      customer_part_number: m.customer_part_number || '',
      internal_part_number: m.internal_part_number,
      category: m.category || '',
      packaging: m.packaging || '',
      package_quantity: m.package_quantity,
      tier1_range: m.tier1_range || '', tier1_price: m.tier1_price,
      tier2_range: m.tier2_range || '', tier2_price: m.tier2_price,
      tier3_range: m.tier3_range || '', tier3_price: m.tier3_price,
      tier4_range: m.tier4_range || '', tier4_price: m.tier4_price,
      tier5_range: m.tier5_range || '', tier5_price: m.tier5_price,
      notes: m.notes || '',
    })
    setShowMappingDialog(true)
  }

  const openNew = () => {
    setEditingMapping(null)
    setFormData(EMPTY_MAPPING)
    setShowMappingDialog(true)
  }

  const fmt = (v: number | null) => v != null ? `$${v.toFixed(2)}` : '—'

  // Auto-compute contribution preview in form
  const formLowest = (() => {
    const prices = [formData.tier1_price, formData.tier2_price, formData.tier3_price, formData.tier4_price, formData.tier5_price]
      .filter((p): p is number => p != null && p > 0)
    return prices.length > 0 ? Math.min(...prices) : null
  })()

  const formContribution = editingMapping
    ? computeContributionLevel(formLowest, editingMapping.variable_cost, editingMapping.total_cost, editingMapping.sales_target)
    : null
  const hasValidBomSelection = !formData.internal_part_number || bomPartNumbers.includes(formData.internal_part_number)
  const hasBomOptions = bomPartNumbers.length > 0
  const missingCurrentBomPart = !hasValidBomSelection && editingMapping && formData.internal_part_number
  const internalPartPlaceholder = bomLoading
    ? 'Loading BOM part numbers...'
    : !hasBomOptions
      ? 'No BOM part numbers available'
    : missingCurrentBomPart
      ? `Current: ${formData.internal_part_number} (not in BOM)`
      : 'Select BOM part number'

  return (
    <div className="p-4 pb-20">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold">👥 {t('page.customerRef')}</h1>
        <Button variant="ghost" size="icon" onClick={fetchData} disabled={loading}>
          <RefreshCw className={`size-5 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>
      <p className="text-muted-foreground text-sm mb-4">
        {t('page.customerRefSubtitle')}
      </p>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <Card className="bg-purple-500/10 border-purple-500/20">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <Users className="size-4 text-purple-400" />
              <div>
                <p className="text-xs text-purple-400">Total Mappings</p>
                <p className="text-xl font-bold text-purple-400">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-red-500/10 border-red-500/20">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-red-400" />
              <div>
                <p className="text-xs text-red-400">Critical Loss</p>
                <p className="text-xl font-bold text-red-400">{stats.critical}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-amber-500/10 border-amber-500/20">
          <CardContent className="p-3">
            <p className="text-xs text-amber-400">Marginal</p>
            <p className="text-xl font-bold text-amber-400">{stats.marginal}</p>
          </CardContent>
        </Card>
        <Card className="bg-yellow-500/10 border-yellow-500/20">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="size-4 text-yellow-400" />
              <div>
                <p className="text-xs text-yellow-400">Net Profitable</p>
                <p className="text-xl font-bold text-yellow-400">{stats.profitable}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-green-500/10 border-green-500/20">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <Target className="size-4 text-green-400" />
              <div>
                <p className="text-xs text-green-400">Target Achieved</p>
                <p className="text-xl font-bold text-green-400">{stats.target}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder={t('ui.search')}
            value={search}
            onChange={(e) => { setSearch(e.target.value) }}
            className="pl-9"
          />
        </div>
        <Select value={filterCustomer} onValueChange={(v) => { setFilterCustomer(v) }}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t('salesCustomers.allCustomers')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Customers</SelectItem>
            {customers.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterLevel} onValueChange={(v) => { setFilterLevel(v) }}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t('customerRef.allLevels')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Levels</SelectItem>
            <SelectItem value="Critical Loss">{t('customerRef.criticalLoss')}</SelectItem>
            <SelectItem value="Marginal Coverage">{t('customerRef.marginalCoverage')}</SelectItem>
            <SelectItem value="Net Profitable">{t('customerRef.netProfitable')}</SelectItem>
            <SelectItem value="Target Achieved">{t('customerRef.targetAchieved')}</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant={showDuplicatesOnly ? 'default' : 'outline'}
          onClick={() => setShowDuplicatesOnly(!showDuplicatesOnly)}
          className={showDuplicatesOnly ? 'bg-amber-600 hover:bg-amber-700 text-white' : ''}
        >
          <AlertCircle className="size-4 mr-1" /> {showDuplicatesOnly ? 'Show All' : 'Show Duplicates'}
          {!showDuplicatesOnly && stats.duplicates > 0 && (
            <span className="ml-1 text-[10px] bg-amber-500/20 text-amber-500 px-1.5 py-0.5 rounded-full">{stats.duplicates}</span>
          )}
        </Button>
        <Button variant="outline" onClick={() => { setShowAuditPanel(!showAuditPanel) }}>
          <History className="size-4 mr-1" /> Audit Trail
        </Button>
        <Button variant="outline" onClick={() => setShowCustomerDialog(true)}>
          <Plus className="size-4 mr-1" /> Customer
        </Button>
        <Button onClick={openNew}>
          <Plus className="size-4 mr-1" /> Part Mapping
        </Button>
      </div>

      {/* Duplicate warning banner */}
      {stats.duplicates > 0 && (
        <div className="flex items-center gap-2 mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-500 text-sm">
          <AlertCircle className="size-4 flex-shrink-0" />
          <span>
            <strong>{stats.duplicates} duplicate{stats.duplicates > 1 ? 's' : ''}</strong> found — same internal part number used more than once for the same customer. Rows are highlighted below.
          </span>
        </div>
      )}

      {/* Audit Trail Panel */}
      {showAuditPanel && (
        <div className="mb-4 rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold flex items-center gap-2">
              <History className="size-4" /> Change History
            </h3>
            <Button variant="ghost" size="sm" onClick={() => setShowAuditPanel(false)}>Close</Button>
          </div>
          <div className="flex gap-2 mb-3">
            <Input
              placeholder="Filter by user..."
              value={auditFilterUser}
              onChange={(e) => setAuditFilterUser(e.target.value)}
              className="max-w-[200px] text-sm"
            />
            <Select value={auditFilterAction} onValueChange={setAuditFilterAction}>
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                <SelectItem value="created">Created</SelectItem>
                <SelectItem value="updated">Updated</SelectItem>
                <SelectItem value="deleted">Deleted</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={fetchAudit} disabled={auditLoading}>
              <RefreshCw className={`size-3 mr-1 ${auditLoading ? 'animate-spin' : ''}`} /> Refresh
            </Button>
          </div>
          <div className="max-h-[400px] overflow-y-auto">
            {auditLoading ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Loading...</p>
            ) : auditEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No changes recorded yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="border-b text-muted-foreground text-xs">
                    <th className="text-left px-2 py-1.5 font-medium">When</th>
                    <th className="text-left px-2 py-1.5 font-medium">Who</th>
                    <th className="text-left px-2 py-1.5 font-medium">Action</th>
                    <th className="text-left px-2 py-1.5 font-medium">Field</th>
                    <th className="text-left px-2 py-1.5 font-medium">Old Value</th>
                    <th className="text-left px-2 py-1.5 font-medium">New Value</th>
                  </tr>
                </thead>
                <tbody>
                  {auditEntries.map((entry) => (
                    <tr key={entry.id} className="border-b border-border/30 hover:bg-muted/20">
                      <td className="px-2 py-1.5 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(entry.created_at).toLocaleString()}
                      </td>
                      <td className="px-2 py-1.5 text-xs font-medium">
                        {entry.performed_by_name || 'Unknown'}
                      </td>
                      <td className="px-2 py-1.5">
                        <Badge variant="outline" className={
                          entry.action === 'created' ? 'bg-green-500/10 text-green-500 border-green-500/30' :
                          entry.action === 'deleted' ? 'bg-red-500/10 text-red-500 border-red-500/30' :
                          'bg-blue-500/10 text-blue-500 border-blue-500/30'
                        }>
                          {entry.action}
                        </Badge>
                      </td>
                      <td className="px-2 py-1.5 text-xs font-mono">{entry.field_name || '—'}</td>
                      <td className="px-2 py-1.5 text-xs max-w-[150px] truncate text-red-400" title={entry.old_value || ''}>
                        {entry.old_value || '—'}
                      </td>
                      <td className="px-2 py-1.5 text-xs max-w-[150px] truncate text-green-400" title={entry.new_value || ''}>
                        {entry.new_value || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <TableSkeleton rows={8} />
      ) : (
        <DataTable
          table={table}
          data={tableData}
          noun="mapping"
          exportFilename="customer-reference"
          page="customer-reference"
          initialView={initialView}
          autoExport={autoExport}
          getRowKey={(row) => (row as unknown as PartMapping).id}
          onRowClick={(row) => openEdit(row as unknown as PartMapping)}
          rowClassName={(row) => isDuplicate(row as unknown as PartMapping) ? 'bg-amber-500/5 border-l-2 border-l-amber-500' : ''}
        />
      )}

      {/* Add Customer Dialog */}
      <Dialog open={showCustomerDialog} onOpenChange={setShowCustomerDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Customer</DialogTitle>
            <DialogDescription>Create a new customer record.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Name *</Label>
              <Input value={customerForm.name} onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })} />
            </div>
            <div>
              <Label>Payment Terms</Label>
              <Input value={customerForm.payment_terms} onChange={(e) => setCustomerForm({ ...customerForm, payment_terms: e.target.value })} />
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={customerForm.notes} onChange={(e) => setCustomerForm({ ...customerForm, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCustomerDialog(false)}>Cancel</Button>
            <Button onClick={handleSaveCustomer} disabled={saving || !customerForm.name}>
              {saving ? t('ui.saving') : t('ui.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add/Edit Part Mapping Dialog */}
      <Dialog open={showMappingDialog} onOpenChange={(open) => {
        setShowMappingDialog(open)
        if (!open) {
          setEditingMapping(null)
        }
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingMapping ? t('ui.edit') : t('ui.add')} {t('customerRef.partMapping')}</DialogTitle>
            <DialogDescription>
              {editingMapping ? 'Update the part mapping details.' : 'Create a new customer part mapping.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>Customer *</Label>
              <Select value={formData.customer_id} onValueChange={(v) => setFormData({ ...formData, customer_id: v })}>
                <SelectTrigger>
                  <SelectValue placeholder={t('customerRef.selectCustomer')} />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Customer Part Number</Label>
              <Input value={formData.customer_part_number || ''} onChange={(e) => setFormData({ ...formData, customer_part_number: e.target.value })} />
            </div>
            <div>
              <Label>Internal Part Number *</Label>
              <Select
                value={hasValidBomSelection ? formData.internal_part_number || undefined : undefined}
                onValueChange={(value) => setFormData({ ...formData, internal_part_number: value })}
              >
                <SelectTrigger
                  className="w-full [&>[data-slot=select-value]]:flex-1 [&>[data-slot=select-value]]:text-left [&>svg]:opacity-100"
                  disabled={bomLoading || !hasBomOptions}
                >
                  <SelectValue placeholder={internalPartPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {missingCurrentBomPart ? (
                    <SelectItem value={formData.internal_part_number} disabled>
                      {formData.internal_part_number} (not in BOM)
                    </SelectItem>
                  ) : null}
                  {hasBomOptions ? (
                    bomPartNumbers.map((pn) => (
                      <SelectItem key={pn} value={pn}>
                        {pn}
                      </SelectItem>
                    ))
                  ) : null}
                </SelectContent>
              </Select>
              {!bomLoading && !hasBomOptions ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  No BOM part numbers are available yet. Create BOM entries before creating or updating a part mapping.
                </p>
              ) : null}
              {missingCurrentBomPart ? (
                <p className="mt-1 text-sm text-amber-600">
                  The current internal part number is no longer in the BOM. Select a current BOM part to save changes.
                </p>
              ) : null}
              <Button
                type="button"
                variant="link"
                className="h-auto px-0 mt-1 text-sm"
                onClick={() => router.push('/bom')}
              >
                Create BOM
              </Button>
            </div>
            <div>
              <Label>Category</Label>
              <Input value={formData.category || ''} onChange={(e) => setFormData({ ...formData, category: e.target.value })} />
            </div>
            <div>
              <Label>Packaging</Label>
              <Input value={formData.packaging || ''} onChange={(e) => setFormData({ ...formData, packaging: e.target.value })} />
            </div>
            <div>
              <Label>Package Quantity</Label>
              <Input type="number" value={formData.package_quantity ?? ''} onChange={(e) => setFormData({ ...formData, package_quantity: e.target.value ? Number(e.target.value) : null })} />
            </div>

            {/* Tier prices */}
            <div className="col-span-2">
              <Label className="mb-2 block">Tier Pricing</Label>
              <div className="grid grid-cols-5 gap-2">
                {([1, 2, 3, 4, 5] as const).map((tier) => {
                  const rangeKey = `tier${tier}_range` as keyof MappingFormData
                  const priceKey = `tier${tier}_price` as keyof MappingFormData
                  return (
                    <div key={tier} className="space-y-1">
                      <p className="text-xs text-muted-foreground">Tier {tier}</p>
                      <Input
                        placeholder={t('customerRef.range')}
                        className="text-xs"
                        value={String(formData[rangeKey] ?? '')}
                        onChange={(e) => setFormData({ ...formData, [rangeKey]: e.target.value })}
                      />
                      <Input
                        type="number"
                        step="0.01"
                        placeholder={t('table.price')}
                        className="text-xs"
                        value={formData[priceKey] ?? ''}
                        onChange={(e) => setFormData({ ...formData, [priceKey]: e.target.value ? Number(e.target.value) : null })}
                      />
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Contribution preview */}
            {formContribution && (
              <div className="col-span-2">
                <Badge variant="outline" className={getContributionColor(formContribution)}>
                  Preview: {formContribution} (Lowest: ${formLowest?.toFixed(2)})
                </Badge>
              </div>
            )}

            <div className="col-span-2">
              <Label>Notes</Label>
              <Input value={formData.notes || ''} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} />
            </div>
          </div>
          {/* Duplicate warning in edit dialog */}
          {editingMapping && isDuplicate(editingMapping) && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-500 text-sm">
              <AlertCircle className="size-4 flex-shrink-0" />
              <span>
                <strong>Duplicate detected:</strong> This internal part number (<code>{editingMapping.internal_part_number}</code>) appears more than once for this customer. Consider deleting the duplicate.
              </span>
            </div>
          )}

          <DialogFooter className="flex !justify-between">
            <div>
              {editingMapping && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    setDeleteTarget(editingMapping)
                    setShowMappingDialog(false)
                    setShowDeleteDialog(true)
                  }}
                >
                  <Trash2 className="size-3.5 mr-1" /> Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setShowMappingDialog(false); setEditingMapping(null) }}>Cancel</Button>
              <Button onClick={handleSaveMapping} disabled={saving || !formData.customer_id || !formData.internal_part_number || !hasValidBomSelection}>
                {saving ? t('ui.saving') : editingMapping ? t('customerRef.update') : t('customerRef.create')}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Part Mapping</DialogTitle>
            <DialogDescription>This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <p className="text-sm">
            Are you sure you want to delete the mapping for{' '}
            <strong>{deleteTarget?.internal_part_number}</strong>
            {deleteTarget?.customers?.name ? ` (${deleteTarget.customers.name})` : ''}?
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={saving}>
              {saving ? t('customerRef.deleting') : t('ui.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
