"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type FilterSelect = {
  name: string;
  label: string;
  options: { value: string; label: string }[];
};

/** URL-driven search + select filters for admin tables. */
export function FilterBar({
  placeholder = "Search…",
  selects = [],
}: {
  placeholder?: string;
  selects?: FilterSelect[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, start] = useTransition();
  const push = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (!v || v === "all") next.delete(k);
      else next.set(k, v);
    }
    next.delete("page");
    start(() => router.push(`${pathname}${next.size ? `?${next}` : ""}`));
  };
  return (
    <div className="flex flex-wrap items-center gap-3 border-b p-4">
      <form
        className="relative min-w-56 flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          push({ q: String(new FormData(e.currentTarget).get("q") ?? "").trim() || null });
        }}
      >
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          aria-hidden
        />
        <Input
          name="q"
          defaultValue={params.get("q") ?? ""}
          placeholder={placeholder}
          className="h-9 pl-9"
          aria-label={placeholder}
        />
      </form>
      {selects.map((s) => (
        <Select
          key={s.name}
          value={params.get(s.name) ?? "all"}
          onValueChange={(v) => push({ [s.name]: v })}
        >
          <SelectTrigger className="h-9 w-44" aria-label={s.label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All {s.label.toLowerCase()}</SelectItem>
            {s.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}
    </div>
  );
}
