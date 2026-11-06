/**
 * In-memory stand-in for the slice of the Admin Firestore API the functions
 * use. It exists because the Firestore emulator jar can't be downloaded in
 * every environment; it is not a general-purpose mock.
 *
 * What it models faithfully enough to test money movement:
 *  - transactions are optimistic and serializable: every read records the
 *    document version, writes are buffered, commit fails and the body re-runs
 *    if anything read was changed by another commit in the meantime
 *  - Firestore's "all reads before any writes" transaction rule is enforced
 *  - update() on a missing document fails, like NOT_FOUND
 *  - FieldValue sentinels: serverTimestamp, increment, arrayUnion,
 *    arrayRemove, delete, and dotted field paths in update()
 */

type Data = Record<string, unknown>;

class Sentinel {
  constructor(public kind: "serverTimestamp" | "increment" | "arrayUnion" | "arrayRemove" | "delete", public arg?: unknown) {}
}

export const FieldValue = {
  serverTimestamp: () => new Sentinel("serverTimestamp"),
  increment: (n: number) => new Sentinel("increment", n),
  arrayUnion: (...v: unknown[]) => new Sentinel("arrayUnion", v),
  arrayRemove: (...v: unknown[]) => new Sentinel("arrayRemove", v),
  delete: () => new Sentinel("delete"),
};

export class Timestamp {
  constructor(public seconds: number, public nanoseconds: number) {}
  static now() {
    const ms = Date.now();
    return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6);
  }
  toMillis() {
    return this.seconds * 1000 + this.nanoseconds / 1e6;
  }
}

const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));

function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Data)[part];
  }
  return cur;
}

function resolveSentinel(current: unknown, v: unknown): unknown {
  if (!(v instanceof Sentinel)) {
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Timestamp)) {
      const out: Data = {};
      for (const [k, x] of Object.entries(v as Data)) {
        const r = resolveSentinel(undefined, x);
        if (!(x instanceof Sentinel && x.kind === "delete")) out[k] = r;
      }
      return out;
    }
    return clone(v);
  }
  switch (v.kind) {
    case "serverTimestamp":
      return Timestamp.now();
    case "increment":
      return (typeof current === "number" ? current : 0) + (v.arg as number);
    case "arrayUnion": {
      const arr = Array.isArray(current) ? [...current] : [];
      for (const x of v.arg as unknown[]) if (!arr.some((y) => JSON.stringify(y) === JSON.stringify(x))) arr.push(x);
      return arr;
    }
    case "arrayRemove": {
      const arr = Array.isArray(current) ? current : [];
      return arr.filter((y) => !(v.arg as unknown[]).some((x) => JSON.stringify(x) === JSON.stringify(y)));
    }
    default:
      return undefined;
  }
}

function setPath(obj: Data, path: string, value: unknown) {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    if (cur[p] === null || typeof cur[p] !== "object") cur[p] = {};
    cur = cur[p] as Data;
  }
  const last = parts[parts.length - 1]!;
  if (value instanceof Sentinel && value.kind === "delete") {
    delete cur[last];
    return;
  }
  cur[last] = resolveSentinel(cur[last], value);
}

interface Stored {
  data: Data;
  version: number;
}

export class FakeDb {
  docs = new Map<string, Stored>();
  private clock = 0;
  commits = 0;
  retries = 0;

