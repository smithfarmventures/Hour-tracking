// Persists the whole app state as one JSON document. On Vercel it lives in a
// private Vercel Blob store; locally (no Blob credentials) in .data/state.json.
// Writes are conditional on the etag that was read, so two people saving at
// the same moment can't silently overwrite each other.

import { BlobNotFoundError, BlobPreconditionFailedError, get, head, put } from "@vercel/blob";
import { promises as fs } from "node:fs";
import path from "node:path";
import { type State, initialState } from "./model";

const KEY = "state.json";
const useBlob = Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
const localFile = path.join(process.cwd(), ".data", KEY);

type Loaded = { state: State; etag: string | null };

export class ConflictError extends Error {
  constructor() {
    super("Someone else saved at the same moment");
  }
}

/** Deployed without a Blob store connected: there is nowhere to save. */
export class StorageMissingError extends Error {
  constructor() {
    super("Storage isn't connected yet. In Vercel, open this project's Storage tab, create a Blob store, connect it, then redeploy.");
  }
}

export async function loadState(): Promise<Loaded> {
  if (!useBlob && process.env.VERCEL) throw new StorageMissingError();
  if (!useBlob) {
    try {
      const text = await fs.readFile(localFile, "utf8");
      return { state: JSON.parse(text), etag: text.length.toString() + ":" + hash(text) };
    } catch {
      return { state: initialState(), etag: null };
    }
  }
  // Take the etag from the Blob API (the form put's ifMatch compares against),
  // not from the download response, whose etag header differs. Reading it
  // before the content means a write in between makes our save fail and retry,
  // never overwrite.
  const meta = await head(KEY).catch((e) => {
    if (e instanceof BlobNotFoundError) return null;
    throw e;
  });
  if (!meta) return { state: initialState(), etag: null };
  const res = await get(KEY, { access: "private", useCache: false });
  if (!res || res.statusCode !== 200 || !res.stream) throw new Error(`Couldn't read ${KEY}`);
  const text = await new Response(res.stream).text();
  return { state: JSON.parse(text), etag: meta.etag };
}

async function saveState(state: State, etag: string | null): Promise<void> {
  const body = JSON.stringify(state);
  if (!useBlob) {
    const current = await loadState();
    if (current.etag !== etag) throw new ConflictError();
    await fs.mkdir(path.dirname(localFile), { recursive: true });
    await fs.writeFile(localFile, body);
    return;
  }
  try {
    await put(KEY, body, {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      // First write must create; later writes must match what we read.
      allowOverwrite: etag !== null,
      ...(etag ? { ifMatch: etag } : {}),
    });
  } catch (e) {
    if (e instanceof BlobPreconditionFailedError || (etag === null && /already exists/i.test(String(e)))) {
      throw new ConflictError();
    }
    throw e;
  }
}

/**
 * Read-modify-write with retry: `fn` is re-run against fresh state if someone
 * else saved in between.
 */
export async function updateState(fn: (state: State) => State): Promise<State> {
  for (let attempt = 0; ; attempt++) {
    const { state, etag } = await loadState();
    const next = fn(state);
    try {
      await saveState(next, etag);
      return next;
    } catch (e) {
      if (e instanceof ConflictError && attempt < 3) continue;
      throw e;
    }
  }
}

/** Writes a write-once copy of a fully signed week, as a backup of the agreed record. */
export async function archiveSignedWeek(state: State, week: string): Promise<void> {
  const body = JSON.stringify({ settings: state.settings, week: state.weeks[week] }, null, 2);
  const key = `signed/week-${week}.json`;
  if (!useBlob) {
    await fs.mkdir(path.dirname(path.join(process.cwd(), ".data", key)), { recursive: true });
    await fs.writeFile(path.join(process.cwd(), ".data", key), body);
    return;
  }
  await put(key, body, { access: "private", contentType: "application/json", addRandomSuffix: true });
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}
