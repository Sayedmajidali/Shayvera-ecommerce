/** Units that can be sold now: on hand minus units reserved for open orders. */
export function availableUnits(
  inv: { quantityOnHand: number; quantityReserved: number } | null | undefined,
): number {
  return inv ? Math.max(0, inv.quantityOnHand - inv.quantityReserved) : 0;
}