  collection(path: string) {
    return new CollectionRef(this, path);
  }
  doc(path: string) {
    return new DocRef(this, path);
  }
  collectionGroup(id: string) {
    return new Query(this, { group: id });
  }
  /** Minimal WriteBatch: queued ops applied in order on commit. */
  batch() {
    const ops: Array<() => Promise<unknown>> = [];
    const b = {
      set: (ref: DocRef, data: Data, opts?: { merge?: boolean }) => (ops.push(() => ref.set(data, opts)), b),
      update: (ref: DocRef, data: Data) => (ops.push(() => ref.update(data)), b),
      delete: (ref: DocRef) => (ops.push(() => ref.delete()), b),
      commit: async () => {
        for (const op of ops) await op();
      },
    };
    return b;
  }
  async runTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 25; attempt++) {
      const tx = new Transaction(this);
      const result = await fn(tx);
      // Yield once so concurrent transactions genuinely interleave.
      await new Promise((r) => setImmediate(r));
      if (tx.commit()) return result;
      this.retries++;
    }
    throw new Error("ABORTED: too much contention");
  }
  async getAll(...refs: DocRef[]) {
    return refs.map((r) => this.snapshot(r.path));
  }

  /** Test helpers */
  seed(path: string, data: Data) {
    this.docs.set(path, { data: clone(data), version: ++this.clock });
  }
  read(path: string): Data | undefined {
    return clone(this.docs.get(path)?.data);
  }
  list(prefix: string): Array<{ path: string; data: Data }> {
    return [...this.docs.entries()]
      .filter(([p]) => p.startsWith(prefix) && p.slice(prefix.length).split("/").length === 1)
      .map(([path, s]) => ({ path, data: clone(s.data) }));
  }
  reset() {
    this.docs.clear();
  }

  // internals
  version(path: string) {
    return this.docs.get(path)?.version ?? 0;
  }
  snapshot(path: string) {
    const s = this.docs.get(path);
    return new DocSnap(this, path, s ? clone(s.data) : undefined);
  }
  apply(path: string, op: Write) {
    const existing = this.docs.get(path);
    if (op.type === "delete") {
      this.docs.delete(path);
      return;
    }
    if (op.type === "set") {
      const base: Data = op.merge && existing ? clone(existing.data) : {};
      for (const [k, v] of Object.entries(op.data)) setPath(base, k, v);
      this.docs.set(path, { data: base, version: ++this.clock });
      return;
    }
    if (op.type === "create" && existing) throw new Error(`ALREADY_EXISTS: ${path}`);
    if (op.type === "update" && !existing) throw new Error(`NOT_FOUND: ${path}`);
    const base: Data = existing ? clone(existing.data) : {};
    for (const [k, v] of Object.entries(op.data)) setPath(base, k, v);
    this.docs.set(path, { data: base, version: ++this.clock });
  }
}

type Write =
  | { type: "set"; data: Data; merge?: boolean }
  | { type: "update"; data: Data }
  | { type: "create"; data: Data }
  | { type: "delete" };

export class DocRef {
  constructor(public _db: FakeDb, public path: string) {}
  get id() {
    return this.path.split("/").pop()!;
  }
  collection(id: string) {
    return new CollectionRef(this._db, `${this.path}/${id}`);
  }
  async get() {
    return this._db.snapshot(this.path);
  }
  async set(data: Data, opts?: { merge?: boolean }) {
    this._db.apply(this.path, { type: "set", data, merge: opts?.merge });
    this._db.commits++;
  }
  async update(data: Data) {
    this._db.apply(this.path, { type: "update", data });
    this._db.commits++;
  }
  async create(data: Data) {
    this._db.apply(this.path, { type: "create", data });
  }
  async delete() {
    this._db.apply(this.path, { type: "delete" });
  }
}

let autoId = 0;

type Filter = { field: string; op: string; value: unknown };

export class Query {
  constructor(
    public _db: FakeDb,
    public spec: { collection?: string; group?: string; filters?: Filter[]; order?: Array<[string, "asc" | "desc"]>; max?: number }
  ) {}
  where(field: string, op: string, value: unknown) {
    return new Query(this._db, { ...this.spec, filters: [...(this.spec.filters ?? []), { field, op, value }] });
  }
  orderBy(field: string, dir: "asc" | "desc" = "asc") {
    return new Query(this._db, { ...this.spec, order: [...(this.spec.order ?? []), [field, dir]] });
  }
  limit(n: number) {
    return new Query(this._db, { ...this.spec, max: n });
  }
  matches(): Array<{ path: string; version: number }> {
    const out: Array<{ path: string; data: Data; version: number }> = [];
    for (const [path, s] of this._db.docs) {
      const parts = path.split("/");
      const parent = parts.slice(0, -1).join("/");
      if (this.spec.collection !== undefined && parent !== this.spec.collection) continue;
      if (this.spec.group !== undefined && parts[parts.length - 2] !== this.spec.group) continue;
      const ok = (this.spec.filters ?? []).every((f) => {
        const v = getPath(s.data, f.field);
        switch (f.op) {
          case "==": return JSON.stringify(v) === JSON.stringify(f.value);
          case "!=": return v !== undefined && JSON.stringify(v) !== JSON.stringify(f.value);
          case "in": return (f.value as unknown[]).some((x) => JSON.stringify(x) === JSON.stringify(v));
          case "array-contains": return Array.isArray(v) && v.some((x) => JSON.stringify(x) === JSON.stringify(f.value));
          case "<": return (v as number) < (f.value as number);
          case "<=": return (v as number) <= (f.value as number);
          case ">": return (v as number) > (f.value as number);
          case ">=": return (v as number) >= (f.value as number);
          default: throw new Error(`unsupported op ${f.op}`);
        }
      });
      if (ok) out.push({ path, data: s.data, version: s.version });
    }
    for (const [field, dir] of [...(this.spec.order ?? [])].reverse()) {
      out.sort((a, b) => {
        const x = getPath(a.data, field) as number, y = getPath(b.data, field) as number;
        return (x < y ? -1 : x > y ? 1 : 0) * (dir === "desc" ? -1 : 1);
      });
    }
    return out.slice(0, this.spec.max ?? Infinity);
  }
  async get() {
    return this.snapshotFor(this.matches());
  }
  snapshotFor(rows: Array<{ path: string }>) {
    const docs = rows.map((r) => this._db.snapshot(r.path));
    return { docs, empty: docs.length === 0, size: docs.length };
  }
}

