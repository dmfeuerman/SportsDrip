import { useEffect, useMemo, useRef, useState } from "react";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { AvatarConfig, Equipped } from "@/types/avatar";
import type { CatalogItem } from "@/types/catalog";
import { assetEntry, baseEntry } from "./assets";
import type { AppearanceParts, GarmentSource } from "./avatarRig";
import { loadAsset, peekAsset, type AssetRef } from "./loader";
import { pieceLook, resolveOutfit, type OutfitPiece, type ResolvedOutfit } from "./outfit";
import { facialHairAssetKey, hairAssetKey } from "./spec";

export function useResolvedOutfit(equipped: Equipped, catalog: Map<string, CatalogItem>): ResolvedOutfit {
  // Key order varies between the phone's copy and the server's: don't re-resolve for that.
  const sig = Object.keys(equipped)
    .sort()
    .map((k) => `${k}=${equipped[k as keyof Equipped] ?? ""}`)
    .join("|");
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
  /** The look these assets dress: always draw `avatar` + `outfit` from here, never the props. */
  avatar: AvatarConfig;
  outfit: ResolvedOutfit;
}

const outfitSig = (outfit: ResolvedOutfit) =>
  outfit.pieces.map((p) => `${p.slot}:${pieceLook(p)}:${p.attach ? JSON.stringify(p.attach) : ""}:${p.hides?.join("+") ?? "-"}:${p.layer}`).join(",");

/** Everything the look needs, if it's all already in memory (no await, no flash). */
function peekAll(avatar: AvatarConfig, outfit: ResolvedOutfit): Omit<AvatarAssets, "status" | "avatar" | "outfit"> | null {
  const base = peekAsset({ key: baseEntry(avatar.base).key });
  if (!base) return null;
  const parts = peekParts(avatar);
  if (!parts) return null;
  const garments: GarmentSource[] = [];
  for (const piece of outfit.pieces) {
    const gltf = peekAsset(pieceRef(piece));
    if (!gltf) return null;
    garments.push({ piece, gltf });
  }
  return { base, parts, garments };
}

type Loaded = { key: string; base: GLTF; parts: AppearanceParts; garments: GarmentSource[] } | { key: string; error: true };

/**
 * Base + hair + facial hair + garments for a look, all or nothing: a look is
 * only ever handed over complete. Already-cached looks (anything tried on in
 * the Drip Shop) are returned on the same render; while a new one downloads,
 * the previous complete look stays up, so a character never shows a body
 * without its clothes or an outfit missing a piece.
 */
export function useAvatarAssets(avatar: AvatarConfig, outfit: ResolvedOutfit): AvatarAssets {
  const baseKey = baseEntry(avatar.base).key;
  const keys = partKeys(avatar);
  const key = `${baseKey}|${keys.hair ?? "-"}|${keys.facialHair ?? "-"}|${outfitSig(outfit)}`;

  // Cheap Map lookups; recomputed when the look changes.
  const peeked = useMemo(() => peekAll(avatar, outfit), [avatar, outfit]);
  const need = !peeked;

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    if (!need) return;
    let alive = true;
    Promise.all([loadAsset({ key: baseKey }), loadParts(avatar), loadGarments(outfit.pieces)])
      .then(([base, parts, garments]) => alive && setLoaded({ key, base, parts, garments }))
      .catch((e) => {
        console.warn("[avatar] base model failed to load", e);
        if (alive) setLoaded({ key, error: true });
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, need]);

  // The last complete look handed out, shown while the next one loads.
  const last = useRef<AvatarAssets | null>(null);
  const fresh = peeked ?? (loaded && loaded.key === key && !("error" in loaded) ? loaded : null);
  if (fresh) {
    const prev = last.current;
    // Same objects as last render when nothing changed, so the scene doesn't rebind.
    if (!prev || prev.base !== fresh.base || prev.avatar !== avatar || prev.outfit !== outfit || !sameParts(prev.parts, fresh.parts) || !sameGarments(prev.garments, fresh.garments)) {
      last.current = { base: fresh.base, parts: fresh.parts, garments: fresh.garments, status: "ready", avatar, outfit };
    }
    return last.current!;
  }
  if (last.current) return last.current;
  return {
    base: null,
    parts: NO_PARTS,
    garments: NO_GARMENTS,
    status: loaded && loaded.key === key && "error" in loaded ? "error" : "loading",
    avatar,
    outfit,
  };
}

const NO_PARTS: AppearanceParts = { hair: null, facialHair: null };
const NO_GARMENTS: GarmentSource[] = [];
const sameParts = (a: AppearanceParts, b: AppearanceParts) => a.hair === b.hair && a.facialHair === b.facialHair;
const sameGarments = (a: GarmentSource[], b: GarmentSource[]) =>
  a.length === b.length && a.every((g, i) => g.gltf === b[i]!.gltf && g.piece === b[i]!.piece);
