import { randomUUID } from "node:crypto";
import { error, json, limited, store, validSequence, type Pattern } from "../../../lib/store";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await (await store()).collection<Pattern>("patterns").find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(100).toArray();
    return json(rows);
  } catch {
    return error("The shared collection is temporarily unavailable. Please try again.", 503);
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return error("Invalid JSON."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return error("Invalid request.");
  if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 60) return error("Give your vibration a name of 1–60 characters.");
  if (typeof body.author !== "string" || !body.author.trim() || body.author.trim().length > 40) return error("Use a display name of 1–40 characters.");
  if (!validSequence(body.sequence)) return error("Use an odd number of up to 99 timings, each 1–3000 ms, totaling at most 120 seconds.");
  try {
    if (await limited(request, "publish", 10, 3600000)) return error("Publishing limit reached. Try again in an hour.", 429);
    const pattern: Pattern = { id: randomUUID(), name: body.name.trim(), author: body.author.trim(), sequence: body.sequence, createdAt: new Date().toISOString() };
    await (await store()).collection<Pattern>("patterns").insertOne({ ...pattern });
    return json(pattern, 201);
  } catch {
    return error("Your pattern could not be saved. Please try again.", 503);
  }
}
