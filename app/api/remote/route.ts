import { randomBytes } from "node:crypto";
import { MongoServerError } from "mongodb";
import { error, json, limited, store, validSequence, type Session, type Profile, type Host } from "../../../lib/store";

export const runtime = "nodejs";
const code = () => randomBytes(4).toString("hex").toUpperCase();
const secret = () => randomBytes(32).toString("hex");
const active = () => ({ closed: false, expires: { $gt: Date.now() } });

async function profile(body: Record<string, unknown>) {
  if (typeof body.profileId !== "string" || typeof body.profileToken !== "string") return null;
  return (await store()).collection<Profile>("profiles").findOne({ id: body.profileId, token: body.profileToken });
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const db = await store();
    const hosts = db.collection<Host>("hosts");
    if (params.get("directory") === "1") {
      const rows = await hosts.find({ ...active(), heartbeat: { $gt: Date.now() - 90000 } }).sort({ username: 1 }).limit(100).toArray();
      return json({ users: rows.map(row => ({ code: row.code, username: row.username, mode: row.mode, requireApproval: row.requireApproval, enableCall: row.enableCall, count: row.peers.filter(peer => peer.seenAt > Date.now() - 90000).length })) });
    }
    const sessionCode = params.get("code");
    const token = params.get("token");
    if (!sessionCode || !/^[A-F0-9]{8}$/.test(sessionCode) || !token) return error("Invalid connection credentials.", 403);
    const after = Number(params.get("after") ?? -1);
    if (!Number.isSafeInteger(after) || after < -1) return error("Invalid command version.");
    const host = await hosts.findOneAndUpdate({ code: sessionCode, receiver: token }, { $set: { heartbeat: Date.now() }, $pull: { peers: { seenAt: { $lte: Date.now() - 90000 } } } }, { returnDocument: "after" });
    if (host) {
      const closed = host.closed || host.expires <= Date.now();
      return json({ version: host.version, sequence: closed ? [] : host.version > after ? host.sequence : null, enableCall: host.enableCall, connected: !closed && host.peers.some(peer => peer.status === "connected"), closed, peers: closed ? [] : host.peers.map(({ code, username, status }) => ({ code, username, status })) });
    }
    const row = await db.collection<Session>("sessions").findOne({ code: sessionCode, controller: token });
    if (!row) return error("Connection not found or access denied.", 403);
    const owner = await hosts.findOneAndUpdate({ code: row.hostCode, receiver: row.receiver, ...active(), "peers.code": row.code }, { $set: { "peers.$.seenAt": Date.now() } }, { returnDocument: "after" });
    const peer = owner?.peers.find(peer => peer.code === row.code);
    const closed = row.closed || row.expires <= Date.now() || !peer;
    const pending = peer?.status === "pending";
    return json({ version: row.version, sequence: closed ? [] : null, connected: !closed && !pending, closed, pending, enableCall: owner?.enableCall ?? false });
  } catch {
    return error("Remote control is temporarily unavailable. Please try again.", 503);
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return error("Invalid JSON."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return error("Invalid request.");
  if (!["profile", "create", "join", "approve", "reject", "send", "close"].includes(String(body.action))) return error("Unknown action.");
  try {
    const db = await store();
    const hosts = db.collection<Host>("hosts");
    const sessions = db.collection<Session>("sessions");
    if (body.action === "profile") {
      if (await limited(request, "profile", 30)) return error("Too many requests. Try again in a minute.", 429);
      const profiles = db.collection<Profile>("profiles");
      let existing: Profile | null = await profile(body);
      if ((body.profileId !== undefined || body.profileToken !== undefined) && !existing) return error("Profile not found or access denied.", 403);
      if (body.username !== undefined && (typeof body.username !== "string" || !/^[a-zA-Z0-9_-]{3,24}$/.test(body.username))) return error("Use 3–24 letters, numbers, underscores or hyphens for your username.");
      const username = typeof body.username === "string" ? body.username.toLowerCase() : existing?.username || `pulse_${randomBytes(5).toString("hex")}`;
      try {
        if (existing) {
          await profiles.updateOne({ id: existing.id, token: existing.token }, { $set: { username } });
          await hosts.updateOne({ profileId: existing.id }, { $set: { username } });
          existing.username = username;
        } else {
          existing = { id: randomBytes(16).toString("hex"), token: secret(), username };
          await profiles.insertOne(existing);
        }
      } catch (cause) {
        if (cause instanceof MongoServerError && cause.code === 11000) return error("That username is taken. Try another.", 409);
        throw cause;
      }
      return json({ profileId: existing.id, profileToken: existing.token, username: existing.username });
    }
    if (body.action === "create" || body.action === "join") {
      if (await limited(request, String(body.action), 20)) return error("Too many connection attempts. Try again in a minute.", 429);
      const user = await profile(body);
      if (!user) return error("Set your username before connecting.", 403);
      if (body.action === "create") {
        if (!["single", "multiple"].includes(String(body.mode)) || typeof body.requireApproval !== "boolean" || typeof body.enableCall !== "boolean") return error("Choose single or multiple control and an approval setting.");
        const previous = await hosts.findOne({ profileId: user.id });
        if (previous) await sessions.updateMany({ hostCode: previous.code }, { $set: { closed: true } });
        const host: Host = { code: code(), receiver: secret(), profileId: user.id, username: user.username, mode: body.mode as Host["mode"], requireApproval: body.requireApproval, enableCall: body.enableCall, heartbeat: Date.now(), expires: Date.now() + 1800000, expiresAt: new Date(Date.now() + 1800000), closed: false, version: 0, sequence: [], peers: [] };
        await hosts.replaceOne({ profileId: user.id }, host, { upsert: true });
        return json({ code: host.code, token: host.receiver }, 201);
      }
      if (typeof body.code !== "string" || !/^[A-F0-9]{8}$/.test(body.code)) return error("Invalid user connection.");
      const host = await hosts.findOne({ code: body.code, ...active(), heartbeat: { $gt: Date.now() - 90000 } });
      if (!host) return error("This user is no longer available.", 410);
      if (host.profileId === user.id) return error("You cannot connect to yourself.");
      await hosts.updateOne({ code: host.code, receiver: host.receiver }, { $pull: { peers: { seenAt: { $lte: Date.now() - 90000 } } } });
      const peerCode = code();
      const peer: Host["peers"][number] = { code: peerCode, profileId: user.id, username: user.username, status: host.requireApproval ? "pending" : "connected", seenAt: Date.now() };
      const joined = await hosts.updateOne({ code: host.code, receiver: host.receiver, ...active(), heartbeat: { $gt: Date.now() - 90000 }, "peers.profileId": { $ne: user.id }, $expr: { $lt: [{ $size: "$peers" }, host.mode === "single" ? 1 : 8] } }, { $push: { peers: peer } });
      if (!joined.modifiedCount) return error("This user is full or you already have a connection request.", 409);
      const token = secret();
      try {
        await sessions.insertOne({ code: peerCode, receiver: host.receiver, controller: token, hostCode: host.code, profileId: user.id, username: user.username, pending: host.requireApproval, expires: host.expires, expiresAt: host.expiresAt, closed: false, version: 0, sequence: [] });
      } catch (cause) {
        await hosts.updateOne({ code: host.code, receiver: host.receiver }, { $pull: { peers: { code: peerCode } } });
        throw cause;
      }
      return json({ code: peerCode, token, pending: host.requireApproval, enableCall: host.enableCall }, 201);
    }
    if (typeof body.code !== "string" || !/^[A-F0-9]{8}$/.test(body.code) || typeof body.token !== "string") return error("Invalid connection credentials.", 403);
    const host = await hosts.findOne({ code: body.code, receiver: body.token });
    if (host) {
      if (body.action === "close") {
        await hosts.updateOne({ code: host.code, receiver: host.receiver }, { $set: { closed: true, peers: [], sequence: [] }, $inc: { version: 1 } });
        await sessions.updateMany({ hostCode: host.code, receiver: host.receiver }, { $set: { closed: true } });
        return json({ closed: true });
      }
      if (host.closed || host.expires <= Date.now()) return error("This session has ended.", 410);
      if (body.action !== "approve" && body.action !== "reject") return error("Only a connected controller can send vibrations.", 403);
      if (typeof body.peerCode !== "string" || !/^[A-F0-9]{8}$/.test(body.peerCode)) return error("Invalid connection request.");
      const filter = { code: host.code, receiver: host.receiver, ...active(), peers: { $elemMatch: { code: body.peerCode, ...(body.action === "approve" ? { status: "pending" } : {}) } } };
      if (body.action === "approve") {
        const updated = await hosts.updateOne(filter, { $set: { "peers.$.status": "connected" } });
        if (!updated.modifiedCount) return error("This request is no longer available.", 409);
        await sessions.updateOne({ code: body.peerCode, receiver: host.receiver, closed: false }, { $set: { pending: false } });
      } else {
        await hosts.updateOne(filter, { $pull: { peers: { code: body.peerCode } }, $set: { sequence: [] }, $inc: { version: 1 } });
        await sessions.updateOne({ code: body.peerCode, receiver: host.receiver }, { $set: { closed: true } });
      }
      return json({ accepted: body.action === "approve" });
    }
    const row = await sessions.findOne({ code: body.code, controller: body.token });
    if (!row) return error("Access denied.", 403);
    if (body.action === "close") {
      await sessions.updateOne({ code: row.code, controller: row.controller }, { $set: { closed: true } });
      await hosts.updateOne({ code: row.hostCode, receiver: row.receiver, "peers.code": row.code }, { $pull: { peers: { code: row.code } }, $set: { sequence: [] }, $inc: { version: 1 } });
      return json({ closed: true });
    }
    if (body.action !== "send") return error("Only the giving user can approve requests.", 403);
    if (row.closed || row.pending || row.expires <= Date.now()) return error("This connection is not active.", 403);
    if (!validSequence(body.sequence, true)) return error("Use an odd number of up to 99 timings, each 1–3000 ms, totaling at most 120 seconds.");
    if (body.sequence.length && await limited(request, `send:${row.hostCode}`, 600)) return error("Too many requests. Wait a moment.", 429);
    const updated = await hosts.updateOne({ code: row.hostCode, receiver: row.receiver, ...active(), peers: { $elemMatch: { code: row.code, status: "connected" } } }, { $set: { sequence: body.sequence }, $inc: { version: 1 } });
    if (!updated.modifiedCount) return error("This connection has ended.", 410);
    return json({ sent: true });
  } catch {
    return error("Remote control is temporarily unavailable. Please try again.", 503);
  }
}
