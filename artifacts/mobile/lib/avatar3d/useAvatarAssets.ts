import { useEffect, useMemo, useState } from "react";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { AvatarConfig, Equipped } from "@/types/avatar";
import type { CatalogItem } from "@/types/catalog";
import { assetEntry, baseEntry } from "./assets";
import type { AppearanceParts, GarmentSource } from "./avatarRig";
import { loadAsset, peekAsset, type AssetRef } from "./loader";
import { resolveOutfit, type OutfitPiece, type ResolvedOutfit } from "./outfit";
import { facialHairAssetKey, hairAssetKey } from "./spec";

export function useResolvedOutfit(equipped: Equipped, catalog: Map<string, CatalogItem>): ResolvedOutfit {
  const sig = JSON.stringify(equipped);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => resolveOutfit(equipped, catalog), [sig, catalog]);
}

export const pieceRef = (p: Pick<OutfitPiece, "template" | "url" | "version">): AssetRef =>
  p.template ? { key: p.template } : { url: p.url!, version: p.version ?? null };

const warned = new Set<string>();

/** Loads every garment in `pieces`; ones that fail are left out (and logged once). */
export async function loadGarments(pieces: OutfitPiece[]): Promise<GarmentSource[]> {
  const out = await Promise.all(
    pieces.map(async (piece) => {
      try {
        return { piece, gltf: await loadAsset(pieceRef(piece)) };
      } catch (e) {
        const id = `${piece.itemId}`;
        if (!warned.has(id)) {
          warned.add(id);
          console.warn(`[avatar] couldn't load garment for ${id}; rendering without it`, e);
        }
        return null;
      }
    })
  );
  return out.filter((x): x is GarmentSource => !!x);
}

/** Asset keys of the appearance parts a look needs (null where the look has none, or the asset isn't bundled). */
export function partKeys(avatar: AvatarConfig) {
  const h = hairAssetKey(avatar.hairStyle);
  const f = facialHairAssetKey(avatar.facialHair);
  return { hair: h && assetEntry(h) ? h : null, facialHair: f && assetEntry(f) ? f : null };
}

const loadPart = (key: string | null) =>
  key
    ? loadAsset({ key }).catch((e) => {
        if (!warned.has(key)) {
          warned.add(key);
          console.warn(`[avatar] couldn't load ${key}; rendering without it`, e);
        }
        return null;
      })
    : Promise.resolve(null);

/** Hair and facial hair for a look. A part that fails to load is left off rather than failing the character. */
export async function loadParts(avatar: AvatarConfig): Promise<AppearanceParts> {
  const k = partKeys(avatar);
  const [hair, facialHair] = await Promise.all([loadPart(k.hair), loadPart(k.facialHair)]);
  return { hair, facialHair };
}

function peekParts(avatar: AvatarConfig): AppearanceParts | null {
  const k = partKeys(avatar);
  const hair = k.hair ? peekAsset({ key: k.hair }) : null;
  const facialHair = k.facialHair ? peekAsset({ key: k.facialHair }) : null;
  if ((k.hair && !hair) || (k.facialHair && !facialHair)) return null;
  return { hair: hair ?? null, facialHair: facialHair ?? null };
}

export interface AvatarAssets {
  base: GLTF | null;
  parts: AppearanceParts;
  garments: GarmentSource[];
  status: "loading" | "ready" | "error";
}

/**
 * Base + hair + facial hair + garments for a look. Keeps showing the previous
 * parts and garments while new ones download, so changing a hat or a
 * hairstyle doesn't blank the character.
 */
export function useAvatarAssets(avatar: AvatarConfig, outfit: ResolvedOutfit): AvatarAssets {
  const base = baseEntry(avatar.base);
  const baseRef = { key: base.key };
  const [state, setState] = useState<AvatarAssets>(() => {
    const b = peekAsset(baseRef) ?? null;
    const parts = peekParts(avatar);
    const g = outfit.pieces
      .map((piece) => ({ piece, gltf: peekAsset(pieceRef(piece)) }))
      .filter((x): x is GarmentSource => !!x.gltf);
    const complete = b && parts && g.length === outfit.pieces.length;
    return { base: b, parts: parts ?? { hair: null, facialHair: null }, garments: g, status: complete ? "ready" : "loading" };
  });

  const sig = outfit.pieces.map((p) => `${p.slot}:${p.template ?? p.url}@${p.version ?? ""}:${p.primary}:${p.secondary}:${p.attach ? JSON.stringify(p.attach) : ""}:${p.hides?.join("+") ?? "-"}:${p.layer}`).join(",");
  const keys = partKeys(avatar);
  useEffect(() => {
    let alive = true;
    Promise.all([loadAsset(baseRef), loadParts(avatar), loadGarments(outfit.pieces)])
      .then(([b, parts, g]) => alive && setState({ base: b, parts, garments: g, status: "ready" }))
      .catch((e) => {
        console.warn("[avatar] base model failed to load", e);
        if (alive) setState((s) => ({ ...s, status: "error" }));
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base.key, sig, keys.hair, keys.facialHair]);

  return state;
}
