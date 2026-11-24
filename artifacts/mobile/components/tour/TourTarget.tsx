import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { Platform, View, type NativeScrollEvent, type NativeSyntheticEvent, type StyleProp, type ViewStyle } from "react-native";
import { registerScrollTop, registerTarget, tourPressed } from "@/lib/tour/store";

type MeasureCb = (x: number, y: number, w: number, h: number) => void;
type ScrollCtx = { scrollBy: (dy: number) => void; measureList: (cb: MeasureCb) => void };
const TourScrollContext = createContext<ScrollCtx | undefined>(undefined);

type Scrollable = {
  scrollTo?: (o: { y: number; animated?: boolean }) => void;
  scrollToOffset?: (o: { offset: number; animated?: boolean }) => void;
  measureInWindow?: (cb: MeasureCb) => void;
};

/**
 * Lets tour targets inside a ScrollView / FlatList bring themselves on screen.
 * Spread `onScroll` onto the list and wrap its content in `Provider`.
 */
export function useTourScroll(ref: React.RefObject<Scrollable | null>, onScrollExtra?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void) {
  const y = useRef(0);
  const extra = useRef(onScrollExtra);
  extra.current = onScrollExtra;
  const scrollBy = useCallback(
    (dy: number) => {
      const to = Math.max(0, y.current + dy);
      const list = ref.current;
      if (list?.scrollToOffset) list.scrollToOffset({ offset: to, animated: true });
      else list?.scrollTo?.({ y: to, animated: true });
    },
    [ref]
  );
  // Ending a tour returns the screen to its top.
  useEffect(
    () =>
      registerScrollTop(() => {
        const list = ref.current;
        if (list?.scrollToOffset) list.scrollToOffset({ offset: 0, animated: true });
        else list?.scrollTo?.({ y: 0, animated: true });
      }),
    [ref]
  );
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    y.current = e.nativeEvent.contentOffset.y;
    extra.current?.(e);
  }, []);
  const measureList = useCallback(
    (cb: MeasureCb) => {
      const list = ref.current;
      if (typeof list?.measureInWindow === "function") list.measureInWindow(cb);
      else cb(0, 0, 0, 0);
    },
    [ref]
  );
  const ctx = useMemo(() => ({ scrollBy, measureList }), [scrollBy, measureList]);
  const Provider = useMemo(
    () =>
      function TourScrollProvider({ children }: { children: React.ReactNode }) {
        return <TourScrollContext.Provider value={ctx}>{children}</TourScrollContext.Provider>;
      },
    [ctx]
  );
  return { onScroll, scrollEventThrottle: 32, Provider };
}

/**
 * Marks something the tutorials can point at. Layout-neutral apart from
 * `style`; a press anywhere inside counts as pressing it.
 */
export function TourTarget({ id, children, style }: { id: string; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const ref = useRef<React.ComponentRef<typeof View>>(null);
  const scroll = useContext(TourScrollContext);
  useEffect(() => registerTarget(id, { ref, scrollBy: scroll?.scrollBy, measureList: scroll?.measureList }), [id, scroll]);

  // A tap, not a scroll that happened to start here.
  const start = useRef<{ x: number; y: number } | null>(null);
  const press =
    Platform.OS === "web"
      ? { onClick: () => tourPressed(id) }
      : {
          onTouchStart: (e: { nativeEvent: { pageX: number; pageY: number } }) => {
            start.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
          },
          onTouchEnd: (e: { nativeEvent: { pageX: number; pageY: number } }) => {
            const s = start.current;
            start.current = null;
            if (s && Math.hypot(e.nativeEvent.pageX - s.x, e.nativeEvent.pageY - s.y) < 12) tourPressed(id);
          },
        };

  return (
    <View ref={ref} collapsable={false} style={style} {...(press as object)}>
      {children}
    </View>
  );
}
