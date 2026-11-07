import { MongoClient, type Db } from "mongodb";

export type VoiceCall = { id: string; from: "receiver" | "controller"; offer: { type: "offer"; sdp: string }; answer: { type: "answer"; sdp: string } | null; ended: boolean; createdAt: number };
export type Session = { voice?: VoiceCall; code: string; receiver: string; controller: string | null; expires: number; expiresAt: Date; closed: boolean; version: number; sequence: number[]; hostCode: string; profileId: string; username: string; pending: boolean };
export type Profile = { id: string; token: string; username: string };
export type Host = { code: string; receiver: string; profileId: string; username: string; mode: "single" | "multiple"; requireApproval: boolean; enableCall: boolean; heartbeat: number; expires: number; expiresAt: Date; closed: boolean; version: number; sequence: number[]; peers: { code: string; profileId: string; username: string; status: "pending" | "connected"; seenAt: number }[] };
export type Pattern = { id: string; name: string; author: string; sequence: number[]; createdAt: string };
type Limit = { _id: string; count: number; expiresAt: Date };

const globalStore = globalThis as typeof globalThis & { pulseDatabase?: Promise<Db> };

export async function store() {
  if (!globalStore.pulseDatabase) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("Database is not configured.");
    const client = new MongoClient(uri, { maxPoolSize: 10, serverSelectionTimeoutMS: 10000 });
    globalStore.pulseDatabase = (async () => {
      try {
        await client.connect();
        const db = client.db(process.env.MONGODB_DB || "pulse");
        await Promise.all([
          db.collection<Session>("sessions").createIndex({ code: 1 }, { unique: true }),
          db.collection<Profile>("profiles").createIndex({ id: 1 }, { unique: true }),
          db.collection<Profile>("profiles").createIndex({ username: 1 }, { unique: true }),
          db.collection<Host>("hosts").createIndex({ code: 1 }, { unique: true }),
          db.collection<Host>("hosts").createIndex({ profileId: 1 }, { unique: true }),
          db.collection<Host>("hosts").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 3600 }),
          db.collection<Session>("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 3600 }),
          db.collection<Pattern>("patterns").createIndex({ id: 1 }, { unique: true }),
          db.collection<Pattern>("patterns").createIndex({ createdAt: -1 }),
          db.collection<Limit>("limits").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        ]);
        return db;
      } catch {
        globalStore.pulseDatabase = undefined;
        await client.close();
        throw new Error("Database is temporarily unavailable.");
      }
    })();
  }
  return globalStore.pulseDatabase;
}

export function validSequence(value: unknown, allowStop = false): value is number[] {
  return Array.isArray(value) && ((allowStop && value.length === 0) ||
    (value.length > 0 && value.length <= 99 && value.length % 2 === 1 &&
      value.every(item => Number.isInteger(item) && item >= 1 && item <= 3000) &&
      value.reduce((total, item) => total + item, 0) <= 120000));
}

export async function limited(request: Request, action: string, maximum: number, period = 60000) {
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const window = Math.floor(Date.now() / period);
  const db = await store();
  const row = await db.collection<Limit>("limits").findOneAndUpdate(
    { _id: `${action}:${address}:${window}` },
    { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((window + 1) * period) } },
    { upsert: true, returnDocument: "after" },
  );
  return row!.count > maximum;
}

export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

export function error(message: string, status = 400) {
  return json({ error: message }, status);
}
