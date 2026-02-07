import { ThemeToggle } from "@/components/layout/theme-toggle"
import { BottomNav } from "@/components/layout/bottom-nav"
import Link from "next/link"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-background">
      {/* Top header */}
      <header className="sticky top-0 z-40 border-b bg-background">
        <div className="flex h-14 items-center justify-between px-4">
          <Link href="/orders" className="text-lg font-semibold">
            Entech Dashboard
          </Link>
          <div className="flex items-center gap-2">
            {/* Desktop nav links */}
            <nav className="hidden items-center gap-4 md:flex">
              <Link
                href="/orders"
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                Orders
              </Link>
              <Link
                href="/staged"
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                Staged
              </Link>
              <Link
                href="/inventory"
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                Inventory
              </Link>
            </nav>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Main content - pad bottom on mobile for nav bar */}
      <main className="pb-20 md:pb-0">{children}</main>

      {/* Mobile bottom nav */}
      <BottomNav />
    </div>
  )
}
