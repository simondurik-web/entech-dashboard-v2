'use client'

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react'

export type Language = 'en' | 'es'

// Translation keys matching the v1 dashboard
const translations = {
  en: {
    // Navigation
    'nav.production': 'Production',
    'nav.ordersData': 'Orders Data',
    'nav.productionMake': 'Need to Make',
    'nav.ordersQueue': 'Need to Package',
    'nav.ordersStaged': 'Ready to Ship',
    'nav.ordersShipped': 'Shipped',
    'nav.inventory': 'Inventory',
    'nav.inventoryHistory': 'Inventory History',
    'nav.drawingsLibrary': 'Drawings',
    'nav.palletRecords': 'Pallet Records',
    'nav.shippingRecords': 'Shipping Records',
    'nav.stagedRecords': 'Staged Records',
    'nav.salesFinance': 'Sales & Finance',
    'nav.rawData': 'Raw Data',
    'nav.aiAssistant': 'Phil Assistant',

    // Category filters
    'category.all': 'All',
    'category.rollTech': 'Roll Tech',
    'category.molding': 'Molding',
    'category.snappad': 'Snap Pad',

    // Status labels
    'status.needToMake': 'Need to Make',
    'status.making': 'Making',
    'status.readyToShip': 'Ready to Ship',
    'status.shipped': 'Shipped',
    'status.staged': 'Staged',

    // Stats
    'stats.totalOrders': 'Total Orders',
    'stats.totalUnits': 'units',
    'stats.urgent': 'Urgent',
    'stats.dueThisWeek': 'Due This Week',
    'stats.overdue': 'Overdue',
    'stats.inProduction': 'In Production',
    'stats.readyToPackage': 'Ready to Package',
    'stats.missingStock': 'Missing Stock',
    'stats.totalShipments': 'Total Shipments',
    'stats.totalStaged': 'Total Staged',

    // UI
    'ui.search': 'Search...',
    'ui.export': 'Export',
    'ui.columns': 'Columns',
    'ui.filter': 'Filter',
    'ui.clearFilters': 'Clear Filters',
    'ui.noResults': 'No results found',
    'ui.loading': 'Loading...',
    'ui.allTime': 'All Time',
    'ui.last7Days': 'Last 7 Days',
    'ui.last30Days': 'Last 30 Days',
    'ui.last90Days': 'Last 90 Days',

    // Table headers
    'table.line': 'Line',
    'table.customer': 'Customer',
    'table.partNumber': 'Part Number',
    'table.category': 'Category',
    'table.qty': 'Qty',
    'table.due': 'Due',
    'table.status': 'Status',
    'table.assignedTo': 'Assigned To',
    'table.shipDate': 'Ship Date',
    'table.inStock': 'In Stock',
    'table.minimum': 'Minimum',

    // Page titles
    'page.orders': 'Orders',
    'page.needToMake': 'Need to Make',
    'page.needToPackage': 'Need to Package',
    'page.staged': 'Ready to Ship',
    'page.shipped': 'Shipped',
    'page.inventory': 'Inventory',
    'page.inventoryHistory': 'Inventory History',
    'page.drawings': 'Drawings Library',
    'page.palletRecords': 'Pallet Records',
    'page.shippingRecords': 'Shipping Records',
    'page.stagedRecords': 'Staged Records',
  },
  es: {
    // Navigation
    'nav.production': 'Producción',
    'nav.ordersData': 'Datos de Órdenes',
    'nav.productionMake': 'Por Fabricar',
    'nav.ordersQueue': 'Por Empacar',
    'nav.ordersStaged': 'Listo para Enviar',
    'nav.ordersShipped': 'Enviado',
    'nav.inventory': 'Inventario',
    'nav.inventoryHistory': 'Historial de Inventario',
    'nav.drawingsLibrary': 'Dibujos',
    'nav.palletRecords': 'Registros de Paletas',
    'nav.shippingRecords': 'Registros de Envío',
    'nav.stagedRecords': 'Registros Preparados',
    'nav.salesFinance': 'Ventas y Finanzas',
    'nav.rawData': 'Datos Crudos',
    'nav.aiAssistant': 'Asistente Phil',

    // Category filters
    'category.all': 'Todos',
    'category.rollTech': 'Roll Tech',
    'category.molding': 'Moldeo',
    'category.snappad': 'Snap Pad',

    // Status labels
    'status.needToMake': 'Por Fabricar',
    'status.making': 'Fabricando',
    'status.readyToShip': 'Listo para Enviar',
    'status.shipped': 'Enviado',
    'status.staged': 'Preparado',

    // Stats
    'stats.totalOrders': 'Total de Órdenes',
    'stats.totalUnits': 'unidades',
    'stats.urgent': 'Urgente',
    'stats.dueThisWeek': 'Vence Esta Semana',
    'stats.overdue': 'Vencido',
    'stats.inProduction': 'En Producción',
    'stats.readyToPackage': 'Listo para Empacar',
    'stats.missingStock': 'Sin Inventario',
    'stats.totalShipments': 'Total de Envíos',
    'stats.totalStaged': 'Total Preparados',

    // UI
    'ui.search': 'Buscar...',
    'ui.export': 'Exportar',
    'ui.columns': 'Columnas',
    'ui.filter': 'Filtrar',
    'ui.clearFilters': 'Limpiar Filtros',
    'ui.noResults': 'No se encontraron resultados',
    'ui.loading': 'Cargando...',
    'ui.allTime': 'Todo el Tiempo',
    'ui.last7Days': 'Últimos 7 Días',
    'ui.last30Days': 'Últimos 30 Días',
    'ui.last90Days': 'Últimos 90 Días',

    // Table headers
    'table.line': 'Línea',
    'table.customer': 'Cliente',
    'table.partNumber': 'Número de Parte',
    'table.category': 'Categoría',
    'table.qty': 'Cant.',
    'table.due': 'Vence',
    'table.status': 'Estado',
    'table.assignedTo': 'Asignado a',
    'table.shipDate': 'Fecha de Envío',
    'table.inStock': 'En Stock',
    'table.minimum': 'Mínimo',

    // Page titles
    'page.orders': 'Órdenes',
    'page.needToMake': 'Por Fabricar',
    'page.needToPackage': 'Por Empacar',
    'page.staged': 'Listo para Enviar',
    'page.shipped': 'Enviado',
    'page.inventory': 'Inventario',
    'page.inventoryHistory': 'Historial de Inventario',
    'page.drawings': 'Biblioteca de Dibujos',
    'page.palletRecords': 'Registros de Paletas',
    'page.shippingRecords': 'Registros de Envío',
    'page.stagedRecords': 'Registros Preparados',
  },
} as const

type TranslationKey = keyof typeof translations.en

interface I18nContextType {
  language: Language
  setLanguage: (lang: Language) => void
  t: (key: TranslationKey) => string
}

const I18nContext = createContext<I18nContextType | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('en')

  useEffect(() => {
    // Load from localStorage on mount
    const stored = localStorage.getItem('language') as Language | null
    if (stored && (stored === 'en' || stored === 'es')) {
      setLanguageState(stored)
    }
  }, [])

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang)
    localStorage.setItem('language', lang)
  }, [])

  const t = useCallback(
    (key: TranslationKey): string => {
      return translations[language][key] || translations.en[key] || key
    },
    [language]
  )

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider')
  }
  return context
}

// Standalone hook for simple translation without context
export function useTranslation() {
  return useI18n()
}
