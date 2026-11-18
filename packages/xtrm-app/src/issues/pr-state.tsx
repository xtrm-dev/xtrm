/**
 * The PR state chip moved to `src/ui/pr-key.tsx` (§4.4): one module owns the state model, the key
 * and the chip. This module stays as the alias its callers import, so no surface had to change in
 * the same slice as the key.
 */
export { PrStateBadge, PrStateChip, type PrStateChipProps, type PrStateChipProps as PrStateBadgeProps } from "../ui/pr-key.tsx";
