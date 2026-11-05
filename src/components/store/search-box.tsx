"use client";

import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";

type Suggestion = { slug: string; name: string; image?: string; pricePaise: number };

export function SearchBox({
  className,
  autoFocus,
  onNavigate,
}: {
  className?: string;
  autoFocus?: boolean;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search/suggest?q=${encodeURIComponent(term)}`, {
          signal: ctrl.signal,
        });
        if (res.ok) {
          setItems((await res.json()).data);
          setOpen(true);
          setActive(-1);
        }
      } catch {
        /* aborted */
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    onNavigate?.();
    router.push(href);
  };

  const showList = open && q.trim().length >= 2 && items.length > 0;

  return (
    <div ref={boxRef} className={cn("relative", className)}>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const term = q.trim();
          if (active >= 0 && items[active]) go(`/product/${items[active].slug}`);
          else if (term) go(`/search?q=${encodeURIComponent(term)}`);
        }}
      >
        <label htmlFor={`${listId}-input`} className="sr-only">
          Search products
        </label>
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2"
          aria-hidden
        />
        <input
          id={`${listId}-input`}
          type="search"
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => {
            setQ(e.target.value);
            if (e.target.value.trim().length < 2) setItems([]);
          }}
          onFocus={() => items.length && setOpen(true)}
          onKeyDown={(e) => {
            if (!showList) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, items.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, -1));
            } else if (e.key === "Escape") setOpen(false);
          }}
          placeholder="Search mugs, candles, notebooks…"
          autoComplete="off"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          maxLength={100}
          className="border-input bg-card placeholder:text-muted-foreground/80 focus-visible:border-ring focus-visible:ring-ring/25 h-10 w-full rounded-full border pr-4 pl-10 text-sm outline-none focus-visible:ring-[3px] [&::-webkit-search-cancel-button]:hidden"
        />
      </form>
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="bg-popover shadow-lift absolute top-12 right-0 left-0 z-50 overflow-hidden rounded-xl border p-1.5"
        >
          {items.map((s, i) => (
            <li
              key={s.slug}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                go(`/product/${s.slug}`);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-lg p-2",
                i === active && "bg-accent",
              )}
            >
              {s.image && (
                <Image
                  src={s.image}
                  alt=""
                  width={40}
                  height={50}
                  className="h-12 w-10 rounded-md object-cover"
                />
              )}
              <span className="flex-1 truncate text-sm">{s.name}</span>
              <span className="text-muted-foreground text-sm tabular-nums">
                {formatINR(s.pricePaise)}
              </span>
            </li>
          ))}
          <li
            role="option"
            aria-selected={false}
            onMouseDown={(e) => {
              e.preventDefault();
              go(`/search?q=${encodeURIComponent(q.trim())}`);
            }}
            className="text-brand hover:bg-accent cursor-pointer rounded-lg p-2 text-sm font-medium"
          >
            See all results for “{q.trim()}”
          </li>
        </ul>
      )}
    </div>
  );
}