export class CollectionRef extends Query {
  constructor(db: FakeDb, public path: string) {
    super(db, { collection: path });
  }
  doc(id?: string) {
    return new DocRef(this._db, `${this.path}/${id ?? `auto${++autoId}`}`);
  }
  async add(data: Data) {
    const ref = this.doc();
    await ref.set(data);
    return ref;
  }
}

export class DocSnap {
  constructor(private _db: FakeDb, private path: string, private _data: Data | undefined) {}
  get exists() {
    return this._data !== undefined;
  }
  get id() {
    return this.path.split("/").pop()!;
  }
  get ref() {
    return new DocRef(this._db, this.path);
  }
  data() {
    return clone(this._data);
  }
  get(field: string) {
    return clone(getPath(this._data, field));
  }
}

export class Transaction {
  private reads = new Map<string, number>();
  private queryReads: Array<{ q: Query; paths: string; versions: string }> = [];
  private writes: Array<{ path: string; op: Write }> = [];
  constructor(private db: FakeDb) {}

  async get(target: DocRef | Query) {
    if (this.writes.length) throw new Error("Firestore transactions require all reads to be executed before all writes.");
    if (target instanceof DocRef) {
      this.reads.set(target.path, this.db.version(target.path));
      return this.db.snapshot(target.path);
    }
    const rows = target.matches();
    this.queryReads.push({
      q: target,
      paths: rows.map((r) => r.path).join("|"),
      versions: rows.map((r) => r.version).join("|"),
    });
    for (const r of rows) this.reads.set(r.path, r.version);
    return target.snapshotFor(rows);
  }
  async getAll(...refs: DocRef[]) {
    return Promise.all(refs.map((r) => this.get(r) as Promise<DocSnap>));
  }
  set(ref: DocRef, data: Data, opts?: { merge?: boolean }) {
    this.writes.push({ path: ref.path, op: { type: "set", data, merge: opts?.merge } });
    return this;
  }
  update(ref: DocRef, data: Data) {
    this.writes.push({ path: ref.path, op: { type: "update", data } });
    return this;
  }
  create(ref: DocRef, data: Data) {
    this.writes.push({ path: ref.path, op: { type: "create", data } });
    return this;
  }
  delete(ref: DocRef) {
    this.writes.push({ path: ref.path, op: { type: "delete" } });
    return this;
  }
  /** Returns false on conflict, so the body is retried. */
  commit(): boolean {
    for (const [path, v] of this.reads) if (this.db.version(path) !== v) return false;
    for (const r of this.queryReads) {
      const now = r.q.matches();
      if (now.map((x) => x.path).join("|") !== r.paths) return false;
    }
    // Validate first so a failing write leaves nothing half-applied.
    const shadow = new Map<string, boolean>();
    for (const w of this.writes) {
      const exists = shadow.has(w.path) ? shadow.get(w.path)! : this.db.docs.has(w.path);
      if (w.op.type === "update" && !exists) throw new Error(`NOT_FOUND: no document to update: ${w.path}`);
      if (w.op.type === "create" && exists) throw new Error(`ALREADY_EXISTS: ${w.path}`);
      shadow.set(w.path, w.op.type !== "delete");
    }
    for (const w of this.writes) this.db.apply(w.path, w.op);
    this.db.commits++;
    return true;
  }
}

export function createFakeFirestore() {
  const db = new FakeDb();
  return { db, FieldValue, Timestamp };
}
