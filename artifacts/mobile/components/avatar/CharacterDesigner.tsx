import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeInDown, FadeOut, ZoomIn } from "react-native-reanimated";
import AvatarDisplay from "@/components/AvatarDisplay";
import { Chips, Stops, Swatches } from "@/components/avatar/EditorControls";
import { Pressable } from "@/components/fx/Tap";
import { Button } from "@/components/ui";
import {
  EYE_COLORS,
  EYE_SHAPES,
  EYEBROWS,
  FACE_SHAPES,
  FACIAL_HAIR,
  HAIR_COLORS,
  HAIR_STYLES,
  MOUTH_SHAPES,
  NOSE_SHAPES,
  SKIN_TONES,
  randomAvatar,
} from "@/constants/avatarOptions";
import { MOVE_LIBRARY } from "@/constants/moves";
import { useColors } from "@/hooks/useColors";
import type { Focus } from "@/lib/avatar3d/spec";
import { haptic as buzz } from "@/lib/motion";
import type { AvatarConfig } from "@/types/avatar";
import type { CatalogItem } from "@/types/catalog";

type Key = "skinTone" | "height" | "bodyType" | "faceShape" | "eyeShape" | "eyeColor" | "eyebrows" | "noseShape" | "mouthShape" | "hairStyle" | "hairColor" | "facialHair";

type StepDef = { key: Key; title: string; sub: string; label: string; focus: Focus } & (
  | { kind: "swatch"; options: string[]; fallback: string }
  | { kind: "chips"; options: Array<{ id: string; label: string }>; fallback: string }
  | { kind: "stops"; ends: [string, string] }
);

/** One screen per trait, ordered so the camera works from full body in to the face. */
const STEPS: StepDef[] = [
  { key: "skinTone", title: "Skin Tone", sub: "Start with the base.", label: "Skin tone", focus: "full", kind: "swatch", options: SKIN_TONES, fallback: SKIN_TONES[0]! },
  { key: "height", title: "Height", sub: "How tall do you stand?", label: "Height", focus: "full", kind: "stops", ends: ["Shorter", "Taller"] },
  { key: "bodyType", title: "Build", sub: "Slim, broad or somewhere between.", label: "Build", focus: "full", kind: "stops", ends: ["Slim", "Broad"] },
  { key: "faceShape", title: "Face Shape", sub: "Let's get a closer look.", label: "Face shape", focus: "head", kind: "chips", options: FACE_SHAPES, fallback: "oval" },
  { key: "eyeShape", title: "Eye Shape", sub: "The look in your eyes.", label: "Eye shape", focus: "head", kind: "chips", options: EYE_SHAPES, fallback: "round" },
  { key: "eyeColor", title: "Eye Colour", sub: "Pick a preset or go custom.", label: "Eye colour", focus: "head", kind: "swatch", options: EYE_COLORS, fallback: EYE_COLORS[0]! },
  { key: "eyebrows", title: "Brows", sub: "Every reaction starts here.", label: "Brows", focus: "head", kind: "chips", options: EYEBROWS, fallback: "soft" },
  { key: "noseShape", title: "Nose", sub: "Pick a profile.", label: "Nose", focus: "head", kind: "chips", options: NOSE_SHAPES, fallback: "button" },
  { key: "mouthShape", title: "Mouth", sub: "For all the trash talk.", label: "Mouth", focus: "head", kind: "chips", options: MOUTH_SHAPES, fallback: "neutral" },
  { key: "hairStyle", title: "Hairstyle", sub: "Fresh cut or nothing at all.", label: "Hairstyle", focus: "hairSide", kind: "chips", options: HAIR_STYLES, fallback: "bald" },
  { key: "hairColor", title: "Hair Colour", sub: "Natural or loud.", label: "Hair colour", focus: "hairSide", kind: "swatch", options: HAIR_COLORS, fallback: HAIR_COLORS[0]! },
  { key: "facialHair", title: "Facial Hair", sub: "Last detail.", label: "Facial hair", focus: "head", kind: "chips", options: FACIAL_HAIR, fallback: "none" },
];

/** Camera for the dance between screens: head to toe with room for raised arms. */
const DANCE_FOCUS: Focus = "hero";
/** Settle time after a move before the next screen zooms in. */
const DANCE_TAIL_MS = 350;

