"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, LogOut, Menu, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { ADMIN_GROUPS, ADMIN_LINKS } from "@/components/admin/admin-links";

type NavProps = { name: string; email: string; permissions: string[] };

function isActive(pathname: string, href: string) {
  return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "A"
  );
}

function Brand() {
  return (
    <Link href="/admin" className="flex items-center gap-2.5 px-2" aria-label="Shayvera admin home">
      <Image src="/brand/mark.svg" alt="" width={34} height={30} className="h-7 w-auto" priority />
      <span className="flex items-baseline gap-1.5">
        <span className="heading-display text-[1.35rem] leading-none">Shayvera</span>
        <span className="bg-brand-soft text-brand rounded-full px-1.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase">
          Admin
        </span>
      </span>
    </Link>
  );
}

function NavLinks({ permissions, onNavigate }: { permissions: string[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const allowed = ADMIN_LINKS.filter((l) => permissions.includes(l.permission));
  return (
    <nav aria-label="Admin" className="flex flex-col gap-5">
      {ADMIN_GROUPS.map((g) => {
        const links = allowed.filter((l) => l.group === g.key);
        if (!links.length) return null;
        return (
          <div key={g.key}>
            <p className="text-muted-foreground/80 mb-1.5 px-3 text-[11px] font-semibold tracking-[0.08em] uppercase">
              {g.label}
            </p>
            <ul className="flex flex-col gap-0.5">
              {links.map(({ href, label, icon: Icon }) => {
                const active = isActive(pathname, href);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group/nav relative flex items-center gap-3 rounded-lg px-3 py-[7px] text-sm transition-colors duration-150",
                        active
                          ? "bg-card text-foreground font-medium shadow-[0_1px_2px_oklch(0.3_0.05_165/0.06),0_0_0_1px_oklch(0.3_0.05_165/0.06)]"
                          : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "bg-primary absolute top-1/2 left-0 h-4 w-[3px] -translate-y-1/2 rounded-r-full transition-opacity",
                          active ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <Icon
                        className={cn(
                          "size-4 shrink-0 transition-colors",
                          active ? "text-primary" : "group-hover/nav:text-foreground",
                        )}
                        aria-hidden
                      />
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function SignOutButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label="Sign out"
      title="Sign out"
      onClick={async () => {
        // Loaded on demand: keeps the auth client out of every page's initial JavaScript.
        const { authClient } = await import("@/lib/auth-client");
        await authClient.signOut();
        router.push("/login");
        router.refresh();
      }}
      className={cn(
        "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent focus-visible:ring-ring/40 inline-flex items-center gap-2 rounded-lg outline-none focus-visible:ring-[3px]",
        compact ? "size-8 justify-center" : "px-3 py-2 text-sm",
      )}
    >
      <LogOut className="size-4" aria-hidden />
      {!compact && "Sign out"}
    </button>
  );
}

function ProfileCard({ name, email }: { name: string; email: string }) {
  return (
    <div className="bg-card flex items-center gap-3 rounded-xl border p-2.5 shadow-[0_1px_2px_oklch(0.3_0.05_165/0.05)]">
      <span
        aria-hidden
        className="from-primary text-primary-foreground flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br to-[oklch(0.62_0.13_140)] text-xs font-semibold"
      >
        {initials(name)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="text-muted-foreground truncate text-xs">{email}</p>
      </div>
      <SignOutButton compact />
    </div>
  );
}

export function AdminSidebar({ name, email, permissions }: NavProps) {
  return (
    <aside className="bg-sidebar/80 sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r px-3 pt-5 pb-3 lg:flex">
      <Brand />
      <Button
        asChild
        variant="outline"
        size="sm"
        className="bg-card/70 mt-5 mb-5 w-full justify-start"
      >
        <Link href="/">
          <ArrowLeft /> Back to homepage
        </Link>
      </Button>
      <div className="admin-scroll -mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-4">
        <NavLinks permissions={permissions} />
      </div>
      <ProfileCard name={name} email={email} />
    </aside>
  );
}

export function AdminMobileNav({ name, email, permissions }: NavProps) {
  const [open, setOpen] = useState(false);
  return (
    <header className="bg-background/85 sticky top-0 z-30 flex h-14 items-center gap-2 border-b px-3 backdrop-blur lg:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Open admin menu">
            <Menu className="size-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="bg-sidebar flex w-72 flex-col gap-0 p-3 pt-5">
          <SheetHeader className="p-0 pb-5">
            <SheetTitle className="sr-only">Admin menu</SheetTitle>
            <Brand />
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto pb-4">
            <NavLinks permissions={permissions} onNavigate={() => setOpen(false)} />
          </div>
          <ProfileCard name={name} email={email} />
        </SheetContent>
      </Sheet>
      <Link href="/admin" className="flex items-center gap-2">
        <Image src="/brand/mark.svg" alt="" width={28} height={25} className="h-6 w-auto" />
        <span className="heading-display text-lg">Shayvera Admin</span>
      </Link>
      <Button asChild variant="outline" size="sm" className="ml-auto">
        <Link href="/">
          <ArrowLeft /> Homepage
        </Link>
      </Button>
    </header>
  );
}

/** Desktop top bar: quick order search ("/" to focus) and today's date. */
export function AdminTopbar({ canSearchOrders }: { canSearchOrders: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [today, setToday] = useState("");
  useEffect(() => {
    // Client-only (avoids a server/client date mismatch around midnight).
    const t = setTimeout(
      () =>
        setToday(
          new Date().toLocaleDateString("en-IN", {
            weekday: "long",
            day: "numeric",
            month: "long",
          }),
        ),
      0,
    );
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  return (
    <header className="bg-background/80 sticky top-0 z-20 hidden h-16 items-center gap-4 border-b px-6 backdrop-blur-md lg:flex xl:px-10">
      {canSearchOrders ? (
        <form
          role="search"
          className="relative w-full max-w-md"
          onSubmit={(e) => {
            e.preventDefault();
            const q = inputRef.current?.value.trim() ?? "";
            router.push(q ? `/admin/orders?q=${encodeURIComponent(q)}` : "/admin/orders");
          }}
        >
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <input
            ref={inputRef}
            type="search"
            aria-label="Search orders"
            placeholder="Search orders by number, email or phone"
            className="bg-card placeholder:text-muted-foreground/80 focus-visible:border-ring focus-visible:ring-ring/25 h-10 w-full rounded-full border pr-10 pl-9 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
          />
          <kbd className="text-muted-foreground bg-muted pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded border px-1.5 font-mono text-[11px]">
            /
          </kbd>
        </form>
      ) : (
        <span />
      )}
      <p className="text-muted-foreground ml-auto text-sm" suppressHydrationWarning>
        {today}
      </p>
    </header>
  );
}
