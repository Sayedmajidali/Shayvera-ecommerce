"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Menu, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { ADMIN_LINKS } from "@/components/admin/admin-links";

type NavProps = { name: string; email: string; permissions: string[] };

function NavLinks({ permissions, onNavigate }: { permissions: string[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin" className="flex flex-col gap-0.5">
      {ADMIN_LINKS.filter((l) => permissions.includes(l.permission)).map(
        ({ href, label, icon: Icon }) => {
          const active = href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
              )}
            >
              <Icon className="size-4" /> {label}
            </Link>
          );
        },
      )}
    </nav>
  );
}

function Footer({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  return (
    <div className="mt-auto space-y-1 border-t pt-4">
      <Link
        href="/"
        className="text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground flex items-center gap-3 rounded-lg px-3 py-2 text-sm"
      >
        <Store className="size-4" /> View store
      </Link>
      <button
        type="button"
        onClick={async () => {
          await authClient.signOut();
          router.push("/login");
          router.refresh();
        }}
        className="text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm"
      >
        <LogOut className="size-4" /> Sign out
      </button>
      <div className="px-3 pt-2">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="text-muted-foreground truncate text-xs">{email}</p>
      </div>
    </div>
  );
}

export function AdminSidebar({ name, email, permissions }: NavProps) {
  return (
    <aside className="bg-sidebar sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r p-4 lg:flex">
      <Link href="/admin" className="heading-display mb-6 px-3 text-xl">
        Shayvera<span className="text-brand">.</span>{" "}
        <span className="text-muted-foreground font-sans text-xs">Admin</span>
      </Link>
      <NavLinks permissions={permissions} />
      <Footer name={name} email={email} />
    </aside>
  );
}

export function AdminMobileNav({ name, email, permissions }: NavProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-sidebar sticky top-0 z-30 flex h-14 items-center gap-3 border-b px-4 lg:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Open admin menu">
            <Menu className="size-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="flex flex-col p-4">
          <SheetHeader className="p-0 pb-4">
            <SheetTitle>Admin</SheetTitle>
          </SheetHeader>
          <NavLinks permissions={permissions} onNavigate={() => setOpen(false)} />
          <Footer name={name} email={email} />
        </SheetContent>
      </Sheet>
      <span className="heading-display text-lg">Shayvera Admin</span>
    </div>
  );
}
