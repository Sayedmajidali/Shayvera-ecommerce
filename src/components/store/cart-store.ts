"use client";

import { useSyncExternalStore } from "react";

/**
 * Tiny client store for the cart drawer: whether it is open, why it was opened, and a version that
 * bumps whenever the cart changes (so the drawer refetches). Cart contents always come from the
 * server (`GET /api/cart`); nothing is priced on the client.
 */
type State = { open: boolean; reason: "click" | "added" | null; version: number };
let state: State = { open: false, reason: null, version: 0 };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const serverState: State = { open: false, reason: null, version: 0 };

/** Element that opened the drawer; focus returns there when it closes. */
let opener: HTMLElement | null = null;
export function takeOpener() {
  const el = opener;
  opener = null;
  return el;
}

export function openCart(reason: "click" | "added" = "click", from?: HTMLElement | null) {
  opener =
    from ??
    (typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null);
  state = { ...state, open: true, reason, version: state.version + 1 };
  emit();
}

export function setCartOpen(open: boolean) {
  state = { ...state, open, reason: open ? state.reason : null };
  emit();
}

export function cartChanged() {
  state = { ...state, version: state.version + 1 };
  emit();
}

export function useCartUi() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => serverState,
  );
}
