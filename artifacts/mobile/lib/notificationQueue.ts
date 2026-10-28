/**
 * Popup queue for bet results. Pure, so it can be tested without React.
 *
 * Several bets often resolve inside the same minute (a Sunday slate). Each one
 * gets its own popup, one at a time, oldest first; nothing already shown or
 * already read is shown again, and a notification that arrives twice — a
 * snapshot replay, a reconnect — is queued once.
 */

export interface QueueItem {
  id: string;
  popup: boolean;
  read: boolean;
  createdAtMs: number;
}

export interface QueueState {
  /** Waiting to be shown, oldest first. queue[0] is on screen. */
  queue: string[];
  /** Shown or dismissed this session. */
  done: string[];
}

export const EMPTY_QUEUE: QueueState = { queue: [], done: [] };

/** Ignore popups older than this on a cold start — the feed still has them. */
export const STALE_POPUP_MS = 6 * 3_600_000;

export function enqueue(state: QueueState, items: QueueItem[], now: number): QueueState {
  const known = new Set([...state.queue, ...state.done]);
  const fresh = items
    .filter((n) => n.popup && !n.read && !known.has(n.id) && now - n.createdAtMs <= STALE_POPUP_MS)
    .sort((a, b) => a.createdAtMs - b.createdAtMs)
    .map((n) => n.id);
  if (!fresh.length) return state;
  return { ...state, queue: [...state.queue, ...new Set(fresh)] };
}

/** Removes ids that were marked read elsewhere (another device, the feed). */
export function prune(state: QueueState, items: QueueItem[]): QueueState {
  const read = new Set(items.filter((n) => n.read).map((n) => n.id));
  const queue = state.queue.filter((id) => !read.has(id));
  return queue.length === state.queue.length ? state : { ...state, queue, done: [...state.done, ...state.queue.filter((id) => read.has(id))] };
}

export function dismiss(state: QueueState, id: string): QueueState {
  if (!state.queue.includes(id)) return state;
  return { queue: state.queue.filter((x) => x !== id), done: [...state.done, id] };
}

export function dismissAll(state: QueueState): QueueState {
  return { queue: [], done: [...state.done, ...state.queue] };
}

export function current(state: QueueState): string | null {
  return state.queue[0] ?? null;
}

/** On opening the app, results this recent that you haven't seen still pop up. */
export const OPEN_WINDOW_MS = 7 * 24 * 3_600_000;
/** This many or more unseen results on open become one "while you were away" recap instead of a popup each. */
export const RECAP_MIN = 3;

/**
 * The first snapshot after the app opens. Results that settled while it was
 * closed (up to a week back, not just the last few hours) are shown: one by
 * one if there are only a couple, or as a single recap if there are more.
 * Recapped ids count as done so they never also pop up individually.
 */
export function coldStart(state: QueueState, items: QueueItem[], now: number, { window = OPEN_WINDOW_MS, recapMin = RECAP_MIN } = {}): { state: QueueState; recap: string[] } {
  const known = new Set([...state.queue, ...state.done]);
  const unseen = items
    .filter((n) => n.popup && !n.read && !known.has(n.id) && now - n.createdAtMs <= window)
    .sort((a, b) => a.createdAtMs - b.createdAtMs);
  const ids = [...new Set(unseen.map((n) => n.id))];
  if (ids.length >= recapMin) return { state: { ...state, done: [...state.done, ...ids] }, recap: ids };
  return { state: ids.length ? { ...state, queue: [...state.queue, ...ids] } : state, recap: [] };
}
