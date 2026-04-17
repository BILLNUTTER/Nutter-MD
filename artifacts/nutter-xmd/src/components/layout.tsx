import { Link, useLocation } from "wouter";
import { Smartphone, TerminalSquare, ShieldAlert } from "lucide-react";

function useIsAdminUnlocked() {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("admin") === "true";
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const isAdminUnlocked = useIsAdminUnlocked();

  const navItems = [
    { href: "/", label: "Pairing", icon: Smartphone },
    { href: "/deploy", label: "Deploy", icon: TerminalSquare },
    ...(isAdminUnlocked ? [{ href: "/admin", label: "Admin", icon: ShieldAlert }] : []),
  ];

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground dark selection:bg-primary/30 selection:text-primary">
      <header className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex h-16 items-center justify-between">
          <div className="flex items-center gap-2 font-mono text-lg font-bold tracking-tight text-primary">
            <span className="text-2xl leading-none select-none">🇰🇪</span>
            <span>NUTTER-XMD</span>
          </div>

          <nav className="flex items-center gap-6 text-sm font-medium">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 transition-colors hover:text-primary ${
                  location === item.href ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <item.icon className="h-4 w-4" />
                <span className="hidden sm:inline-block">{item.label}</span>
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 relative flex flex-col">
        <div className="pointer-events-none fixed inset-0 flex justify-center">
          <div className="h-[500px] w-[500px] rounded-full bg-primary/5 blur-[120px] -translate-y-1/2" />
        </div>
        <div className="relative z-10 flex-1 flex flex-col">
          {children}
        </div>
      </main>

      <footer className="border-t border-border/50 py-4">
        <div className="w-full max-w-7xl mx-auto px-4 flex items-center justify-center">
          <p className="text-xs text-muted-foreground">
            🇰🇪 NUTTER-XMD — Kenya's premier WhatsApp multi-device bot
          </p>
        </div>
      </footer>
    </div>
  );
}