type Phase = { kind: "edit"; i: number } | { kind: "dance"; i: number; next: number | "finale" } | { kind: "finale" };

interface Props {
  avatar: AvatarConfig;
  onChange: (next: AvatarConfig) => void;
  catalog: Map<string, CatalogItem>;
  displayName?: string;
  /** Back from the first screen. */
  onExit: () => void;
  onDone: () => void;
  submitting?: boolean;
  error?: string | null;
  cheerSignal?: number;
}

/**
 * Guided character creator: every trait gets its own screen, the camera
 * zooms to the part being edited, and the character performs a move between
 * screens. Each screen needs an explicit pick before it can move on.
 */
export default function CharacterDesigner({ avatar, onChange, catalog, displayName, onExit, onDone, submitting, error, cheerSignal }: Props) {
  const c = useColors();
  const [phase, setPhase] = useState<Phase>({ kind: "edit", i: 0 });
  const [picked, setPicked] = useState<Set<Key>>(() => new Set());
  const [move, setMove] = useState<{ id: string; n: number } | null>(null);
  const moveN = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hair colour has nothing to show on a bald head.
  const steps = useMemo(() => STEPS.filter((s) => !(s.key === "hairColor" && avatar.hairStyle === "bald")), [avatar.hairStyle]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const finishDance = (next: number | "finale") => {
    clearTimer();
    setPhase(next === "finale" ? { kind: "finale" } : { kind: "edit", i: next });
  };

  const advance = (i: number) => {
    const next = i + 1 < steps.length ? i + 1 : "finale";
    // A different move every gap; the library ends on Champion Spin, saved for the finale.
    const m = next === "finale" ? MOVE_LIBRARY[MOVE_LIBRARY.length - 1]! : MOVE_LIBRARY[i % (MOVE_LIBRARY.length - 1)]!;
    buzz.success();
    setMove({ id: m.id, n: ++moveN.current });
    if (next === "finale") {
      setPhase({ kind: "finale" });
      return;
    }
    setPhase({ kind: "dance", i, next });
    clearTimer();
    timer.current = setTimeout(() => finishDance(next), m.seconds * 1000 + DANCE_TAIL_MS);
  };

  const set = (key: Key, value: string | number) => {
    setPicked((p) => (p.has(key) ? p : new Set(p).add(key)));
    onChange({ ...avatar, [key]: value });
  };

  const step = phase.kind === "edit" || phase.kind === "dance" ? steps[Math.min(phase.i, steps.length - 1)]! : null;
  const focus: Focus = phase.kind === "edit" ? step!.focus : DANCE_FOCUS;
  const danceMove = move ? MOVE_LIBRARY.find((m) => m.id === move.id) : undefined;
  const shown = phase.kind === "finale" ? steps.length : phase.kind === "dance" ? phase.i + 1 : phase.i;

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={12}
          disabled={phase.kind === "dance"}
          onPress={() => {
            if (phase.kind === "finale") setPhase({ kind: "edit", i: steps.length - 1 });
            else if (phase.kind === "edit" && phase.i > 0) setPhase({ kind: "edit", i: phase.i - 1 });
            else if (phase.kind === "edit") onExit();
          }}
          style={{ opacity: phase.kind === "dance" ? 0.3 : 1 }}
        >
          <MaterialCommunityIcons name="arrow-left" size={24} color={c.foreground} />
        </Pressable>
        <View style={[s.bar, { backgroundColor: c.border }]}>
          <View style={[s.barFill, { backgroundColor: c.primary, width: `${(shown / steps.length) * 100}%` }]} />
        </View>
        <Text style={[s.count, { color: c.mutedForeground }]}>
          {Math.min(shown + (phase.kind === "edit" ? 1 : 0), steps.length)}/{steps.length}
        </Text>
      </View>

      <Animated.View key={phase.kind === "finale" ? "finale" : step!.key} entering={FadeIn.duration(220)} style={s.titles}>
        <Text style={[s.title, { color: c.foreground }]}>
          {phase.kind === "finale" ? `That's you${displayName ? `, ${displayName}` : ""}.` : step!.title}
        </Text>
        <Text style={[s.sub, { color: c.mutedForeground }]}>
          {phase.kind === "finale" ? "Looking sharp. Go back to change anything." : step!.sub}
        </Text>
      </Animated.View>

      <View style={[s.stage, { backgroundColor: c.secondary, borderColor: c.border }]}>
        <AvatarDisplay
          avatar={avatar}
          equipped={{}}
          catalog={catalog}
          size="lg"
          controls={false}
          focus={focus}
          move={move}
          cheerSignal={cheerSignal}
        />
        {phase.kind === "dance" ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Skip" style={StyleSheet.absoluteFill} onPress={() => {
            setMove({ id: "", n: ++moveN.current });
            finishDance(phase.next);
          }}>
            <Animated.View entering={ZoomIn.springify().damping(12)} exiting={FadeOut.duration(150)} style={[s.badge, { backgroundColor: c.card, borderColor: c.primary }]}>
              <MaterialCommunityIcons name="check-circle" size={16} color={c.primary} />
              <Text style={[s.badgeText, { color: c.foreground }]}>{steps[phase.i]!.title} locked in</Text>
            </Animated.View>
            {danceMove ? (
              <Animated.View entering={FadeInDown.delay(150)} style={[s.moveTag, { backgroundColor: c.primary }]}>
                <MaterialCommunityIcons name={danceMove.icon as never} size={14} color={c.primaryForeground} />
                <Text style={[s.moveText, { color: c.primaryForeground }]}>{danceMove.name}</Text>
              </Animated.View>
            ) : null}
            <Text style={[s.skip, { color: c.mutedForeground }]}>Tap to skip</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={s.panel}>
        {phase.kind === "edit" && step ? (
          <Animated.View key={step.key} entering={FadeInDown.duration(260)} style={s.controls}>
            {step.kind === "swatch" ? (
              <Swatches label={step.label} options={step.options} value={String(avatar[step.key] ?? step.fallback)} onChange={(v) => set(step.key, v)} />
            ) : step.kind === "chips" ? (
              <Chips label={step.label} options={step.options} value={String(avatar[step.key] ?? step.fallback)} onChange={(v) => set(step.key, v)} />
            ) : (
              <Stops label={step.label} value={Number(avatar[step.key] ?? 0.5)} ends={step.ends} onChange={(v) => set(step.key, v)} />
            )}
            <Button
              label={picked.has(step.key) ? (phase.i + 1 < steps.length ? `Next: ${steps[phase.i + 1]!.title}` : "Finish") : "Make a pick"}
              icon={picked.has(step.key) ? "arrow-right" : undefined}
              disabled={!picked.has(step.key)}
              onPress={() => advance(phase.i)}
            />
            <Button
              label="Randomize & finish"
              icon="dice-multiple-outline"
              variant="ghost"
              onPress={() => {
                clearTimer();
                buzz.success();
                onChange({ ...randomAvatar(), ...Object.fromEntries([...picked].map((k) => [k, avatar[k]])) });
                setPhase({ kind: "finale" });
              }}
            />
          </Animated.View>
        ) : null}
        {phase.kind === "finale" ? (
          <Animated.View entering={FadeInDown.duration(260)} style={s.controls}>
            {error ? <Text style={[s.error, { color: c.destructive }]}>{error}</Text> : null}
            <Button label="Create my character" icon="check" loading={submitting} disabled={submitting} onPress={onDone} />
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20, paddingBottom: 16, gap: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  bar: { flex: 1, height: 6, borderRadius: 3, overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3 },
  count: { fontSize: 12, fontFamily: "Inter_700Bold", minWidth: 36, textAlign: "right" },
  titles: { gap: 2 },
  title: { fontSize: 28, fontFamily: "Inter_900Black", letterSpacing: -1 },
  sub: { fontSize: 14, fontFamily: "Inter_400Regular" },
  stage: { flex: 1, minHeight: 260, borderRadius: 20, borderWidth: 1, overflow: "hidden" },
  panel: { minHeight: 170, justifyContent: "flex-end" },
  controls: { gap: 16 },
  badge: { position: "absolute", top: 14, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5 },
  badgeText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  moveTag: { position: "absolute", bottom: 40, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14 },
  moveText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  skip: { position: "absolute", bottom: 14, alignSelf: "center", fontSize: 12, fontFamily: "Inter_500Medium" },
  error: { fontSize: 13, fontFamily: "Inter_500Medium", textAlign: "center" },
});
