'use client'

import { Fragment, useState, useEffect, useCallback, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  ChevronRight, ChevronDown, Plus, Trash2, Copy, Save, RefreshCw, Settings, Search, AlertTriangle, Pencil, History,
} from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useI18n } from '@/lib/i18n'

// ─── Audit Types ────────────────────────────────────────────────

interface BomAuditEntry {
  id: string
  entity_type: string
  entity_id: string
  action: string
  field_name: string | null
  old_value: string | null
  new_value: string | null
  performed_by_name: string | null
  performed_by_email: string | null
  created_at: string
}

// ─── Types ───────────────────────────────────────────────────────

interface IndividualItem {
  id: string
  part_number: string
  description: string | null
  cost_per_unit: number
  unit: string
  supplier: string | null
  lead_time: number | null
}

interface SubAssemblyComponent {
  id: string
  sub_assembly_id: string
  component_part_number: string
  quantity: number
  cost: number
  is_scrap: boolean
  scrap_rate: number | null
  sort_order: number
}

interface SubAssembly {
  id: string
  part_number: string
  category: string | null
  mold_name: string | null
  part_weight: number | null
  parts_per_hour: number | null
  labor_rate_per_hour: number
  num_employees: number
  material_cost: number
  labor_cost_per_part: number
  overhead_cost: number
  total_cost: number
  bom_sub_assembly_components: SubAssemblyComponent[]
}

interface FinalAssemblyComponent {
  id: string
  final_assembly_id: string
  component_part_number: string
  component_source: string
  quantity: number
  quantity_formula: string | null
  cost: number
  sort_order: number
}

interface EditableSubAssemblyComponent {
  component_part_number: string
  quantity: string
}

interface EditableFinalAssemblyComponent {
  component_source: 'sub_assembly' | 'individual_item'
  component_part_number: string
  quantity: string
  quantity_formula: string
}

interface FinalAssembly {
  id: string
  part_number: string
  product_category: string | null
  sub_product_category: string | null
  description: string | null
  notes: string | null
  parts_per_package: number | null
  parts_per_hour: number | null
  labor_rate_per_hour: number
  num_employees: number
  labor_cost_per_part: number
  shipping_labor_cost: number
  subtotal_cost: number
  overhead_pct: number
  overhead_cost: number
  admin_pct: number
  admin_cost: number
  depreciation_pct: number
  depreciation_cost: number
  repairs_pct: number
  repairs_cost: number
  variable_cost: number
  total_cost: number
  profit_target_pct: number
  profit_amount: number
  sales_target: number
  bom_final_assembly_components: FinalAssemblyComponent[]
}

interface BomConfig {
  id: string
  key: string
  value: number
  label: string
  description: string
}

// ─── Helpers ─────────────────────────────────────────────────────

const fmt = (n: number) => `$${Number(n).toFixed(n < 1 ? 4 : 2)}`
const pct = (n: number) => `${(Number(n) * 100).toFixed(2)}%`
const FINAL_COMPONENT_SOURCES = [
  { value: 'sub_assembly', label: 'Sub-Assembly' },
  { value: 'individual_item', label: 'Individual Item' },
] as const

// ─── Select-or-Create Combo ──────────────────────────────────────

function SelectOrCreate({ value, onChange, options, placeholder, label }: {
  value: string
  onChange: (v: string) => void
  options: string[]
  placeholder?: string
  label?: string
}) {
  const [mode, setMode] = useState<'select' | 'create'>('select')
  const [customValue, setCustomValue] = useState('')

  // If value is set but not in options, show it as custom
  const isCustom = value !== '' && !options.includes(value)

  if (mode === 'create' || isCustom) {
    return (
      <div className="flex gap-2">
        <Input
          value={isCustom && mode !== 'create' ? value : customValue}
          onChange={e => {
            setCustomValue(e.target.value)
            onChange(e.target.value)
          }}
          placeholder={placeholder || 'Type new value...'}
          className="flex-1"
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 px-2 text-xs whitespace-nowrap"
          onClick={() => { setMode('select'); setCustomValue(''); onChange('') }}
        >
          ← List
        </Button>
      </div>
    )
  }

  return (
    <Select
      value={value || undefined}
      onValueChange={v => {
        if (v === '__create_new__') {
          setMode('create')
          setCustomValue('')
          onChange('')
        } else {
          onChange(v)
        }
      }}
    >
      <SelectTrigger>
        <SelectValue placeholder={placeholder || 'Select...'} />
      </SelectTrigger>
      <SelectContent>
        {options.map(opt => (
          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
        ))}
        <SelectItem value="__create_new__" className="text-primary font-medium border-t mt-1 pt-1">
          + Add New
        </SelectItem>
      </SelectContent>
    </Select>
  )
}

// ─── Main Page ───────────────────────────────────────────────────

