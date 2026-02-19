'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Search, Plus, Copy, Pencil, Trash2, Users, AlertTriangle, TrendingUp, Target,
  ChevronLeft, ChevronRight, RefreshCw,
} from 'lucide-react'
import { getContributionColor, computeContributionLevel } from '@/lib/cost-config'
import { useI18n } from '@/lib/i18n'

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

const PAGE_SIZE = 25

export default function CustomerReferencePage() {
  const [mappings, setMappings] = useState<PartMapping[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterCustomer, setFilterCustomer] = useState<string>('all')
  const [filterLevel, setFilterLevel] = useState<string>('all')
  const [page, setPage] = useState(0)

  // Dialog states
  const [showCustomerDialog, setShowCustomerDialog] = useState(false)
  const [showMappingDialog, setShowMappingDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [editingMapping, setEditingMapping] = useState<PartMapping | null>(null)
  const [formData, setFormData] = useState<MappingFormData>(EMPTY_MAPPING)
  const [customerForm, setCustomerForm] = useState({ name: '', payment_terms: 'Net 30', notes: '' })
  const [deleteTarget, setDeleteTarget] = useState<PartMapping | null>(null)
  const [saving, setSaving] = useState(false)
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
    return true
  })

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  // Stats
  const stats = {
    total: mappings.length,
    critical: mappings.filter((m) => m.contribution_level === 'Critical Loss').length,
    marginal: mappings.filter((m) => m.contribution_level === 'Marginal Coverage').length,
    profitable: mappings.filter((m) => m.contribution_level === 'Net Profitable').length,
    target: mappings.filter((m) => m.contribution_level === 'Target Achieved').length,
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
        body: JSON.stringify(formData),
      })
      if (!res.ok) throw new Error('Failed')
      setShowMappingDialog(false)
      setEditingMapping(null)
      setFormData(EMPTY_MAPPING)
      fetchData()
    } catch { /* ignore */ } finally { setSaving(false) }
  }

  const handleDuplicate = async (mapping: PartMapping) => {
    try {
      const res = await fetch('/api/customer-part-mappings/duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: mapping.id }),
      })
      if (!res.ok) throw new Error('Failed')
      const cloned = await res.json()
      // Open edit dialog with the clone
      openEdit(cloned)
      fetchData()
    } catch { /* ignore */ }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setSaving(true)
    try {
      await fetch(`/api/customer-part-mappings/${deleteTarget.id}`, { method: 'DELETE' })
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
            onChange={(e) => { setSearch(e.target.value); setPage(0) }}
            className="pl-9"
          />
        </div>
        <Select value={filterCustomer} onValueChange={(v) => { setFilterCustomer(v); setPage(0) }}>
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
        <Select value={filterLevel} onValueChange={(v) => { setFilterLevel(v); setPage(0) }}>
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
        <Button variant="outline" onClick={() => setShowCustomerDialog(true)}>
          <Plus className="size-4 mr-1" /> Customer
        </Button>
        <Button onClick={openNew}>
          <Plus className="size-4 mr-1" /> Part Mapping
        </Button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : (
        <>
          <div className="rounded-lg border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Cust P/N</TableHead>
                  <TableHead>Internal P/N</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Lowest Price</TableHead>
                  <TableHead className="text-right">Variable Cost</TableHead>
                  <TableHead className="text-right">Total Cost</TableHead>
                  <TableHead className="text-right">Sales Target</TableHead>
                  <TableHead>Contribution</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-10 text-muted-foreground">
                      {t('ui.noResults')}
                    </TableCell>
                  </TableRow>
                ) : (
                  paged.map((m) => (
                    <TableRow key={m.id} className="hover:bg-muted/50">
                      <TableCell className="font-medium">{m.customers?.name || '—'}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{m.customer_part_number || '—'}</TableCell>
                      <TableCell className="font-mono text-sm">{m.internal_part_number}</TableCell>
                      <TableCell className="text-sm">{m.category || '—'}</TableCell>
                      <TableCell className="text-right font-medium">{fmt(m.lowest_quoted_price)}</TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">{fmt(m.variable_cost)}</TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">{fmt(m.total_cost)}</TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">{fmt(m.sales_target)}</TableCell>
                      <TableCell>
                        {m.contribution_level ? (
                          <Badge variant="outline" className={getContributionColor(m.contribution_level)}>
                            {m.contribution_level}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="size-7" onClick={() => openEdit(m)} title="Edit">
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="size-7" onClick={() => handleDuplicate(m)} title="Duplicate">
                            <Copy className="size-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="size-7 text-destructive" onClick={() => { setDeleteTarget(m); setShowDeleteDialog(true) }} title="Delete">
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-3">
              <p className="text-sm text-muted-foreground">
                Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
              </p>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                  <ChevronLeft className="size-4" />
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </>
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
      <Dialog open={showMappingDialog} onOpenChange={(open) => { setShowMappingDialog(open); if (!open) setEditingMapping(null) }}>
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
              <Input value={formData.internal_part_number} onChange={(e) => setFormData({ ...formData, internal_part_number: e.target.value })} />
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
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowMappingDialog(false); setEditingMapping(null) }}>Cancel</Button>
            <Button onClick={handleSaveMapping} disabled={saving || !formData.customer_id || !formData.internal_part_number}>
              {saving ? t('ui.saving') : editingMapping ? t('customerRef.update') : t('customerRef.create')}
            </Button>
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
