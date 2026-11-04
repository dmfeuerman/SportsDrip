import { useMemo } from "react";
import { levelUpCredits, MAX_LEVEL } from "@/constants/progression";
import { useBackgrounds } from "@/hooks/useBackgrounds";
import { useCatalog } from "@/hooks/useCatalog";
import type { CatalogItem, Rarity } from "@/types/catalog";

export interface LevelUnlock {
  level: number;
  kind: "item" | "background";
  id: string;
  name: string;
  rarity: Rarity;
  /** "reward": granted free at the level. "unlock": becomes buyable at the level. */
  mode: "reward" | "unlock";
  item?: CatalogItem;
}

export interface LevelRow {
  level: number;
  credits: number;
  unlocks: LevelUnlock[];
}

/**
 * Everything tied to a level, from the catalog and the backgrounds list:
 * free level rewards and level-gated store items, plus the credits each level
 * pays. Drives the level bar's "next" hint, the Levels screen and the
 * level-up celebration.
 */
export function useLevelRewards() {
  const { byId: catalog } = useCatalog();
  const { backgrounds } = useBackgrounds();

  const unlocks = useMemo<LevelUnlock[]>(() => {
    const out: LevelUnlock[] = [];
    for (const item of catalog.values()) {
      if (item.available === false) continue;
      if (item.levelReward && item.levelReward > 0) out.push({ level: item.levelReward, kind: "item", id: item.id, name: item.name, rarity: item.rarity, mode: "reward", item });
      else if (item.levelRequired && item.levelRequired > 1) out.push({ level: item.levelRequired, kind: "item", id: item.id, name: item.name, rarity: item.rarity, mode: "unlock", item });
    }
    for (const b of backgrounds) {
      if (b.levelReward) out.push({ level: b.levelReward, kind: "background", id: b.id, name: b.name, rarity: b.rarity, mode: "reward" });
      else if (b.levelRequired && b.levelRequired > 1 && b.forSale) out.push({ level: b.levelRequired, kind: "background", id: b.id, name: b.name, rarity: b.rarity, mode: "unlock" });
    }
    return out.sort((a, b) => a.level - b.level || (a.mode === b.mode ? 0 : a.mode === "reward" ? -1 : 1));
  }, [catalog, backgrounds]);

  const rows = useMemo<LevelRow[]>(() => {
    const by = new Map<number, LevelUnlock[]>();
    for (const u of unlocks) by.set(u.level, [...(by.get(u.level) ?? []), u]);
    return Array.from({ length: MAX_LEVEL - 1 }, (_, i) => {
      const level = i + 2;
      return { level, credits: levelUpCredits(level), unlocks: by.get(level) ?? [] };
    });
  }, [unlocks]);

  /** Short hint for the next level that unlocks something: "Rookie Cap at Lv 3". */
  const nextAfter = (level: number): string | null => {
    const u = unlocks.find((x) => x.level > level && x.mode === "reward") ?? unlocks.find((x) => x.level > level);
    return u ? `${u.name} at Lv ${u.level}` : null;
  };

  /** What reaching levels (from, to] gives: credits and unlocks. */
  const between = (from: number, to: number) => ({
    credits: rows.filter((r) => r.level > from && r.level <= to).reduce((s, r) => s + r.credits, 0),
    unlocks: unlocks.filter((u) => u.level > from && u.level <= to),
  });

  return { unlocks, rows, nextAfter, between };
}
