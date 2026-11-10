"use client";

import { usePathname } from "next/navigation";
import { ADMIN_GROUPS, ADMIN_LINKS } from "@/components/admin/admin-links";

/** Small section label above admin page titles, e.g. "Sales" or "Catalog". */
export function PageEyebrow({ override }: { override?: string }) {
  const pathname = usePathname();
  const link = [...ADMIN_LINKS]
    .sort((a, b) => b.href.length - a.href.length)
    .find((l) => (l.href === "/admin" ? pathname === "/admin" : pathname.startsWith(l.href)));
  const label = override ?? ADMIN_GROUPS.find((g) => g.key === link?.group)?.label;
  if (!label) return null;
  return (
    <p className="text-primary mb-1.5 text-[11px] font-semibold tracking-[0.14em] uppercase">
      {label}
    </p>
  );
}
