/**
 * Time-window rules for catalog items. Pure so the server (purchase / gift)
 * and tests agree; artifacts/mobile/lib/storeWindow.ts mirrors it for display.
 *
 *  available: false        → never sold
 *  releaseAt / availableFrom → not sold before (epoch ms)
 *  availableUntil          → not sold at or after (epoch ms)
 *  featured                → shown in the Featured section while sellable
 */
export interface WindowFields {
  available?: boolean | null;
  releaseAt?: number | null;
  availableFrom?: number | null;
  availableUntil?: number | null;
  featured?: boolean | null;
}

export type WindowState = "on_sale" | "disabled" | "upcoming" | "expired";

export const LEAVING_SOON_MS = 72 * 3600_000;

export function windowState(item: WindowFields, now: number): WindowState {
  if (item.available === false) return "disabled";
  const from = Math.max(num(item.releaseAt), num(item.availableFrom));
  if (from && from > now) return "upcoming";
  const until = num(item.availableUntil);
  if (until && until <= now) return "expired";
  return "on_sale";
}

export function isLeavingSoon(item: WindowFields, now: number): boolean {
  const until = num(item.availableUntil);
  return windowState(item, now) === "on_sale" && !!until && until - now <= LEAVING_SOON_MS;
}

export function windowError(state: WindowState): string | null {
  switch (state) {
    case "disabled":
      return "That item isn't available right now.";
    case "upcoming":
      return "That item hasn't dropped yet.";
    case "expired":
      return "That item has left the shop.";
    default:
      return null;
  }
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
