"use client";

import { lazy, Suspense, useState } from "react";
import { useCartUi } from "@/components/store/cart-store";
import { useQuickViewSlug } from "@/components/store/quick-view-store";

// The cart drawer and Quick View are only downloaded the first time they are needed, keeping them
// out of every page's initial JavaScript.
const CartDrawer = lazy(() =>
  import("@/components/store/cart-drawer").then((m) => ({ default: m.CartDrawer })),
);
const QuickViewDialog = lazy(() =>
  import("@/components/store/quick-view").then((m) => ({ default: m.QuickViewDialog })),
);

export function StoreOverlays() {
  const { open } = useCartUi();
  const slug = useQuickViewSlug();
  // Once mounted, keep them mounted so closing animations and caches survive.
  const [cartUsed, setCartUsed] = useState(false);
  const [quickUsed, setQuickUsed] = useState(false);
  if (open && !cartUsed) setCartUsed(true);
  if (slug && !quickUsed) setQuickUsed(true);
  return (
    <Suspense fallback={null}>
      {(cartUsed || open) && <CartDrawer />}
      {(quickUsed || slug) && <QuickViewDialog />}
    </Suspense>
  );
}