export default function BOMExplorer() {
  const { t } = useI18n()
  const { profile } = useAuth()
  const [tab, setTab] = useState('individual')
  const [individualItems, setIndividualItems] = useState<IndividualItem[]>([])
  const [subAssemblies, setSubAssemblies] = useState<SubAssembly[]>([])
  const [finalAssemblies, setFinalAssemblies] = useState<FinalAssembly[]>([])
  const [config, setConfig] = useState<BomConfig[]>([])
  const [inventoryParts, setInventoryParts] = useState<{ partNumber: string; product: string }[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)

  // Audit trail states
  const [showAuditPanel, setShowAuditPanel] = useState(false)
  const [auditEntries, setAuditEntries] = useState<BomAuditEntry[]>([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditFilterUser, setAuditFilterUser] = useState('')
  const [auditFilterAction, setAuditFilterAction] = useState<string>('all')
  const [auditFilterEntityType, setAuditFilterEntityType] = useState<string>('all')

  const fetchAll = useCallback(async (bust = false) => {
    setLoading(true)
    const qs = bust ? `?t=${Date.now()}` : ''
    try {
      const [items, subs, finals, cfg, inv] = await Promise.all([
        fetch(`/api/bom/individual-items${qs}`).then(r => r.json()),
        fetch(`/api/bom/sub-assemblies${qs}`).then(r => r.json()),
        fetch(`/api/bom/final-assemblies${qs}`).then(r => r.json()),
        fetch(`/api/bom/config${qs}`).then(r => r.json()),
        fetch(`/api/inventory${qs}`).then(r => r.json()).catch(() => []),
      ])
      setIndividualItems(items)
      setSubAssemblies(subs)
      setFinalAssemblies(finals)
      setConfig(cfg)
      if (Array.isArray(inv)) {
        setInventoryParts(inv.map((i: { partNumber: string; product: string }) => ({ partNumber: i.partNumber, product: i.product })))
      }
    } catch (e) {
      console.error('Failed to fetch BOM data', e)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const fetchAudit = useCallback(async () => {
    setAuditLoading(true)
    try {
      const params = new URLSearchParams({ limit: '200' })
      if (auditFilterUser) params.set('performed_by', auditFilterUser)
      if (auditFilterAction !== 'all') params.set('action', auditFilterAction)
      if (auditFilterEntityType !== 'all') params.set('entity_type', auditFilterEntityType)
      const res = await fetch(`/api/bom/audit?${params}`)
      const data = await res.json()
      setAuditEntries(data.entries || [])
    } catch { /* ignore */ }
    finally { setAuditLoading(false) }
  }, [auditFilterUser, auditFilterAction, auditFilterEntityType])

  useEffect(() => {
    if (showAuditPanel) fetchAudit()
  }, [showAuditPanel, fetchAudit])

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('page.bom')}</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t('ui.search')}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 w-64"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => fetchAll(true)} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowAuditPanel(!showAuditPanel)}>
            <History className="h-4 w-4 mr-1" /> Audit Trail
          </Button>
        </div>
      </div>

      {/* Audit Trail Panel */}
      {showAuditPanel && (
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold flex items-center gap-2">
              <History className="size-4" /> BOM Change History
            </h3>
            <Button variant="ghost" size="sm" onClick={() => setShowAuditPanel(false)}>Close</Button>
          </div>
          <div className="flex gap-2 mb-3 flex-wrap">
            <Input
              placeholder="Filter by user..."
              value={auditFilterUser}
              onChange={(e) => setAuditFilterUser(e.target.value)}
              className="max-w-[200px] text-sm"
            />
            <Select value={auditFilterEntityType} onValueChange={setAuditFilterEntityType}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Entity Types</SelectItem>
                <SelectItem value="individual_item">Individual Items</SelectItem>
                <SelectItem value="sub_assembly">Sub-Assemblies</SelectItem>
                <SelectItem value="final_assembly">Final Assemblies</SelectItem>
              </SelectContent>
            </Select>
            <Select value={auditFilterAction} onValueChange={setAuditFilterAction}>
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                <SelectItem value="created">Created</SelectItem>
                <SelectItem value="updated">Updated</SelectItem>
                <SelectItem value="deleted">Deleted</SelectItem>
                <SelectItem value="duplicated">Duplicated</SelectItem>
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
                    <th className="text-left px-2 py-1.5 font-medium">Date</th>
                    <th className="text-left px-2 py-1.5 font-medium">User</th>
                    <th className="text-left px-2 py-1.5 font-medium">Action</th>
                    <th className="text-left px-2 py-1.5 font-medium">Entity Type</th>
                    <th className="text-left px-2 py-1.5 font-medium">Field Changed</th>
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
                          entry.action === 'duplicated' ? 'bg-purple-500/10 text-purple-500 border-purple-500/30' :
                          'bg-blue-500/10 text-blue-500 border-blue-500/30'
                        }>
                          {entry.action}
                        </Badge>
                      </td>
                      <td className="px-2 py-1.5 text-xs">
                        <span className={`px-1.5 py-0.5 rounded text-xs ${
                          entry.entity_type === 'individual_item' ? 'bg-amber-500/20 text-amber-400' :
                          entry.entity_type === 'sub_assembly' ? 'bg-blue-500/20 text-blue-400' :
                          'bg-indigo-500/20 text-indigo-400'
                        }`}>
                          {entry.entity_type === 'individual_item' ? 'Individual Item' :
                           entry.entity_type === 'sub_assembly' ? 'Sub-Assembly' : 'Final Assembly'}
                        </span>
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

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="individual">{t('bom.individualItems')} ({individualItems.length})</TabsTrigger>
          <TabsTrigger value="sub">{t('bom.subAssemblies')} ({subAssemblies.length})</TabsTrigger>
          <TabsTrigger value="final">{t('bom.finalAssemblies')} ({finalAssemblies.length})</TabsTrigger>
          <TabsTrigger value="changelog">Cost Change Log</TabsTrigger>
        </TabsList>

        <TabsContent value="individual">
          <IndividualItemsTab items={individualItems} inventoryParts={inventoryParts} search={search} onRefresh={fetchAll} />
        </TabsContent>
        <TabsContent value="sub">
          <SubAssembliesTab assemblies={subAssemblies} individualItems={individualItems} search={search} onRefresh={fetchAll} />
        </TabsContent>
        <TabsContent value="final">
          <FinalAssembliesTab
            assemblies={finalAssemblies}
            subAssemblies={subAssemblies}
            individualItems={individualItems}
            config={config}
            search={search}
            onRefresh={fetchAll}
          />
        </TabsContent>
        <TabsContent value="changelog">
          <CostChangeLogTab search={search} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ─── Tab 1: Individual Items ─────────────────────────────────────

function IndividualItemsTab({ items, inventoryParts, search, onRefresh }: {
  items: IndividualItem[]
  inventoryParts: { partNumber: string; product: string }[]
  search: string
  onRefresh: (bust?: boolean) => void
}) {
  const { t } = useI18n()
  const { profile } = useAuth()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editCost, setEditCost] = useState('')
  const [editingLeadTimeId, setEditingLeadTimeId] = useState<string | null>(null)
  const [editLeadTime, setEditLeadTime] = useState('')
  const [savingLeadTime, setSavingLeadTime] = useState(false)
  const savingLeadTimeRef = useRef(false)
  const leadTimeCancelledRef = useRef(false)
  const [showAdd, setShowAdd] = useState(false)
  const [newItem, setNewItem] = useState({ part_number: '', description: '', cost_per_unit: '', unit: 'lb', supplier: '' })
  const { costHistoryId, costHistoryData, costHistoryLoading, costHistoryError, toggleCostHistory } = useCostHistory('individual')

  const performedBy = {
    _performed_by_name: profile?.full_name || 'Unknown',
    _performed_by_email: profile?.email || '',
  }

  const filtered = items.filter(i =>
    i.part_number.toLowerCase().includes(search.toLowerCase()) ||
    (i.description || '').toLowerCase().includes(search.toLowerCase()) ||
    (i.supplier || '').toLowerCase().includes(search.toLowerCase())
  )

  const saveCost = async (id: string) => {
    await fetch(`/api/bom/individual-items/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cost_per_unit: Number(editCost), ...performedBy }),
    })
    setEditingId(null)
    onRefresh(true)
  }

  const saveLeadTime = async (id: string) => {
    if (savingLeadTimeRef.current || leadTimeCancelledRef.current) return
    const trimmed = editLeadTime.trim()
    const value = trimmed === '' ? null : Number(trimmed)
    if (value !== null && (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0)) return
    savingLeadTimeRef.current = true
    setSavingLeadTime(true)
    try {
      const res = await fetch(`/api/bom/individual-items/${id}/update-lead-time`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_time: value, ...performedBy }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        alert(`Failed to save lead time: ${body.error || res.statusText}`)
        return
      }
      setEditingLeadTimeId(null)
      onRefresh(true)
    } catch (e) {
      alert(`Failed to save lead time: ${e instanceof Error ? e.message : 'Network error'}`)
    } finally {
      savingLeadTimeRef.current = false
      setSavingLeadTime(false)
    }
  }

  const deleteItem = async (id: string) => {
    if (!confirm('Delete this item? This may affect sub-assemblies and final assemblies.')) return
    await fetch(`/api/bom/individual-items/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(performedBy),
    })
    onRefresh(true)
  }

  const addItem = async () => {
    await fetch('/api/bom/individual-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newItem, cost_per_unit: Number(newItem.cost_per_unit), ...performedBy }),
    })
    setShowAdd(false)
    setNewItem({ part_number: '', description: '', cost_per_unit: '', unit: 'lb', supplier: '' })
    onRefresh(true)
  }

  const duplicateItem = async (id: string, partNumber: string) => {
    const newPart = prompt('New part number for the clone:', `${partNumber}-COPY`)
    if (!newPart) return
    try {
      const res = await fetch('/api/bom/individual-items/duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, new_part_number: newPart, ...performedBy }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        alert(`Clone failed: ${body.error || res.statusText}`)
        return
      }
      onRefresh(true)
    } catch (e) {
      alert(`Clone failed: ${e instanceof Error ? e.message : 'Network error'}`)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-lg">{t('bom.rawMaterials')}</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">{t('bom.costCascadeNote')}</p>
        </div>
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add Item</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader><DialogTitle>{t('bom.addItem')}</DialogTitle></DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-2">
                <Label>Part Number *</Label>
                <Input placeholder="Type to search or enter custom part number..." value={newItem.part_number} onChange={e => setNewItem({ ...newItem, part_number: e.target.value })} />
                {inventoryParts.length > 0 && (() => {
                  const filtered = inventoryParts.filter(p =>
                    !newItem.part_number ||
                    p.partNumber.toLowerCase().includes(newItem.part_number.toLowerCase()) ||
                    p.product.toLowerCase().includes(newItem.part_number.toLowerCase())
                  )
                  return (
                    <div className="border rounded-md max-h-64 overflow-y-auto">
                      {filtered.length > 0 ? filtered.map(p => (
                        <button
                          key={p.partNumber}
                          type="button"
                          className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent flex justify-between items-center ${newItem.part_number === p.partNumber ? 'bg-accent font-medium' : ''}`}
                          onClick={() => setNewItem({ ...newItem, part_number: p.partNumber, description: p.product || newItem.description })}
                        >
                          <span className="font-mono">{p.partNumber}</span>
                          <span className="text-muted-foreground text-xs truncate ml-2 max-w-[200px]">{p.product}</span>
                        </button>
                      )) : (
                        <p className="px-3 py-2 text-xs text-muted-foreground">No matching inventory items</p>
                      )}
                    </div>
                  )
                })()}
              </div>
              <Input placeholder={t('table.description')} value={newItem.description} onChange={e => setNewItem({ ...newItem, description: e.target.value })} />
              <Input placeholder="Cost per Unit *" type="number" step="0.0001" value={newItem.cost_per_unit} onChange={e => setNewItem({ ...newItem, cost_per_unit: e.target.value })} />
              <Select value={newItem.unit} onValueChange={v => setNewItem({ ...newItem, unit: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="lb">lb</SelectItem>
                  <SelectItem value="ea">ea</SelectItem>
                  <SelectItem value="ft">ft</SelectItem>
                  <SelectItem value="roll">roll</SelectItem>
                </SelectContent>
              </Select>
              <Input placeholder={t('bom.supplier')} value={newItem.supplier} onChange={e => setNewItem({ ...newItem, supplier: e.target.value })} />
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">{t('ui.cancel')}</Button></DialogClose>
              <Button onClick={addItem} disabled={!newItem.part_number || !newItem.cost_per_unit}>{t('ui.save')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('table.partNumber')}</TableHead>
              <TableHead>{t('table.description')}</TableHead>
              <TableHead className="text-right">{t('bom.costPerUnit')}</TableHead>
              <TableHead>{t('bom.unit')}</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead className="text-right">Lead Time</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(item => (
              <Fragment key={item.id}>
              <TableRow key={item.id}>
                <TableCell className="font-mono text-sm">{item.part_number}</TableCell>
                <TableCell className="text-muted-foreground">{item.description}</TableCell>
                <TableCell className="text-right">
                  {editingId === item.id ? (
                    <div className="flex items-center gap-1 justify-end">
                      <Input
                        type="number"
                        step="0.0001"
                        value={editCost}
                        onChange={e => setEditCost(e.target.value)}
                        className="w-28 h-7 text-right"
                        onKeyDown={e => e.key === 'Enter' && saveCost(item.id)}
                        autoFocus
                      />
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => saveCost(item.id)}>
                        <Save className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <span
                      className="cursor-pointer hover:text-primary hover:underline"
                      onClick={() => { setEditingId(item.id); setEditCost(String(item.cost_per_unit)) }}
                    >
                      {fmt(item.cost_per_unit)}
                    </span>
                  )}
                </TableCell>
                <TableCell>{item.unit}</TableCell>
                <TableCell className="text-muted-foreground">{item.supplier}</TableCell>
                <TableCell className="text-right">
                  {editingLeadTimeId === item.id ? (
                    <div className="flex items-center gap-1 justify-end">
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        value={editLeadTime}
                        onChange={e => setEditLeadTime(e.target.value)}
                        className="w-20 h-7 text-right"
                        onKeyDown={e => {
                          if (e.key === 'Enter') e.currentTarget.blur()
                          if (e.key === 'Escape') { leadTimeCancelledRef.current = true; setEditingLeadTimeId(null) }
                        }}
                        onBlur={() => { if (!leadTimeCancelledRef.current) saveLeadTime(item.id); leadTimeCancelledRef.current = false }}
                        disabled={savingLeadTime}
                        autoFocus
                        placeholder="-"
                      />
                    </div>
                  ) : (
                    <span
                      className="cursor-pointer hover:text-primary hover:underline"
                      onClick={() => { setEditingLeadTimeId(item.id); setEditLeadTime(item.lead_time != null ? String(item.lead_time) : '') }}
                    >
                      {item.lead_time != null ? `${item.lead_time}d` : '-'}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" className={`h-7 px-2 ${costHistoryId === item.id ? 'bg-muted' : ''}`} onClick={() => toggleCostHistory(item.id, () => {})} title="Cost History">
                      <History className="h-3 w-3" />
                    </Button>
                    <EditIndividualItemDialog item={item} onSaved={() => onRefresh(true)} />
                    <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => duplicateItem(item.id, item.part_number)} title="Clone">
                      <Copy className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive" onClick={() => deleteItem(item.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
              {costHistoryId === item.id && (
                <TableRow key={`${item.id}-history`}>
                  <TableCell colSpan={7} className="bg-muted/30 p-4">
                    <CostHistoryPanel
                      data={costHistoryData}
                      loading={costHistoryLoading}
                      error={costHistoryError}
                    />
                  </TableCell>
                </TableRow>
              )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function NewSubAssemblyDialog({ individualItems, existingCategories, onCreated }: {
  individualItems: IndividualItem[]
  existingCategories: string[]
  onCreated: () => Promise<void> | void
}) {
  const { profile } = useAuth()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    part_number: '',
    category: '',
    mold_name: '',
    part_weight: '',
    parts_per_hour: '',
    labor_rate_per_hour: '29.25',
    num_employees: '1',
  })
  const [components, setComponents] = useState<EditableSubAssemblyComponent[]>([
    { component_part_number: '', quantity: '1' },
  ])

  const reset = () => {
    setForm({
      part_number: '',
      category: '',
      mold_name: '',
      part_weight: '',
      parts_per_hour: '',
      labor_rate_per_hour: '29.25',
      num_employees: '1',
    })
    setComponents([{ component_part_number: '', quantity: '1' }])
    setError(null)
    setSaving(false)
  }

  const submit = async () => {
    setSaving(true)
    setError(null)

    const payload = {
      ...form,
      components: components.map(component => ({
        component_part_number: component.component_part_number,
        quantity: component.quantity,
      })),
      _performed_by_name: profile?.full_name || 'Unknown',
      _performed_by_email: profile?.email || '',
    }

    try {
      const response = await fetch('/api/bom/sub-assemblies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create sub-assembly.')
      }

      await onCreated()
      setOpen(false)
      reset()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to create sub-assembly.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={nextOpen => {
        setOpen(nextOpen)
        if (!nextOpen) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-1" /> New Sub-Assembly</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[90vw] xl:max-w-[1200px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Sub-Assembly</DialogTitle>
        </DialogHeader>
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label>Part Number</Label>
              <Input value={form.part_number} onChange={e => setForm({ ...form, part_number: e.target.value })} placeholder="Required" />
            </div>
            <div className="grid gap-2">
              <Label>Category</Label>
              <SelectOrCreate
                value={form.category}
                onChange={v => setForm({ ...form, category: v })}
                options={existingCategories}
                placeholder="Select category..."
              />
            </div>
            <div className="grid gap-2">
              <Label>Mold Name</Label>
              <Input value={form.mold_name} onChange={e => setForm({ ...form, mold_name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Part Weight</Label>
                <Input type="number" min="0" step="0.0001" value={form.part_weight} onChange={e => setForm({ ...form, part_weight: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Parts per Hour</Label>
                <Input type="number" min="0" step="0.01" value={form.parts_per_hour} onChange={e => setForm({ ...form, parts_per_hour: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Labor Rate / Hr</Label>
                <Input type="number" min="0" step="0.01" value={form.labor_rate_per_hour} onChange={e => setForm({ ...form, labor_rate_per_hour: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label># Employees</Label>
                <Input type="number" min="0" step="0.1" value={form.num_employees} onChange={e => setForm({ ...form, num_employees: e.target.value })} />
              </div>
            </div>
          </div>
          <div className="grid gap-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold">Components</h3>
                <p className="text-xs text-muted-foreground">Sub-assemblies can only include individual items.</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setComponents([...components, { component_part_number: '', quantity: '1' }])}
              >
                <Plus className="h-4 w-4 mr-1" /> Add Component
              </Button>
            </div>
            <div className="space-y-3 max-h-[26rem] overflow-y-auto pr-1">
              {components.map((component, index) => (
                <div key={`sub-component-${index}`} className="grid gap-4 rounded-md border p-4 md:grid-cols-[minmax(0,1fr)_160px_48px] items-end">
                  <div className="grid gap-2">
                    <Label>Individual Item</Label>
                    <Select
                      value={component.component_part_number || undefined}
                      onValueChange={value => {
                        const next = [...components]
                        next[index] = { ...component, component_part_number: value }
                        setComponents(next)
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select part number" />
                      </SelectTrigger>
                      <SelectContent>
                        {individualItems.map(item => (
                          <SelectItem key={item.id} value={item.part_number}>
                            {item.part_number}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Quantity</Label>
                    <Input
                      type="number"
                      min="0.000001"
                      step="0.0001"
                      value={component.quantity}
                      onChange={e => {
                        const next = [...components]
                        next[index] = { ...component, quantity: e.target.value }
                        setComponents(next)
                      }}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-10 px-2 text-destructive"
                      onClick={() => setComponents(components.length === 1 ? [{ component_part_number: '', quantity: '1' }] : components.filter((_, componentIndex) => componentIndex !== index))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter className="gap-3 pt-4">
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={() => { void submit() }} disabled={saving}>
            {saving ? 'Saving...' : 'Save Sub-Assembly'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function NewFinalAssemblyDialog({ subAssemblies, individualItems, existingProductCategories, existingSubProductCategories, onCreated }: {
  subAssemblies: SubAssembly[]
  individualItems: IndividualItem[]
  existingProductCategories: string[]
  existingSubProductCategories: string[]
  onCreated: () => Promise<void> | void
}) {
  const { profile } = useAuth()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    part_number: '',
    product_category: '',
    sub_product_category: '',
    description: '',
    notes: '',
    parts_per_package: '',
    parts_per_hour: '',
    labor_rate_per_hour: '29.25',
    num_employees: '1',
    shipping_labor_cost: '0',
  })
  const [components, setComponents] = useState<EditableFinalAssemblyComponent[]>([
    { component_source: 'sub_assembly', component_part_number: '', quantity: '1', quantity_formula: '' },
  ])

  const reset = () => {
    setForm({
      part_number: '',
      product_category: '',
      sub_product_category: '',
      description: '',
      notes: '',
      parts_per_package: '',
      parts_per_hour: '',
      labor_rate_per_hour: '29.25',
      num_employees: '1',
      shipping_labor_cost: '0',
    })
    setComponents([{ component_source: 'sub_assembly', component_part_number: '', quantity: '1', quantity_formula: '' }])
    setError(null)
    setSaving(false)
  }

  const submit = async () => {
    setSaving(true)
    setError(null)

    const payload = {
      ...form,
      components: components.map(component => ({
        component_source: component.component_source,
        component_part_number: component.component_part_number,
        quantity: component.quantity,
        quantity_formula: component.quantity_formula || null,
      })),
      _performed_by_name: profile?.full_name || 'Unknown',
      _performed_by_email: profile?.email || '',
    }

    try {
      const response = await fetch('/api/bom/final-assemblies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create final assembly.')
      }

      await onCreated()
      setOpen(false)
      reset()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to create final assembly.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={nextOpen => {
        setOpen(nextOpen)
        if (!nextOpen) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-1" /> New Final Assembly</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[90vw] xl:max-w-[1400px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Final Assembly</DialogTitle>
        </DialogHeader>
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label>Part Number</Label>
              <Input value={form.part_number} onChange={e => setForm({ ...form, part_number: e.target.value })} placeholder="Required" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Product Category</Label>
                <SelectOrCreate
                  value={form.product_category}
                  onChange={v => setForm({ ...form, product_category: v })}
                  options={existingProductCategories}
                  placeholder="Select category..."
                />
              </div>
              <div className="grid gap-2">
                <Label>Sub-Product Category</Label>
                <SelectOrCreate
                  value={form.sub_product_category}
                  onChange={v => setForm({ ...form, sub_product_category: v })}
                  options={existingSubProductCategories}
                  placeholder="Select sub-category..."
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Description</Label>
              <Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>Notes</Label>
              <Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Parts per Package</Label>
                <Input type="number" min="0" step="1" value={form.parts_per_package} onChange={e => setForm({ ...form, parts_per_package: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Parts per Hour</Label>
                <Input type="number" min="0" step="0.01" value={form.parts_per_hour} onChange={e => setForm({ ...form, parts_per_hour: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Labor Rate / Hr</Label>
                <Input type="number" min="0" step="0.01" value={form.labor_rate_per_hour} onChange={e => setForm({ ...form, labor_rate_per_hour: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label># Employees</Label>
                <Input type="number" min="0" step="0.1" value={form.num_employees} onChange={e => setForm({ ...form, num_employees: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Shipping Labor Cost</Label>
              <Input type="number" min="0" step="0.0001" value={form.shipping_labor_cost} onChange={e => setForm({ ...form, shipping_labor_cost: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold">Components</h3>
                <p className="text-xs text-muted-foreground">Final assemblies can mix sub-assemblies and individual items.</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setComponents([...components, { component_source: 'sub_assembly', component_part_number: '', quantity: '1', quantity_formula: '' }])}
              >
                <Plus className="h-4 w-4 mr-1" /> Add Component
              </Button>
            </div>
            <div className="space-y-3 max-h-[28rem] overflow-y-auto pr-1">
              {components.map((component, index) => {
                const partOptions = component.component_source === 'sub_assembly' ? subAssemblies : individualItems

                return (
                  <div key={`final-component-${index}`} className="grid gap-4 rounded-md border p-4 md:grid-cols-[170px_minmax(0,1fr)_140px_48px] items-end">
                    <div className="grid gap-2">
                      <Label>Source</Label>
                      <Select
                        value={component.component_source}
                        onValueChange={value => {
                          const next = [...components]
                          next[index] = {
                            component_source: value as EditableFinalAssemblyComponent['component_source'],
                            component_part_number: '',
                            quantity: component.quantity,
                            quantity_formula: '',
                          }
                          setComponents(next)
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FINAL_COMPONENT_SOURCES.map(source => (
                            <SelectItem key={source.value} value={source.value}>
                              {source.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label>Part</Label>
                      <Select
                        value={component.component_part_number || undefined}
                        onValueChange={value => {
                          const next = [...components]
                          next[index] = { ...component, component_part_number: value }
                          setComponents(next)
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select part number" />
                        </SelectTrigger>
                        <SelectContent>
                          {partOptions.map(option => (
                            <SelectItem key={option.id} value={option.part_number}>
                              {option.part_number}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label>Quantity</Label>
                      <Input
                        type="number"
                        min="0.000001"
                        step="0.0001"
                        value={component.quantity}
                        onChange={e => {
                          const next = [...components]
                          next[index] = { ...component, quantity: e.target.value }
                          setComponents(next)
                        }}
                      />
                    </div>
                    <div className="flex items-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-10 px-2 text-destructive"
                        onClick={() => setComponents(components.length === 1 ? [{ component_source: 'sub_assembly', component_part_number: '', quantity: '1', quantity_formula: '' }] : components.filter((_, componentIndex) => componentIndex !== index))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter className="gap-3 pt-4">
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={() => { void submit() }} disabled={saving}>
            {saving ? 'Saving...' : 'Save Final Assembly'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Edit Individual Item Dialog ─────────────────────────────────

function EditIndividualItemDialog({ item, onSaved }: {
  item: IndividualItem
  onSaved: () => void
}) {
  const { profile } = useAuth()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    part_number: item.part_number,
    description: item.description || '',
    cost_per_unit: String(item.cost_per_unit),
    unit: item.unit,
    supplier: item.supplier || '',
  })

  const submit = async () => {
    setSaving(true)
    try {
      await fetch(`/api/bom/individual-items/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, cost_per_unit: Number(form.cost_per_unit), _performed_by_name: profile?.full_name || 'Unknown', _performed_by_email: profile?.email || '' }),
      })
      onSaved()
      setOpen(false)
    } catch { /* ignore */ }
    setSaving(false)
  }

  return (
    <Dialog open={open} onOpenChange={v => {
      setOpen(v)
      if (v) setForm({ part_number: item.part_number, description: item.description || '', cost_per_unit: String(item.cost_per_unit), unit: item.unit, supplier: item.supplier || '' })
    }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2" title="Edit"><Pencil className="h-3 w-3" /></Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit Individual Item</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-2"><Label>Part Number</Label><Input value={form.part_number} onChange={e => setForm({ ...form, part_number: e.target.value })} /></div>
          <div className="grid gap-2"><Label>Description</Label><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
          <div className="grid gap-2"><Label>Cost per Unit</Label><Input type="number" step="0.0001" value={form.cost_per_unit} onChange={e => setForm({ ...form, cost_per_unit: e.target.value })} /></div>
          <div className="grid gap-2">
            <Label>Unit</Label>
            <Select value={form.unit} onValueChange={v => setForm({ ...form, unit: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="lb">lb</SelectItem><SelectItem value="ea">ea</SelectItem>
                <SelectItem value="ft">ft</SelectItem><SelectItem value="roll">roll</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2"><Label>Supplier</Label><Input value={form.supplier} onChange={e => setForm({ ...form, supplier: e.target.value })} /></div>
        </div>
        <DialogFooter className="gap-3 pt-4">
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button onClick={() => { void submit() }} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Edit Sub-Assembly Dialog ────────────────────────────────────

function EditSubAssemblyDialog({ assembly, individualItems, existingCategories, onSaved }: {
  assembly: SubAssembly
  individualItems: IndividualItem[]
  existingCategories: string[]
  onSaved: () => void
}) {
  const { profile } = useAuth()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    part_number: assembly.part_number,
    category: assembly.category || '',
    mold_name: assembly.mold_name || '',
    part_weight: assembly.part_weight != null ? String(assembly.part_weight) : '',
    parts_per_hour: assembly.parts_per_hour != null ? String(assembly.parts_per_hour) : '',
    labor_rate_per_hour: String(assembly.labor_rate_per_hour),
    num_employees: String(assembly.num_employees),
  })
  const [components, setComponents] = useState<EditableSubAssemblyComponent[]>(
    assembly.bom_sub_assembly_components.map(c => ({ component_part_number: c.component_part_number, quantity: String(c.quantity) }))
  )

  const reset = () => {
    setForm({
      part_number: assembly.part_number, category: assembly.category || '', mold_name: assembly.mold_name || '',
      part_weight: assembly.part_weight != null ? String(assembly.part_weight) : '',
      parts_per_hour: assembly.parts_per_hour != null ? String(assembly.parts_per_hour) : '',
      labor_rate_per_hour: String(assembly.labor_rate_per_hour), num_employees: String(assembly.num_employees),
    })
    setComponents(assembly.bom_sub_assembly_components.map(c => ({ component_part_number: c.component_part_number, quantity: String(c.quantity) })))
    setError(null)
  }

  const submit = async () => {
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/bom/sub-assemblies/${assembly.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, components: components.map(c => ({ component_part_number: c.component_part_number, quantity: c.quantity })), _performed_by_name: profile?.full_name || 'Unknown', _performed_by_email: profile?.email || '' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to update.')
      onSaved(); setOpen(false)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to update.') }
    setSaving(false)
  }

  return (
    <Dialog open={open} onOpenChange={v => { setOpen(v); if (v) reset() }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2" title="Edit"><Pencil className="h-3 w-3" /></Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[90vw] xl:max-w-[1200px] max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit Sub-Assembly: {assembly.part_number}</DialogTitle></DialogHeader>
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="grid gap-3">
            <div className="grid gap-2"><Label>Part Number</Label><Input value={form.part_number} onChange={e => setForm({ ...form, part_number: e.target.value })} /></div>
            <div className="grid gap-2">
              <Label>Category</Label>
              <SelectOrCreate value={form.category} onChange={v => setForm({ ...form, category: v })} options={existingCategories} placeholder="Select category..." />
            </div>
            <div className="grid gap-2"><Label>Mold Name</Label><Input value={form.mold_name} onChange={e => setForm({ ...form, mold_name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2"><Label>Part Weight</Label><Input type="number" min="0" step="0.0001" value={form.part_weight} onChange={e => setForm({ ...form, part_weight: e.target.value })} /></div>
              <div className="grid gap-2"><Label>Parts / Hr</Label><Input type="number" min="0" step="0.01" value={form.parts_per_hour} onChange={e => setForm({ ...form, parts_per_hour: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2"><Label>Labor Rate / Hr</Label><Input type="number" min="0" step="0.01" value={form.labor_rate_per_hour} onChange={e => setForm({ ...form, labor_rate_per_hour: e.target.value })} /></div>
              <div className="grid gap-2"><Label># Employees</Label><Input type="number" min="0" step="0.1" value={form.num_employees} onChange={e => setForm({ ...form, num_employees: e.target.value })} /></div>
            </div>
          </div>
          <div className="grid gap-3">
            <div className="flex items-center justify-between">
              <div><h3 className="font-semibold">Components</h3><p className="text-xs text-muted-foreground">Individual items only.</p></div>
              <Button type="button" variant="outline" size="sm" onClick={() => setComponents([...components, { component_part_number: '', quantity: '1' }])}><Plus className="h-4 w-4 mr-1" /> Add</Button>
            </div>
            <div className="space-y-3 max-h-[26rem] overflow-y-auto pr-1">
              {components.map((comp, i) => (
                <div key={`edit-sub-comp-${i}`} className="grid gap-4 rounded-md border p-4 md:grid-cols-[minmax(0,1fr)_160px_48px] items-end">
                  <div className="grid gap-2">
                    <Label>Individual Item</Label>
                    <Select value={comp.component_part_number || undefined} onValueChange={v => { const n = [...components]; n[i] = { ...comp, component_part_number: v }; setComponents(n) }}>
                      <SelectTrigger><SelectValue placeholder="Select part number" /></SelectTrigger>
                      <SelectContent>{individualItems.map(item => <SelectItem key={item.id} value={item.part_number}>{item.part_number}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2"><Label>Qty</Label><Input type="number" min="0.000001" step="0.0001" value={comp.quantity} onChange={e => { const n = [...components]; n[i] = { ...comp, quantity: e.target.value }; setComponents(n) }} /></div>
                  <div className="flex items-end"><Button type="button" variant="ghost" size="sm" className="h-10 px-2 text-destructive" onClick={() => setComponents(components.length === 1 ? [{ component_part_number: '', quantity: '1' }] : components.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button></div>
                </div>
              ))}
            </div>
          </div>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter className="gap-3 pt-4">
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button onClick={() => { void submit() }} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Edit Final Assembly Dialog ──────────────────────────────────

function EditFinalAssemblyDialog({ assembly, subAssemblies, individualItems, existingProductCategories, existingSubProductCategories, onSaved }: {
  assembly: FinalAssembly
  subAssemblies: SubAssembly[]
  individualItems: IndividualItem[]
  existingProductCategories: string[]
  existingSubProductCategories: string[]
  onSaved: () => void
}) {
  const { profile } = useAuth()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    part_number: assembly.part_number,
    product_category: assembly.product_category || '',
    sub_product_category: assembly.sub_product_category || '',
    description: assembly.description || '',
    notes: assembly.notes || '',
    parts_per_package: assembly.parts_per_package != null ? String(assembly.parts_per_package) : '',
    parts_per_hour: assembly.parts_per_hour != null ? String(assembly.parts_per_hour) : '',
    labor_rate_per_hour: String(assembly.labor_rate_per_hour),
    num_employees: String(assembly.num_employees),
    shipping_labor_cost: String(assembly.shipping_labor_cost),
  })
  const [components, setComponents] = useState<EditableFinalAssemblyComponent[]>(
    assembly.bom_final_assembly_components.map(c => ({
      component_source: c.component_source as 'sub_assembly' | 'individual_item',
      component_part_number: c.component_part_number,
      quantity: String(c.quantity),
      quantity_formula: c.quantity_formula || '',
    }))
  )

  const reset = () => {
    setForm({
      part_number: assembly.part_number, product_category: assembly.product_category || '', sub_product_category: assembly.sub_product_category || '',
      description: assembly.description || '', notes: assembly.notes || '',
      parts_per_package: assembly.parts_per_package != null ? String(assembly.parts_per_package) : '',
      parts_per_hour: assembly.parts_per_hour != null ? String(assembly.parts_per_hour) : '',
      labor_rate_per_hour: String(assembly.labor_rate_per_hour), num_employees: String(assembly.num_employees),
      shipping_labor_cost: String(assembly.shipping_labor_cost),
    })
    setComponents(assembly.bom_final_assembly_components.map(c => ({
      component_source: c.component_source as 'sub_assembly' | 'individual_item',
      component_part_number: c.component_part_number, quantity: String(c.quantity),
      quantity_formula: c.quantity_formula || '',
    })))
    setError(null)
  }

  const submit = async () => {
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/bom/final-assemblies/${assembly.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, components: components.map(c => ({ component_source: c.component_source, component_part_number: c.component_part_number, quantity: c.quantity, quantity_formula: c.quantity_formula || null })), _performed_by_name: profile?.full_name || 'Unknown', _performed_by_email: profile?.email || '' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to update.')
      onSaved(); setOpen(false)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to update.') }
    setSaving(false)
  }

  return (
    <Dialog open={open} onOpenChange={v => { setOpen(v); if (v) reset() }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2" title="Edit"><Pencil className="h-3 w-3" /></Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[90vw] xl:max-w-[1400px] max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit Final Assembly: {assembly.part_number}</DialogTitle></DialogHeader>
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="grid gap-3">
            <div className="grid gap-2"><Label>Part Number</Label><Input value={form.part_number} onChange={e => setForm({ ...form, part_number: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2"><Label>Product Category</Label><SelectOrCreate value={form.product_category} onChange={v => setForm({ ...form, product_category: v })} options={existingProductCategories} placeholder="Select..." /></div>
              <div className="grid gap-2"><Label>Sub-Category</Label><SelectOrCreate value={form.sub_product_category} onChange={v => setForm({ ...form, sub_product_category: v })} options={existingSubProductCategories} placeholder="Select..." /></div>
            </div>
            <div className="grid gap-2"><Label>Description</Label><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
            <div className="grid gap-2"><Label>Notes</Label><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2"><Label>Parts / Package</Label><Input type="number" min="0" step="1" value={form.parts_per_package} onChange={e => setForm({ ...form, parts_per_package: e.target.value })} /></div>
              <div className="grid gap-2"><Label>Parts / Hr</Label><Input type="number" min="0" step="0.01" value={form.parts_per_hour} onChange={e => setForm({ ...form, parts_per_hour: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2"><Label>Labor Rate / Hr</Label><Input type="number" min="0" step="0.01" value={form.labor_rate_per_hour} onChange={e => setForm({ ...form, labor_rate_per_hour: e.target.value })} /></div>
              <div className="grid gap-2"><Label># Employees</Label><Input type="number" min="0" step="0.1" value={form.num_employees} onChange={e => setForm({ ...form, num_employees: e.target.value })} /></div>
            </div>
            <div className="grid gap-2"><Label>Shipping Labor Cost</Label><Input type="number" min="0" step="0.0001" value={form.shipping_labor_cost} onChange={e => setForm({ ...form, shipping_labor_cost: e.target.value })} /></div>
          </div>
          <div className="grid gap-3">
            <div className="flex items-center justify-between">
              <div><h3 className="font-semibold">Components</h3><p className="text-xs text-muted-foreground">Mix sub-assemblies and individual items.</p></div>
              <Button type="button" variant="outline" size="sm" onClick={() => setComponents([...components, { component_source: 'sub_assembly', component_part_number: '', quantity: '1', quantity_formula: '' }])}><Plus className="h-4 w-4 mr-1" /> Add</Button>
            </div>
            <div className="space-y-3 max-h-[28rem] overflow-y-auto pr-1">
              {components.map((comp, i) => {
                const partOpts = comp.component_source === 'sub_assembly' ? subAssemblies : individualItems
                return (
                  <div key={`edit-final-comp-${i}`} className="grid gap-4 rounded-md border p-4 md:grid-cols-[170px_minmax(0,1fr)_140px_48px] items-end">
                    <div className="grid gap-2">
                      <Label>Source</Label>
                      <Select value={comp.component_source} onValueChange={v => { const n = [...components]; n[i] = { component_source: v as 'sub_assembly' | 'individual_item', component_part_number: '', quantity: comp.quantity, quantity_formula: '' }; setComponents(n) }}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{FINAL_COMPONENT_SOURCES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label>Part</Label>
                      <Select value={comp.component_part_number || undefined} onValueChange={v => { const n = [...components]; n[i] = { ...comp, component_part_number: v }; setComponents(n) }}>
                        <SelectTrigger><SelectValue placeholder="Select part number" /></SelectTrigger>
                        <SelectContent>{partOpts.map(o => <SelectItem key={o.id} value={o.part_number}>{o.part_number}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2"><Label>Qty</Label><Input type="number" min="0.000001" step="0.0001" value={comp.quantity} onChange={e => { const n = [...components]; n[i] = { ...comp, quantity: e.target.value }; setComponents(n) }} /></div>
                    <div className="flex items-end"><Button type="button" variant="ghost" size="sm" className="h-10 px-2 text-destructive" onClick={() => setComponents(components.length === 1 ? [{ component_source: 'sub_assembly', component_part_number: '', quantity: '1', quantity_formula: '' }] : components.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button></div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter className="gap-3 pt-4">
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button onClick={() => { void submit() }} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Cost History Hook ───────────────────────────────────────────

interface CostHistoryEntry {
  id: string
  changed_at: string
  changed_field: string
  old_value: number
  new_value: number
  pct_change: number
  cause_item_id?: string
  cause_item_part_number?: string
}

interface CostHistoryResponse {
  itemId: string
  itemType: string
  partNumber: string
  history: CostHistoryEntry[]
  stats: {
    first_cost: number
    last_cost: number
    total_changes: number
    overall_pct_change: number
  }
}

function CostHistoryPanel({ data, loading, error, onViewComponents }: {
  data: CostHistoryResponse | null
  loading: boolean
  error: string | null
  onViewComponents?: () => void
}) {
  if (loading) {
    return (
      <div className="py-6 text-center text-muted-foreground text-sm">
        <RefreshCw className="h-4 w-4 animate-spin inline mr-2" />
        Loading cost history...
      </div>
    )
  }

  if (error) {
    return (
      <div className="py-4 text-center text-destructive text-sm">
        <AlertTriangle className="h-4 w-4 inline mr-1" />
        {error}
      </div>
    )
  }

  if (!data || data.history.length === 0) {
    return (
      <div className="py-4 text-center text-muted-foreground text-sm">
        No cost history recorded for this item.
      </div>
    )
  }

  const { history, stats } = data

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-sm flex items-center gap-1.5">
          <History className="h-4 w-4" />
          Cost History ({stats.total_changes} change{stats.total_changes !== 1 ? 's' : ''})
        </h4>
        {stats.total_changes > 0 && (
          <div className="text-xs text-muted-foreground">
            Overall: {fmt(stats.first_cost)} → {fmt(stats.last_cost)}{' '}
            <span className={stats.overall_pct_change > 0 ? 'text-red-400' : stats.overall_pct_change < 0 ? 'text-green-400' : ''}>
              ({stats.overall_pct_change > 0 ? '+' : ''}{stats.overall_pct_change.toFixed(2)}%)
            </span>
          </div>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Field</TableHead>
            <TableHead className="text-right">Old Value</TableHead>
            <TableHead className="text-right">New Value</TableHead>
            <TableHead className="text-right">% Change</TableHead>
            <TableHead>Cause</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {history.map(entry => {
            const date = new Date(entry.changed_at)
            const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            return (
              <TableRow key={entry.id}>
                <TableCell className="text-xs">{dateStr}</TableCell>
                <TableCell className="text-xs capitalize">{entry.changed_field.replace(/_/g, ' ')}</TableCell>
                <TableCell className="text-right text-xs">{entry.old_value ? fmt(entry.old_value) : '—'}</TableCell>
                <TableCell className="text-right text-xs">{fmt(entry.new_value)}</TableCell>
                <TableCell className="text-right text-xs">
                  {entry.old_value ? (
                    <span className={entry.pct_change > 0 ? 'text-red-400' : entry.pct_change < 0 ? 'text-green-400' : ''}>
                      {entry.pct_change > 0 ? '+' : ''}{entry.pct_change.toFixed(2)}%
                    </span>
                  ) : '—'}
                </TableCell>
                <TableCell className="text-xs font-mono">
                  {entry.cause_item_part_number || '—'}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      {onViewComponents && (
        <div className="pt-1">
          <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onViewComponents}>
            View Component Changes →
          </Button>
        </div>
      )}
    </div>
  )
}

function useCostHistory(typePrefix: 'sub' | 'final' | 'individual') {
  const [costHistoryId, setCostHistoryId] = useState<string | null>(null)
  const [costHistoryData, setCostHistoryData] = useState<CostHistoryResponse | null>(null)
  const [costHistoryLoading, setCostHistoryLoading] = useState(false)
  const [costHistoryError, setCostHistoryError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const fetchCostHistory = useCallback(async (id: string) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setCostHistoryLoading(true)
    setCostHistoryError(null)
    setCostHistoryData(null)
    try {
      const res = await fetch(`/api/bom/${typePrefix}/${id}/cost-history`, { signal: controller.signal })
      if (controller.signal.aborted) return
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Failed to fetch cost history (${res.status})`)
      }
      const data: CostHistoryResponse = await res.json()
      if (!controller.signal.aborted) setCostHistoryData(data)
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      setCostHistoryError(e instanceof Error ? e.message : 'Failed to fetch cost history')
    } finally {
      if (!controller.signal.aborted) setCostHistoryLoading(false)
    }
  }, [typePrefix])

  const toggleCostHistory = useCallback((id: string, setExpandedId: (id: string | null) => void) => {
    if (costHistoryId === id) {
      abortRef.current?.abort()
      setCostHistoryId(null)
      setCostHistoryData(null)
      setCostHistoryError(null)
    } else {
      setCostHistoryId(id)
      setExpandedId(null)
      fetchCostHistory(id)
    }
  }, [costHistoryId, fetchCostHistory])

  const dismiss = useCallback(() => {
    abortRef.current?.abort()
    setCostHistoryId(null)
    setCostHistoryData(null)
    setCostHistoryError(null)
  }, [])

  return { costHistoryId, costHistoryData, costHistoryLoading, costHistoryError, toggleCostHistory, dismiss }
}

// ─── Tab 2: Sub Assemblies ───────────────────────────────────────

function SubAssembliesTab({ assemblies, individualItems, search, onRefresh }: {
  assemblies: SubAssembly[]
  individualItems: IndividualItem[]
  search: string
  onRefresh: (bust?: boolean) => void
}) {
  const { t } = useI18n()
  const { profile } = useAuth()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const { costHistoryId, costHistoryData, costHistoryLoading, costHistoryError, toggleCostHistory, dismiss: dismissCostHistory } = useCostHistory('sub')

  const filtered = assemblies.filter(a =>
    a.part_number.toLowerCase().includes(search.toLowerCase()) ||
    (a.category || '').toLowerCase().includes(search.toLowerCase())
  )

  const performedBy = {
    _performed_by_name: profile?.full_name || 'Unknown',
    _performed_by_email: profile?.email || '',
  }

  const duplicate = async (id: string, partNumber: string) => {
    const newPart = prompt('New part number for the clone:', `${partNumber}-COPY`)
    if (!newPart) return
    try {
      const res = await fetch('/api/bom/sub-assemblies/duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, new_part_number: newPart, ...performedBy }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        alert(`Clone failed: ${body.error || res.statusText}`)
        return
      }
      onRefresh(true)
    } catch (e) {
      alert(`Clone failed: ${e instanceof Error ? e.message : 'Network error'}`)
    }
  }

  const recalculate = async (id: string) => {
    await fetch(`/api/bom/sub-assemblies/${id}/recalculate`, { method: 'POST' })
    onRefresh(true)
  }

  const deleteAssembly = async (id: string) => {
    if (!confirm('Delete this sub-assembly?')) return
    await fetch(`/api/bom/sub-assemblies/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(performedBy),
    })
    onRefresh(true)
  }

  const existingCategories = [...new Set(assemblies.map(a => a.category).filter((c): c is string => !!c))].sort()

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg">Sub Assemblies (Molded Parts)</CardTitle>
        <NewSubAssemblyDialog individualItems={individualItems} existingCategories={existingCategories} onCreated={() => onRefresh(true)} />
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>Part Number</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Weight</TableHead>
              <TableHead className="text-right">Material</TableHead>
              <TableHead className="text-right">Labor</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="w-28"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(a => (
              <Fragment key={a.id}>
                <TableRow key={a.id} className="cursor-pointer hover:bg-muted/50" onClick={() => { setExpandedId(expandedId === a.id ? null : a.id); if (costHistoryId) dismissCostHistory() }}>
                  <TableCell>
                    {expandedId === a.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </TableCell>
                  <TableCell className="font-mono text-sm">{a.part_number}</TableCell>
                  <TableCell>
                    <span className="px-2 py-0.5 rounded-full text-xs bg-blue-500/20 text-blue-400">
                      {a.category || 'N/A'}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">{a.part_weight ? `${a.part_weight} lb` : '—'}</TableCell>
                  <TableCell className="text-right">{fmt(a.material_cost)}</TableCell>
                  <TableCell className="text-right">{fmt(a.labor_cost_per_part)}</TableCell>
                  <TableCell className="text-right font-semibold">{fmt(a.total_cost)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" className={`h-7 px-2 ${costHistoryId === a.id ? 'bg-muted' : ''}`} onClick={() => toggleCostHistory(a.id, setExpandedId)} title="Cost History">
                        <History className="h-3 w-3" />
                      </Button>
                      <EditSubAssemblyDialog assembly={a} individualItems={individualItems} existingCategories={existingCategories} onSaved={() => onRefresh(true)} />
                      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => recalculate(a.id)} title="Recalculate">
                        <RefreshCw className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => duplicate(a.id, a.part_number)} title="Clone">
                        <Copy className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive" onClick={() => deleteAssembly(a.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                {costHistoryId === a.id && (
                  <TableRow key={`${a.id}-history`}>
                    <TableCell colSpan={8} className="bg-muted/30 p-4">
                      <CostHistoryPanel
                        data={costHistoryData}
                        loading={costHistoryLoading}
                        error={costHistoryError}
                        onViewComponents={() => {
                          dismissCostHistory()
                          setExpandedId(a.id)
                        }}
                      />
                    </TableCell>
                  </TableRow>
                )}
                {expandedId === a.id && (
                  <TableRow key={`${a.id}-detail`}>
                    <TableCell colSpan={8} className="bg-muted/30 p-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <h4 className="font-semibold mb-2 text-sm">Components</h4>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Part</TableHead>
                                <TableHead className="text-right">Qty</TableHead>
                                <TableHead className="text-right">Cost</TableHead>
                                <TableHead>Scrap?</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {(a.bom_sub_assembly_components || []).sort((x, y) => x.sort_order - y.sort_order).map(c => (
                                <TableRow key={c.id}>
                                  <TableCell className="font-mono text-xs">{c.component_part_number}</TableCell>
                                  <TableCell className="text-right">{Number(c.quantity).toFixed(4)}</TableCell>
                                  <TableCell className="text-right">{fmt(c.cost)}</TableCell>
                                  <TableCell>{c.is_scrap ? `Yes (${pct(c.scrap_rate || 0)})` : ''}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                        <div>
                          <h4 className="font-semibold mb-2 text-sm">Details</h4>
                          <div className="space-y-1 text-sm">
                            <div className="flex justify-between"><span className="text-muted-foreground">Mold:</span><span>{a.mold_name || '—'}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">Parts/Hour:</span><span>{a.parts_per_hour}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">Labor Rate:</span><span>{fmt(a.labor_rate_per_hour)}/hr</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">Employees:</span><span>{a.num_employees}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">Overhead:</span><span>{fmt(a.overhead_cost)}</span></div>
                          </div>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

// ─── Tab 3: Final Assemblies ─────────────────────────────────────

function FinalAssembliesTab({ assemblies, subAssemblies, individualItems, config, search, onRefresh }: {
  assemblies: FinalAssembly[]
  subAssemblies: SubAssembly[]
  individualItems: IndividualItem[]
  config: BomConfig[]
  search: string
  onRefresh: (bust?: boolean) => void
}) {
  const { t } = useI18n()
  const { profile } = useAuth()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showConfig, setShowConfig] = useState(false)
  const [configEdits, setConfigEdits] = useState<Record<string, string>>({})
  const { costHistoryId, costHistoryData, costHistoryLoading, costHistoryError, toggleCostHistory, dismiss: dismissCostHistory } = useCostHistory('final')

  const filtered = assemblies.filter(a =>
    a.part_number.toLowerCase().includes(search.toLowerCase()) ||
    (a.product_category || '').toLowerCase().includes(search.toLowerCase()) ||
    (a.description || '').toLowerCase().includes(search.toLowerCase())
  )

  const duplicate = async (id: string, partNumber: string) => {
    const newPart = prompt('New part number for the clone:', `${partNumber}-COPY`)
    if (!newPart) return
    try {
      const res = await fetch('/api/bom/final-assemblies/duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, new_part_number: newPart }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        alert(`Clone failed: ${body.error || res.statusText}`)
        return
      }
      onRefresh(true)
    } catch (e) {
      alert(`Clone failed: ${e instanceof Error ? e.message : 'Network error'}`)
    }
  }

  const recalculate = async (id: string) => {
    await fetch(`/api/bom/final-assemblies/${id}/recalculate`, { method: 'POST' })
    onRefresh(true)
  }

  const deleteAssembly = async (id: string) => {
    if (!confirm('Delete this final assembly?')) return
    await fetch(`/api/bom/final-assemblies/${id}`, { method: 'DELETE' })
    onRefresh(true)
  }

  const saveConfig = async (applyToAll: boolean) => {
    const configs = Object.entries(configEdits).map(([key, value]) => ({ key, value: Number(value) }))
    if (configs.length === 0) return
    await fetch('/api/bom/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ configs, apply_to_all: applyToAll }),
    })
    setShowConfig(false)
    setConfigEdits({})
    onRefresh(true)
  }

  const updateOverhead = async (id: string, field: string, value: number) => {
    await fetch(`/api/bom/final-assemblies/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    })
    onRefresh(true)
  }

  const existingProductCategories = [...new Set(assemblies.map(a => a.product_category).filter((c): c is string => !!c))].sort()
  const existingSubProductCategories = [...new Set(assemblies.map(a => a.sub_product_category).filter((c): c is string => !!c))].sort()

  return (
    <div className="space-y-4">
      {/* Config Panel */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="text-lg">Final Assemblies (Finished Products)</CardTitle>
          </div>
          <div className="flex gap-2">
            <NewFinalAssemblyDialog subAssemblies={subAssemblies} individualItems={individualItems} existingProductCategories={existingProductCategories} existingSubProductCategories={existingSubProductCategories} onCreated={() => onRefresh(true)} />
            <Dialog open={showConfig} onOpenChange={v => { setShowConfig(v); if (v) { const m: Record<string, string> = {}; config.forEach(c => { m[c.key] = String(c.value) }); setConfigEdits(m) } }}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm"><Settings className="h-4 w-4 mr-1" /> Overhead Settings</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Global Overhead Configuration</DialogTitle></DialogHeader>
                <div className="grid gap-3">
                  {config.map(c => (
                    <div key={c.key} className="flex items-center gap-3">
                      <label className="text-sm w-48">{c.label}</label>
                      <Input
                        type="number"
                        step="0.0001"
                        value={configEdits[c.key] || ''}
                        onChange={e => setConfigEdits({ ...configEdits, [c.key]: e.target.value })}
                        className="w-32"
                      />
                      <span className="text-xs text-muted-foreground">{c.description}</span>
                    </div>
                  ))}
                </div>
                <DialogFooter className="flex gap-2">
                  <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
                  <Button variant="secondary" onClick={() => saveConfig(false)}>Save Config Only</Button>
                  <Button onClick={() => {
                    if (confirm(`Apply to ALL ${assemblies.length} products? This will recalculate all costs.`))
                      saveConfig(true)
                  }}>
                    <AlertTriangle className="h-4 w-4 mr-1" /> Apply to All ({assemblies.length})
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Part Number</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Pkg</TableHead>
                <TableHead className="text-right">Subtotal</TableHead>
                <TableHead className="text-right">Variable</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Sales Target</TableHead>
                <TableHead className="w-28"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(a => (
                <Fragment key={a.id}>
                  <TableRow key={a.id} className="cursor-pointer hover:bg-muted/50" onClick={() => { setExpandedId(expandedId === a.id ? null : a.id); if (costHistoryId) dismissCostHistory() }}>
                    <TableCell>
                      {expandedId === a.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{a.part_number}</TableCell>
                    <TableCell>
                      <span className="px-2 py-0.5 rounded-full text-xs bg-indigo-500/20 text-indigo-400">
                        {a.product_category || 'N/A'}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">{a.parts_per_package || '—'}</TableCell>
                    <TableCell className="text-right">{fmt(a.subtotal_cost)}</TableCell>
                    <TableCell className="text-right">{fmt(a.variable_cost)}</TableCell>
                    <TableCell className="text-right font-semibold">{fmt(a.total_cost)}</TableCell>
                    <TableCell className="text-right font-semibold text-green-400">{fmt(a.sales_target)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                        <Button variant="ghost" size="sm" className={`h-7 px-2 ${costHistoryId === a.id ? 'bg-muted' : ''}`} onClick={() => toggleCostHistory(a.id, setExpandedId)} title="Cost History">
                          <History className="h-3 w-3" />
                        </Button>
                        <EditFinalAssemblyDialog assembly={a} subAssemblies={subAssemblies} individualItems={individualItems} existingProductCategories={existingProductCategories} existingSubProductCategories={existingSubProductCategories} onSaved={() => onRefresh(true)} />
                        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => recalculate(a.id)} title="Recalculate">
                          <RefreshCw className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => duplicate(a.id, a.part_number)} title="Clone">
                          <Copy className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive" onClick={() => deleteAssembly(a.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  {costHistoryId === a.id && (
                    <TableRow key={`${a.id}-history`}>
                      <TableCell colSpan={9} className="bg-muted/30 p-4">
                        <CostHistoryPanel
                          data={costHistoryData}
                          loading={costHistoryLoading}
                          error={costHistoryError}
                          onViewComponents={() => {
                            dismissCostHistory()
                            setExpandedId(a.id)
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                  {expandedId === a.id && (
                    <TableRow key={`${a.id}-detail`}>
                      <TableCell colSpan={9} className="bg-muted/30 p-4">
                        <div className="grid grid-cols-3 gap-4">
                          {/* Components */}
                          <div className="col-span-2">
                            <h4 className="font-semibold mb-2 text-sm">Components</h4>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Part</TableHead>
                                  <TableHead>Source</TableHead>
                                  <TableHead className="text-right">Qty</TableHead>
                                  <TableHead className="text-right">Cost</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {(a.bom_final_assembly_components || []).sort((x, y) => x.sort_order - y.sort_order).map(c => (
                                  <TableRow key={c.id}>
                                    <TableCell className="font-mono text-xs">{c.component_part_number}</TableCell>
                                    <TableCell>
                                      <span className={`px-1.5 py-0.5 rounded text-xs ${c.component_source === 'sub_assembly' ? 'bg-blue-500/20 text-blue-400' : 'bg-amber-500/20 text-amber-400'}`}>
                                        {c.component_source === 'sub_assembly' ? 'Sub Assy' : 'Individual'}
                                      </span>
                                    </TableCell>
                                    <TableCell className="text-right">{Number(c.quantity).toFixed(6)}</TableCell>
                                    <TableCell className="text-right">{fmt(c.cost)}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                          {/* Cost Breakdown */}
                          <div>
                            <h4 className="font-semibold mb-2 text-sm">Cost Breakdown</h4>
                            <div className="space-y-1.5 text-sm">
                              <div className="flex justify-between"><span className="text-muted-foreground">Description:</span><span className="text-right text-xs">{a.description || '—'}</span></div>
                              <PartsPerHourLine id={a.id} value={a.parts_per_hour} onSave={updateOverhead} />
                              <div className="flex justify-between"><span className="text-muted-foreground">Labor/Part:</span><span>{fmt(a.labor_cost_per_part)}</span></div>
                              <div className="flex justify-between"><span className="text-muted-foreground">Ship Labor:</span><span>{fmt(a.shipping_labor_cost)}</span></div>
                              <hr className="border-border" />
                              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal:</span><span>{fmt(a.subtotal_cost)}</span></div>
                              <OverheadLine label="Overhead" pctValue={a.overhead_pct} cost={a.overhead_cost} id={a.id} field="overhead_pct" onSave={updateOverhead} />
                              <OverheadLine label="Admin" pctValue={a.admin_pct} cost={a.admin_cost} id={a.id} field="admin_pct" onSave={updateOverhead} />
                              <OverheadLine label="Depreciation" pctValue={a.depreciation_pct} cost={a.depreciation_cost} id={a.id} field="depreciation_pct" onSave={updateOverhead} />
                              <OverheadLine label="Repairs" pctValue={a.repairs_pct} cost={a.repairs_cost} id={a.id} field="repairs_pct" onSave={updateOverhead} />
                              <hr className="border-border" />
                              <div className="flex justify-between"><span className="text-muted-foreground">Variable Cost:</span><span>{fmt(a.variable_cost)}</span></div>
                              <div className="flex justify-between font-semibold"><span>Total Cost:</span><span>{fmt(a.total_cost)}</span></div>
                              <OverheadLine label="Profit Target" pctValue={a.profit_target_pct} cost={a.profit_amount} id={a.id} field="profit_target_pct" onSave={updateOverhead} />
                              <div className="flex justify-between font-semibold text-green-400"><span>Sales Target:</span><span>{fmt(a.sales_target)}</span></div>
                            </div>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Inline Editors ──────────────────────────────────────────────

function PartsPerHourLine({ id, value, onSave }: {
  id: string
  value: number | null
  onSave: (id: string, field: string, value: number) => void | Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState('')
  const savingRef = useRef(false)

  const submit = async () => {
    if (savingRef.current) return

    const nextValue = Number(val)
    if (!Number.isFinite(nextValue) || nextValue <= 0) {
      setEditing(false)
      return
    }

    savingRef.current = true
    try {
      await onSave(id, 'parts_per_hour', nextValue)
    } finally {
      savingRef.current = false
      setEditing(false)
    }
  }

  return (
    <div className="flex justify-between items-center">
      <span className="text-muted-foreground">Parts/Hr:</span>
      <span className="flex items-center gap-1">
        {editing ? (
          <Input
            type="number"
            step="1"
            min="1"
            value={val}
            onChange={e => setVal(e.target.value)}
            className="w-20 h-6 text-xs text-right"
            onBlur={() => { void submit() }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void submit()
              }
              if (e.key === 'Escape') {
                setEditing(false)
              }
            }}
            autoFocus
          />
        ) : (
          <span
            className="cursor-pointer hover:text-primary hover:underline text-xs"
            onClick={() => {
              setEditing(true)
              setVal(value == null ? '' : String(value))
            }}
          >
            {value ?? '—'}
          </span>
        )}
      </span>
    </div>
  )
}

function OverheadLine({ label, pctValue, cost, id, field, onSave }: {
  label: string
  pctValue: number
  cost: number
  id: string
  field: string
  onSave: (id: string, field: string, value: number) => void | Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState('')
  const savingRef = useRef(false)

  const submit = async () => {
    if (savingRef.current) return

    const nextValue = Number(val)
    if (!Number.isFinite(nextValue)) {
      setEditing(false)
      return
    }

    savingRef.current = true
    try {
      await onSave(id, field, nextValue / 100)
    } finally {
      savingRef.current = false
      setEditing(false)
    }
  }

  return (
    <div className="flex justify-between items-center">
      <span className="text-muted-foreground">{label}:</span>
      <span className="flex items-center gap-1">
        {editing ? (
          <>
            <Input
              type="number"
              step="0.01"
              value={val}
              onChange={e => setVal(e.target.value)}
              className="w-16 h-6 text-xs text-right"
              onBlur={() => { void submit() }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void submit()
                }
                if (e.key === 'Escape') {
                  setEditing(false)
                }
              }}
              autoFocus
            />
            <span className="text-xs">%</span>
          </>
        ) : (
          <span
            className="cursor-pointer hover:text-primary hover:underline text-xs"
            onClick={() => { setEditing(true); setVal(String((Number(pctValue) * 100).toFixed(2))) }}
          >
            {pct(pctValue)}
          </span>
        )}
        <span className="text-xs ml-1">= {fmt(cost)}</span>
      </span>
    </div>
  )
}

// ─── Cost Change Log Tab ─────────────────────────────────────────

interface CostChangeLogEntry {
  id: string
  bom_item_id: string
  item_type: 'individual' | 'sub' | 'final'
  part_number: string | null
  item_description: string | null
  changed_field: string
  old_value: number | null
  new_value: number | null
  pct_change: number | null
  changed_by: string | null
  changed_at: string
  affected_assemblies: unknown
}

function CostChangeLogTab({ search }: { search: string }) {
  const [entries, setEntries] = useState<CostChangeLogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [total, setTotal] = useState(0)

  const [itemType, setItemType] = useState<'all' | 'individual' | 'sub' | 'final'>('all')
  const [changeType, setChangeType] = useState<'all' | 'cost' | 'lead_time'>('all')
  const [fromDate, setFromDate] = useState<string>('')
  const [toDate, setToDate] = useState<string>('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const fetchEntries = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set('limit', '500')
      if (itemType !== 'all') params.set('item_type', itemType)
      if (changeType !== 'all') params.set('change_type', changeType)
      if (fromDate) params.set('from', new Date(fromDate).toISOString())
      if (toDate) {
        const end = new Date(toDate)
        end.setHours(23, 59, 59, 999)
        params.set('to', end.toISOString())
      }
      if (search.trim()) params.set('q', search.trim())

      const res = await fetch(`/api/bom/cost-history?${params}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Failed to load (${res.status})`)
      }
      const data = await res.json()
      setEntries(data.entries || [])
      setTotal(data.total || 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load cost change log')
    } finally {
      setLoading(false)
    }
  }, [itemType, changeType, fromDate, toDate, search])

  useEffect(() => { void fetchEntries() }, [fetchEntries])

  const isLeadTime = (f: string) => f === 'lead_time'

  const resetFilters = () => {
    setItemType('all')
    setChangeType('all')
    setFromDate('')
    setToDate('')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-4 w-4" />
          Cost Change Log
          <span className="text-xs font-normal text-muted-foreground ml-1">
            ({total} change{total !== 1 ? 's' : ''})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Item Type</Label>
            <Select value={itemType} onValueChange={(v) => setItemType(v as typeof itemType)}>
              <SelectTrigger className="w-[160px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="individual">Individual Items</SelectItem>
                <SelectItem value="sub">Sub-Assemblies</SelectItem>
                <SelectItem value="final">Final Assemblies</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Change Type</Label>
            <Select value={changeType} onValueChange={(v) => setChangeType(v as typeof changeType)}>
              <SelectTrigger className="w-[140px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Changes</SelectItem>
                <SelectItem value="cost">Cost</SelectItem>
                <SelectItem value="lead_time">Lead Time</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">From</Label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-9 w-[150px]" />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">To</Label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-9 w-[150px]" />
          </div>

          <Button variant="outline" size="sm" onClick={resetFilters} className="h-9">Reset</Button>
          <Button variant="outline" size="sm" onClick={() => void fetchEntries()} disabled={loading} className="h-9">
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>

          {search.trim() && (
            <div className="text-xs text-muted-foreground self-end pb-2">
              Searching for: <span className="font-mono">&quot;{search.trim()}&quot;</span>
            </div>
          )}
        </div>

        {error && (
          <div className="text-sm text-destructive flex items-center gap-1 py-2">
            <AlertTriangle className="h-4 w-4" /> {error}
          </div>
        )}

        {loading ? (
          <div className="py-10 text-center text-muted-foreground text-sm">
            <RefreshCw className="h-4 w-4 animate-spin inline mr-2" />
            Loading change log...
          </div>
        ) : entries.length === 0 ? (
          <div className="py-10 text-center text-muted-foreground text-sm">
            No changes match the current filters.
          </div>
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[8px]"></TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Part #</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Field</TableHead>
                  <TableHead className="text-right">Old</TableHead>
                  <TableHead className="text-right">New</TableHead>
                  <TableHead className="text-right">% Change</TableHead>
                  <TableHead>By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => {
                  const date = new Date(e.changed_at)
                  const dateStr = date.toLocaleString('en-US', {
                    year: 'numeric', month: 'short', day: 'numeric',
                    hour: 'numeric', minute: '2-digit',
                  })
                  const leadTime = isLeadTime(e.changed_field)
                  const formatVal = (v: number | null) => {
                    if (v === null || v === undefined) return '—'
                    return leadTime ? `${v}d` : fmt(v)
                  }
                  const isIncrease = e.pct_change !== null && e.pct_change > 0
                  const isDecrease = e.pct_change !== null && e.pct_change < 0
                  const pctClass = isIncrease ? 'text-red-400' : isDecrease ? 'text-green-400' : ''
                  const isExpanded = expandedId === e.id
                  const typeBadge =
                    e.item_type === 'individual' ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' :
                    e.item_type === 'sub' ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' :
                    'bg-indigo-500/10 text-indigo-400 border-indigo-500/30'
                  const typeLabel =
                    e.item_type === 'individual' ? 'Individual' :
                    e.item_type === 'sub' ? 'Sub' : 'Final'

                  return (
                    <Fragment key={e.id}>
                      <TableRow
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setExpandedId(isExpanded ? null : e.id)}
                      >
                        <TableCell className="py-1.5">
                          {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{dateStr}</TableCell>
                        <TableCell className="text-xs font-mono">{e.part_number || '—'}</TableCell>
                        <TableCell className="text-xs max-w-[240px] truncate" title={e.item_description || ''}>
                          {e.item_description || '—'}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-xs ${typeBadge}`}>{typeLabel}</Badge>
                        </TableCell>
                        <TableCell className="text-xs capitalize">{e.changed_field.replace(/_/g, ' ')}</TableCell>
                        <TableCell className="text-right text-xs">{formatVal(e.old_value)}</TableCell>
                        <TableCell className="text-right text-xs">{formatVal(e.new_value)}</TableCell>
                        <TableCell className={`text-right text-xs ${pctClass}`}>
                          {e.pct_change === null ? '—' : `${isIncrease ? '+' : ''}${e.pct_change.toFixed(2)}%`}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[120px] truncate" title={e.changed_by || ''}>
                          {e.changed_by || '—'}
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={10} className="py-3">
                            <CostChangeLogExpanded entry={e} />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function CostChangeLogExpanded({ entry }: { entry: CostChangeLogEntry }) {
  const affected = Array.isArray(entry.affected_assemblies) ? entry.affected_assemblies : []
  return (
    <div className="space-y-2 px-4">
      <div className="text-xs text-muted-foreground">
        <span className="font-medium">Item ID:</span> <span className="font-mono">{entry.bom_item_id}</span>
      </div>
      {affected.length > 0 ? (
        <div>
          <div className="text-xs font-semibold mb-1">Affected Assemblies ({affected.length})</div>
          <ul className="text-xs space-y-0.5 list-disc pl-5">
            {affected.map((a, i) => {
              const obj = a as Record<string, unknown>
              const pn = obj.part_number ?? obj.cause_part_number ?? '(unknown)'
              const tp = obj.item_type ?? obj.type ?? ''
              return <li key={i}><span className="font-mono">{String(pn)}</span>{tp ? <span className="text-muted-foreground"> — {String(tp)}</span> : null}</li>
            })}
          </ul>
        </div>
      ) : entry.item_type === 'individual' ? (
        <div className="text-xs text-muted-foreground italic">
          No propagated assemblies recorded for this change. Parent assemblies will still reflect recalculated costs.
        </div>
      ) : (
        <div className="text-xs text-muted-foreground italic">
          Change recorded on this {entry.item_type === 'sub' ? 'sub-assembly' : 'final assembly'} directly.
        </div>
      )}
    </div>
  )
}
