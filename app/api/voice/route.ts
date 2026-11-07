import { error, json, limited, store, type Session, type VoiceCall, type Host } from "../../../lib/store";

export const runtime = "nodejs";

function iceConfiguration() {
  const servers: unknown = process.env.RTC_ICE_SERVERS ? JSON.parse(process.env.RTC_ICE_SERVERS) : [{ urls: "stun:stun.l.google.com:19302" }];
  if (!Array.isArray(servers) || !servers.length || servers.length > 8) throw new Error("Invalid ICE configuration.");
  let relayConfigured = false;
  const iceServers = servers.map(server => {
    if (!server || typeof server !== "object") throw new Error("Invalid ICE server.");
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    if (!urls.length || urls.length > 8 || !urls.every((url: unknown) => typeof url === "string" && url.length <= 512 && /^(stun|stuns|turn|turns):[^\s]+$/.test(url))) throw new Error("Invalid ICE URLs.");
    const relay = urls.some((url: string) => /^turns?:/.test(url));
    if (relay && (typeof server.username !== "string" || !server.username || server.username.length > 512 || typeof server.credential !== "string" || !server.credential || server.credential.length > 1024)) throw new Error("Invalid TURN credentials.");
    relayConfigured ||= relay;
    return { urls, ...(relay ? { username: server.username, credential: server.credential } : {}) };
  });
  return { iceServers, relayConfigured };
}

async function authenticate(code: unknown, token: unknown) {
  if (typeof code !== "string" || !/^[A-F0-9]{8}$/.test(code) || typeof token !== "string") return null;
  const row = await (await store()).collection<Session>("sessions").findOne({ code });
  if (!row || !row.controller || row.pending || row.closed || row.expires <= Date.now()) return null;
  const host = await (await store()).collection<Host>("hosts").findOne({ code: row.hostCode, receiver: row.receiver, closed: false, expires: { $gt: Date.now() }, peers: { $elemMatch: { code: row.code, status: "connected" } } });
  if (!host || !host.enableCall) return null;
  const role: VoiceCall["from"] | null = token === row.receiver ? "receiver" : token === row.controller ? "controller" : null;
  return role ? { row, role } : null;
}

function publicCall(call?: VoiceCall) {
  if (!call) return null;
  return {
    id: call.id,
    from: call.from,
    offer: call.offer,
    answer: call.answer,
    ended: call.ended || (!call.answer && call.createdAt <= Date.now() - 90000),
  };
}

function validDescription(value: unknown, type: "offer" | "answer"): value is { type: typeof type; sdp: string } {
  if (!value || typeof value !== "object") return false;
  const description = value as Record<string, unknown>;
  return description.type === type && typeof description.sdp === "string" && description.sdp.length <= 32768 && description.sdp.startsWith("v=0") && /^m=audio /m.test(description.sdp) && !/^m=(?!audio )/m.test(description.sdp);
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const peer = await authenticate(params.get("code"), params.get("token"));
    if (!peer) return error("Pair a device before starting voice chat.", 403);
    return json({ call: publicCall(peer.row.voice), ...iceConfiguration() });
  } catch {
    return error("Voice chat is temporarily unavailable. Please try again.", 503);
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > 40000) return error("Voice description is too large.");
    body = JSON.parse(text);
  } catch { return error("Invalid JSON."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return error("Invalid request.");
  if (!["offer", "answer", "end", "restart"].includes(String(body.action))) return error("Unknown voice action.");
  if (typeof body.id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.id)) return error("Invalid call ID.");
  if ((body.action === "offer" || body.action === "answer") && !validDescription(body.description, body.action)) return error("Use a valid audio-only voice description.");
  try {
    const peer = await authenticate(body.code, body.token);
    if (!peer) return error("Pair a device before starting voice chat.", 403);
    const sessions = (await store()).collection<Session>("sessions");
    const activeSession = { code: peer.row.code, receiver: peer.row.receiver, controller: peer.row.controller, closed: false, expires: { $gt: Date.now() } };
    if (body.action === "restart") {
      if (await limited(request, `voice-restart:${peer.row.code}:${peer.role}`, 10)) return error("Too many reconnection attempts. Try again in a minute.", 429);
      const updated = await sessions.updateOne(
        { ...activeSession, "voice.id": body.id },
        { $set: { "voice.ended": true } },
      );
      return json({ restarted: updated.matchedCount > 0 });
    }
    if (body.action === "offer") {
      if (await limited(request, `voice-offer:${peer.row.code}:${peer.role}`, 10)) return error("Too many calls. Try again in a minute.", 429);
      const call: VoiceCall = { id: body.id, from: peer.role, offer: body.description as VoiceCall["offer"], answer: null, ended: false, createdAt: Date.now() };
      const updated = await sessions.updateOne(
        { ...activeSession, $or: [{ voice: { $exists: false } }, { "voice.ended": true }, { "voice.answer": null, "voice.createdAt": { $lte: Date.now() - 90000 } }] },
        { $set: { voice: call } },
      );
      if (!updated.modifiedCount) return error("A voice call is already active or the session ended.", 409);
      return json({ call: publicCall(call) }, 201);
    }
    if (body.action === "answer") {
      const description = body.description as NonNullable<VoiceCall["answer"]>;
      const updated = await sessions.findOneAndUpdate(
        { ...activeSession, "voice.id": body.id, "voice.from": { $ne: peer.role }, "voice.ended": false, "voice.answer": null, "voice.createdAt": { $gt: Date.now() - 90000 } },
        { $set: { "voice.answer": description } },
        { returnDocument: "after" },
      );
      if (!updated) return error("This call cannot be answered or has ended.", 409);
      return json({ call: publicCall(updated.voice) });
    }
    const updated = await sessions.findOneAndUpdate(
      { ...activeSession, "voice.id": body.id },
      { $set: { "voice.ended": true, closed: true, sequence: [] }, $inc: { version: 1 } },
      { returnDocument: "after" },
    );
    if (!updated) return error("This call no longer exists.", 409);
    await (await store()).collection<Host>("hosts").updateOne({ code: peer.row.hostCode, receiver: peer.row.receiver, "peers.code": peer.row.code }, { $pull: { peers: { code: peer.row.code } }, $set: { sequence: [] }, $inc: { version: 1 } });
    return json({ call: publicCall(updated.voice) });
  } catch {
    return error("Voice chat is temporarily unavailable. Please try again.", 503);
  }
}
