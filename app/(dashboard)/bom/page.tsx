'use client'

import { useState, useEffect, useCallback } from 'react'
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
import {
  ChevronRight, ChevronDown, Plus, Trash2, Copy, Save, RefreshCw, Settings, Search, AlertTriangle,
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────

interface IndividualItem {
  id: string
  part_number: string
  description: string | null
  cost_per_unit: number
  unit: string
  supplier: string | null
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
  cost: number
  sort_order: number
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

// ─── Main Page ───────────────────────────────────────────────────

export default function BOMExplorer() {
  const [tab, setTab] = useState('individual')
  const [individualItems, setIndividualItems] = useState<IndividualItem[]>([])
  const [subAssemblies, setSubAssemblies] = useState<SubAssembly[]>([])
  const [finalAssemblies, setFinalAssemblies] = useState<FinalAssembly[]>([])
  const [config, setConfig] = useState<BomConfig[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [items, subs, finals, cfg] = await Promise.all([
        fetch('/api/bom/individual-items').then(r => r.json()),
        fetch('/api/bom/sub-assemblies').then(r => r.json()),
        fetch('/api/bom/final-assemblies').then(r => r.json()),
        fetch('/api/bom/config').then(r => r.json()),
      ])
      setIndividualItems(items)
      setSubAssemblies(subs)
      setFinalAssemblies(finals)
      setConfig(cfg)
    } catch (e) {
      console.error('Failed to fetch BOM data', e)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">BOM Explorer</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search parts..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 w-64"
            />
          </div>
          <Button variant="outline" size="sm" onClick={fetchAll} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="individual">Individual Items ({individualItems.length})</TabsTrigger>
          <TabsTrigger value="sub">Sub Assemblies ({subAssemblies.length})</TabsTrigger>
          <TabsTrigger value="final">Final Assemblies ({finalAssemblies.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="individual">
          <IndividualItemsTab items={individualItems} search={search} onRefresh={fetchAll} />
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
      </Tabs>
    </div>
  )
}

// ─── Tab 1: Individual Items ─────────────────────────────────────

function IndividualItemsTab({ items, search, onRefresh }: {
  items: IndividualItem[]
  search: string
  onRefresh: () => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editCost, setEditCost] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [newItem, setNewItem] = useState({ part_number: '', description: '', cost_per_unit: '', unit: 'lb', supplier: '' })

  const filtered = items.filter(i =>
    i.part_number.toLowerCase().includes(search.toLowerCase()) ||
    (i.description || '').toLowerCase().includes(search.toLowerCase()) ||
    (i.supplier || '').toLowerCase().includes(search.toLowerCase())
  )

  const saveCost = async (id: string) => {
    await fetch(`/api/bom/individual-items/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cost_per_unit: Number(editCost) }),
    })
    setEditingId(null)
    onRefresh()
  }

  const deleteItem = async (id: string) => {
    if (!confirm('Delete this item? This may affect sub-assemblies and final assemblies.')) return
    await fetch(`/api/bom/individual-items/${id}`, { method: 'DELETE' })
    onRefresh()
  }

  const addItem = async () => {
    await fetch('/api/bom/individual-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newItem, cost_per_unit: Number(newItem.cost_per_unit) }),
    })
    setShowAdd(false)
    setNewItem({ part_number: '', description: '', cost_per_unit: '', unit: 'lb', supplier: '' })
    onRefresh()
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-lg">Raw Materials & Purchased Parts</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">Changing a cost here cascades to all sub-assemblies and final assemblies using this material.</p>
        </div>
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add Item</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Individual Item</DialogTitle></DialogHeader>
            <div className="grid gap-3">
              <Input placeholder="Part Number *" value={newItem.part_number} onChange={e => setNewItem({ ...newItem, part_number: e.target.value })} />
              <Input placeholder="Description" value={newItem.description} onChange={e => setNewItem({ ...newItem, description: e.target.value })} />
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
              <Input placeholder="Supplier" value={newItem.supplier} onChange={e => setNewItem({ ...newItem, supplier: e.target.value })} />
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
              <Button onClick={addItem} disabled={!newItem.part_number || !newItem.cost_per_unit}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Part Number</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Cost/Unit</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(item => (
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
                <TableCell>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive" onClick={() => deleteItem(item.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

// ─── Tab 2: Sub Assemblies ───────────────────────────────────────

function SubAssembliesTab({ assemblies, individualItems, search, onRefresh }: {
  assemblies: SubAssembly[]
  individualItems: IndividualItem[]
  search: string
  onRefresh: () => void
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const filtered = assemblies.filter(a =>
    a.part_number.toLowerCase().includes(search.toLowerCase()) ||
    (a.category || '').toLowerCase().includes(search.toLowerCase())
  )

  const duplicate = async (id: string, partNumber: string) => {
    const newPart = prompt('New part number for the clone:', `${partNumber}-COPY`)
    if (!newPart) return
    await fetch('/api/bom/sub-assemblies/duplicate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, new_part_number: newPart }),
    })
    onRefresh()
  }

  const recalculate = async (id: string) => {
    await fetch(`/api/bom/sub-assemblies/${id}/recalculate`, { method: 'POST' })
    onRefresh()
  }

  const deleteAssembly = async (id: string) => {
    if (!confirm('Delete this sub-assembly?')) return
    await fetch(`/api/bom/sub-assemblies/${id}`, { method: 'DELETE' })
    onRefresh()
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg">Sub Assemblies (Molded Parts)</CardTitle>
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
              <>
                <TableRow key={a.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expandedId === a.id ? null : a.id)}>
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
              </>
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
  onRefresh: () => void
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showConfig, setShowConfig] = useState(false)
  const [configEdits, setConfigEdits] = useState<Record<string, string>>({})

  const filtered = assemblies.filter(a =>
    a.part_number.toLowerCase().includes(search.toLowerCase()) ||
    (a.product_category || '').toLowerCase().includes(search.toLowerCase()) ||
    (a.description || '').toLowerCase().includes(search.toLowerCase())
  )

  const duplicate = async (id: string, partNumber: string) => {
    const newPart = prompt('New part number for the clone:', `${partNumber}-COPY`)
    if (!newPart) return
    await fetch('/api/bom/final-assemblies/duplicate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, new_part_number: newPart }),
    })
    onRefresh()
  }

  const recalculate = async (id: string) => {
    await fetch(`/api/bom/final-assemblies/${id}/recalculate`, { method: 'POST' })
    onRefresh()
  }

  const deleteAssembly = async (id: string) => {
    if (!confirm('Delete this final assembly?')) return
    await fetch(`/api/bom/final-assemblies/${id}`, { method: 'DELETE' })
    onRefresh()
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
    onRefresh()
  }

  const updateOverhead = async (id: string, field: string, value: number) => {
    await fetch(`/api/bom/final-assemblies/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    })
    onRefresh()
  }

  return (
    <div className="space-y-4">
      {/* Config Panel */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="text-lg">Final Assemblies (Finished Products)</CardTitle>
          </div>
          <div className="flex gap-2">
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
                <>
                  <TableRow key={a.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expandedId === a.id ? null : a.id)}>
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
                              <div className="flex justify-between"><span className="text-muted-foreground">Parts/Hr:</span><span>{a.parts_per_hour}</span></div>
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
                </>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Editable Overhead Line ──────────────────────────────────────

function OverheadLine({ label, pctValue, cost, id, field, onSave }: {
  label: string
  pctValue: number
  cost: number
  id: string
  field: string
  onSave: (id: string, field: string, value: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState('')

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
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  onSave(id, field, Number(val) / 100)
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
