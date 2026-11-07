"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import LiveControl, { type LivePlayback } from "./live-control";
import VoiceChat from "./voice-chat";
import Icon from "./icons";
import { previewControllerRhythm, stopControllerFeedback } from "../lib/controller-feedback";
import { requestVibration } from "../lib/vibration";

const presets = [
  { name: "Single pulse", detail: "One clean moment", shape: [3, 3, 9, 9, 9, 9, 3, 3] },
  { name: "Double tap", detail: "A little déjà vu", shape: [2, 8, 8, 2, 2, 8, 8, 2] },
  { name: "SOS", detail: "The classic signal", shape: [4, 2, 4, 2, 9, 9, 2, 4, 2, 4] },
  { name: "Heartbeat", detail: "Find your rhythm", shape: [2, 5, 9, 3, 2, 5, 9, 3] },
  { name: "Escalating", detail: "Build up slowly", shape: [2, 3, 4, 5, 6, 7, 8, 9] },
  { name: "Custom", detail: "Make it your own", shape: [3, 7, 4, 9, 3, 6, 8, 4] },
];
type Saved = { id: string; name: string; author: string; sequence: number[]; createdAt: string };
type Profile = { profileId: string; profileToken: string; username: string };
type AvailableUser = { code: string; username: string; mode: "single" | "multiple"; requireApproval: boolean; enableCall: boolean; count: number };
type Peer = { code: string; username: string; status: "pending" | "connected" };
type Session = { code: string; token: string; role: "receiver" | "controller"; practiceName?: string };

function Wave({ shape = presets[3].shape }: { shape?: number[] }) {
  return <div className="wave" aria-hidden="true">{Array.from({ length: 3 }, (_, i) => shape.map((height, j) => <i key={`${i}-${j}`} style={{ height: `${height * 4}px` }} />))}</div>;
}

async function request(path: string, body?: object) {
  const response = await fetch(path, body ? { signal: AbortSignal.timeout(15000), method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store", signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || "Could not connect. Please try again."), { status: response.status });
  return data;
}

const practiceProfiles = [
  { name: "Mira", mode: "Single", approval: false },
  { name: "Aarohi", mode: "Multiple", approval: false },
  { name: "Ananya", mode: "Single", approval: true },
  { name: "Diya", mode: "Multiple", approval: true },
  { name: "Ishita", mode: "Single", approval: false },
  { name: "Kavya", mode: "Multiple", approval: false },
  { name: "Nandini", mode: "Single", approval: true },
  { name: "Priya", mode: "Multiple", approval: true },
  { name: "Riya", mode: "Single", approval: false },
  { name: "Saanvi", mode: "Multiple", approval: false },
  { name: "Tara", mode: "Single", approval: true },
  { name: "Vani", mode: "Multiple", approval: true },
  { name: "Aditi", mode: "Single", approval: false },
  { name: "Meera", mode: "Multiple", approval: false },
  { name: "Sneha", mode: "Single", approval: true },
];

const screens = [{ name: "Live", path: "/", icon: "wave" }, { name: "Patterns", path: "/patterns", icon: "playlist" }, { name: "Control", path: "/control", icon: "presets" }, { name: "Users", path: "/users", icon: "users" }] as const;

export default function PulseApp() {
  const pathname = usePathname();
  const router = useRouter();
  const tab = screens.find(screen => screen.path === pathname.replace(/\/$/, "") || screen.path === pathname)?.name;
  function setTab(name: string) { router.push(screens.find(screen => screen.name === name)!.path); }
  const [patternView, setPatternView] = useState("Presets");
  const [pattern, setPattern] = useState(0);
  const [duration, setDuration] = useState(500);
  const [repeats, setRepeats] = useState(1);
  const [custom, setCustom] = useState("200, 100, 200");
  const [supported, setSupported] = useState(false);
  const [running, setRunning] = useState(false);
  const livePlayback = useRef<LivePlayback>(null);
  const [notice, setNotice] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [microphone, setMicrophone] = useState<MediaStream | null>(null);
  const microphoneRef = useRef<MediaStream | null>(null);
  const pairingAttempt = useRef(0);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [username, setUsername] = useState("");
  const [users, setUsers] = useState<AvailableUser[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [directoryRefresh, setDirectoryRefresh] = useState(0);
  const [directoryError, setDirectoryError] = useState("");
  const [mode, setMode] = useState<"single" | "multiple">("single");
  const [requireApproval, setRequireApproval] = useState(false);
  const [enableCall, setEnableCall] = useState(true);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [library, setLibrary] = useState<Saved[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [sharing, setSharing] = useState(false);
  const [name, setName] = useState("");
  const [author, setAuthor] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentSession = useRef<Session | null>(null);
  const version = useRef(0);

  function stopMicrophone() {
    microphoneRef.current?.getTracks().forEach(track => track.stop());
    microphoneRef.current = null;
    setMicrophone(null);
  }

  function stopLocal() {
    stopControllerFeedback();
    if (timer.current) clearTimeout(timer.current);
    setRunning(false);
  }

  function play(sequence: number[], preview = false) {
    if (timer.current) clearTimeout(timer.current);
    if (!sequence.length || document.hidden) { stopLocal(); return; }
    if (preview) previewControllerRhythm(sequence);
    const accepted = preview || requestVibration(sequence);
    setRunning(accepted);
    setNotice(preview ? "Playing a local sound preview of the rhythm." : accepted ? "Vibration requested. Feel the rhythm." : "Tap a play button on this phone to enable vibration. Use Android Chrome if it stays blocked.");
    if (accepted) timer.current = setTimeout(() => setRunning(false), sequence.reduce((a, b) => a + b, 0));
  }

  useEffect(() => {
    setSupported(typeof navigator.vibrate === "function");
    try {
      const saved = JSON.parse(localStorage.getItem("pulse-profile") || "null");
      if (saved?.profileId && saved?.profileToken && saved?.username) { setProfile(saved); setUsername(saved.username); }
    } catch {}
    function hide(event: Event) {
      if (event.type !== "pagehide" && !document.hidden) return;
      if (event.type === "pagehide") stopLocal();
      else requestVibration(0);
      if (!currentSession.current) {
        pairingAttempt.current++; setBusy(false);
        stopMicrophone();
      }
    }
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", hide);
      pairingAttempt.current++; setBusy(false);
      stopMicrophone();
      stopControllerFeedback();
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    if (!session || session.practiceName) return;
    let cancelled = false;
    let inFlight = false;
    let failures = 0;
    let skipPending = false;
    let pollTimer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (cancelled || inFlight) return;
      inFlight = true;
      clearTimeout(pollTimer);
      try {
        const result = await request(`/api/remote?code=${session!.code}&token=${session!.token}&after=${version.current}`);
        if (cancelled || currentSession.current !== session) return;
        if (result.closed) {
          stopMicrophone(); stopLocal(); currentSession.current = null; setSession(null); setConnected(false); setReconnecting(false); setNotice("Remote session has ended."); return;
        }
        failures = 0; setReconnecting(false);
        if (!document.hidden) setConnected(result.connected);
        setPending(Boolean(result.pending));
        if (result.peers) setPeers(previous => JSON.stringify(previous) === JSON.stringify(result.peers) ? previous : result.peers);
        if (!document.hidden && !skipPending && result.version > version.current && session!.role === "receiver" && result.sequence) play(result.sequence);
        version.current = result.version;
        if (!document.hidden) skipPending = false;
      } catch (error) {
        if (cancelled) return;
        const status = (error as Error & { status?: number }).status;
        if (status === 403 || status === 404 || status === 410) {
          stopMicrophone(); stopLocal(); currentSession.current = null; setSession(null); setConnected(false); setReconnecting(false); setNotice("Your connection ended. Pair again to reconnect."); return;
        }
        failures++; skipPending = true;
        stopLocal(); setReconnecting(true);
      } finally {
        inFlight = false;
        if (!cancelled && currentSession.current === session) pollTimer = setTimeout(poll, failures ? Math.min(1000 * 2 ** Math.min(failures, 4), 15000) : document.hidden ? 3000 : 700);
      }
    }
    function wake() {
      skipPending = true;
      if (!document.hidden) { clearTimeout(pollTimer); void poll(); }
    }
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    window.addEventListener("pageshow", wake);
    void poll();
    return () => {
      cancelled = true; clearTimeout(pollTimer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("pageshow", wake);
    };
  }, [session]);

  useEffect(() => {
    if (tab !== "Users") return;
    let cancelled = false;
    let refresh: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const data = await request("/api/remote?directory=1");
        if (!cancelled) { setUsers(data.users); setDirectoryError(""); }
      } catch (error) { if (!cancelled) setDirectoryError((error as Error).message); }
      finally { if (!cancelled) { setDirectoryLoading(false); refresh = setTimeout(load, 4000); } }
    }
    void load();
    return () => { cancelled = true; clearTimeout(refresh); };
  }, [tab, directoryRefresh]);

  useEffect(() => {
    if (tab !== "Patterns" || patternView !== "Playlist") return;
    let cancelled = false;
    setLoading(true);
    request("/api/patterns").then(data => { if (!cancelled) setLibrary(data); }).catch(error => setNotice(error.message)).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tab, patternView]);

  const parts = custom.split(",").map(s => s.trim());
  const validCustom = parts.length <= 19 && parts.length % 2 === 1 && parts.every(s => /^\d+$/.test(s) && +s >= 1 && +s <= 3000);
  const short = Math.max(25, Math.round(duration / 3));
  const sequences = [[duration], [duration, 150, duration], [short, short, short, short, short, duration, duration, short, duration, short, duration, duration, short, short, short, short, short], [short, 100, duration], [short, 150, Math.round(duration * 2 / 3), 150, duration], parts.map(Number)];
  const sequence = Array.from({ length: repeats }, (_, i) => i ? [300, ...sequences[pattern]] : sequences[pattern]).flat();
  const total = sequence.reduce((a, b) => a + b, 0);
  const valid = (pattern !== 5 || validCustom) && total <= 120000;
  const controlling = session?.role === "controller" && connected;

  async function sendRemote(values: number[]) {
    if (!session?.practiceName) await request("/api/remote", { action: "send", ...session, sequence: values });
  }

  function connectPractice(profile: typeof practiceProfiles[number]) {
    if (busy || currentSession.current) return;
    const active: Session = { code: `practice-${profile.name}`, token: crypto.randomUUID(), role: "controller", practiceName: profile.name };
    stopLocal();
    currentSession.current = active;
    setSession(active); setConnected(!profile.approval); setPending(profile.approval); setReconnecting(false); setPeers([]);
    setNotice(profile.approval ? "Practice request · approval is simulated automatically." : `Connected to ${profile.name}. Rhythms preview on this device.`);
  }

  useEffect(() => {
    if (!session?.practiceName || !pending) return;
    const approval = setTimeout(() => { setPending(false); setConnected(true); }, 1500);
    return () => clearTimeout(approval);
  }, [session, pending]);

  async function transmit(values: number[]) {
    const stopped = livePlayback.current?.stop();
    if (!controlling) { play(values, true); return; }
    previewControllerRhythm(values);
    try { await stopped; await sendRemote(values); setNotice(session?.practiceName ? `${session.practiceName} · local rhythm preview.` : values.length ? "Pattern sent to the paired phone." : "Stop sent to the paired phone."); }
    catch (error) { stopControllerFeedback(); setNotice((error as Error).message); }
  }

  async function pair(role: Session["role"], targetCode?: string) {
    if (busy || currentSession.current) return;
    if (role === "receiver" && !requestVibration(1)) {
      setNotice("Tap again in Android Chrome to enable vibration first."); return;
    }
    const voiceEnabled = role === "receiver" ? enableCall : users.find(user => user.code === targetCode)?.enableCall === true;
    if (voiceEnabled && (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection)) {
      setNotice("Pairing with voice needs HTTPS and microphone access. Open in Chrome."); return;
    }
    const attempt = ++pairingAttempt.current;
    setBusy(true); setNotice("");
    let local: MediaStream | null = null;
    try {
      if (voiceEnabled) local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (attempt !== pairingAttempt.current || document.hidden) {
        local?.getTracks().forEach(track => track.stop()); return;
      }
      local?.getTracks().forEach(track => { track.enabled = false; });
      microphoneRef.current = local;
      const identity = await ensureProfile();
      const result = await request("/api/remote", role === "receiver" ? { action: "create", ...identity, mode, requireApproval, enableCall } : { action: "join", ...identity, code: targetCode });
      const active = { code: result.code, token: result.token, role };
      if (attempt !== pairingAttempt.current || document.hidden) {
        local?.getTracks().forEach(track => track.stop());
        await request("/api/remote", { action: "close", ...active });
        return;
      }
      version.current = 0; currentSession.current = active;
      setMicrophone(local); setSession(active); setReconnecting(false); setConnected(role === "controller" && !result.pending); setPending(Boolean(result.pending)); setPeers([]);
    } catch (error) {
      local?.getTracks().forEach(track => track.stop());
      if (attempt !== pairingAttempt.current) return;
      stopMicrophone();
      setNotice(error instanceof DOMException && error.name === "NotAllowedError" ? "Allow microphone access to pair with voice. You can mute once paired." : error instanceof DOMException && error.name === "NotFoundError" ? "No microphone found. Connect one to pair with voice." : (error as Error).message);
    } finally { if (attempt === pairingAttempt.current) setBusy(false); }
  }

  async function ensureProfile() {
    const result: Profile = await request("/api/remote", { action: "profile", ...profile, username: username.trim() || undefined });
    setProfile(result); setUsername(result.username);
    try { localStorage.setItem("pulse-profile", JSON.stringify(result)); }
    catch { setNotice("Browser storage is unavailable. Your username will not be remembered after reloading."); }
    return result;
  }

  async function saveUsername() {
    setBusy(true);
    try { await ensureProfile(); setNotice("Username saved."); }
    catch (error) { setNotice((error as Error).message); }
    finally { setBusy(false); }
  }

  async function respondToPeer(peerCode: string, action: "approve" | "reject") {
    setBusy(true);
    try {
      await request("/api/remote", { action, ...session, peerCode });
      setPeers(previous => action === "reject" ? previous.filter(peer => peer.code !== peerCode) : previous.map(peer => peer.code === peerCode ? { ...peer, status: "connected" } : peer));
    } catch (error) { setNotice((error as Error).message); }
    finally { setBusy(false); }
  }

  async function disconnect(message = "Disconnected. Voice and remote control ended.") {
    pairingAttempt.current++; setBusy(false);
    stopMicrophone(); stopLocal();
    const active = session;
    currentSession.current = null; setSession(null); setConnected(false); setReconnecting(false); setPeers([]); setPending(false);
    try { if (!active?.practiceName) await request("/api/remote", { action: "close", ...active }); setNotice(message); }
    catch { setNotice("Stopped locally. Could not notify the other device; the session will expire."); }
  }

  async function save() {
    setBusy(true);
    try {
      await request("/api/patterns", { name: name.trim(), author: author.trim() || "Anonymous", sequence });
      setSharing(false); setName(""); setNotice("Your pattern is now in the shared playlist."); setTab("Patterns"); setPatternView("Playlist");
    } catch (error) { setNotice((error as Error).message); }
    finally { setBusy(false); }
  }

  return <div className={`app-shell ${tab === "Live" ? "live-mode" : (tab === "Control" || tab === "Users") ? "remote-mode" : ""}`}>
    <header><Link className="brand" href="/" aria-label="Pulse home"><span className="brand-mark"><Icon name="wave" /></span>pulse<span className="brand-period">.</span></Link><span className="header-note">A little connection. A little vibration.</span><span className="device-badge"><i />{supported ? "Vibration available" : "Preview mode"}</span></header>
    {session && <VoiceChat key={session.token} session={session} connected={connected} reconnecting={reconnecting} peers={peers} pending={pending} microphone={microphone} onDisconnect={disconnect} />}
    <main>
      <nav className="bottom-nav" aria-label="Main navigation">{screens.map(screen => <Link key={screen.path} href={screen.path} className={tab === screen.name ? "nav-active" : ""} aria-current={tab === screen.name ? "page" : undefined} onClick={() => setSharing(false)}><Icon name={screen.icon} />{screen.name}</Link>)}</nav>
      <div className="page-heading"><div className="eyebrow">{tab === "Control" ? "YOUR PHONE, YOUR RULES" : tab === "Users" ? "CONNECT, TALK & PLAY" : "FIND YOUR RHYTHM"}</div><h1>{tab === "Control" ? "You’re in control." : tab === "Users" ? "Find your people." : <>Good vibes.<br className="mobile-break" /> Your way.</>}</h1><p>{tab === "Control" ? "Choose who can connect and how you share." : tab === "Users" ? "Connect to someone who’s ready to share a rhythm." : "Explore presets and rhythms shared by others."}</p></div>
      {tab === "Patterns" && <div className="pattern-views" role="group" aria-label="Pattern collection">{["Presets", "Playlist"].map(view => <button key={view} aria-pressed={patternView === view} onClick={() => { setPatternView(view); setSharing(false); }}>{view}</button>)}</div>}
      {!supported && <p className="compatibility-note">To feel vibrations, open this page directly in Chrome on an Android phone. Play previews the rhythm with sound here. You can also control another phone.</p>}
      <LiveControl hidden={tab !== "Live"} playbackRef={livePlayback} key={session?.token || "local"} enabled={true} remote={!!controlling} onRemote={sendRemote} />
      {tab === "Patterns" && patternView === "Presets" && <div className="studio">
        <section className="pattern-section"><div className="section-title"><h2>Choose a pattern</h2><span>01 — THE RHYTHM</span></div><div className="pattern-grid">{presets.map((preset, i) => <button className={`pattern-card ${pattern === i ? "selected" : ""}`} key={preset.name} onClick={() => setPattern(i)} aria-pressed={pattern === i}><div className="card-top"><span className="pattern-number">0{i + 1}</span><span className="selection-dot">{pattern === i ? <Icon name="check" /> : null}</span></div><Wave shape={preset.shape} /><strong>{preset.name}</strong><span className="card-detail">{preset.detail}</span></button>)}</div><div className="tip"><span><Icon name="sparkle" /></span><p>Small changes, different feelings.<br /><strong>Try a slower pulse or a few extra repeats.</strong></p></div></section>
        <aside className="tuning"><div className="section-title"><h2>Make it yours</h2><span>02</span></div><div className={`preview ${running ? "playing" : ""}`}><span className="preview-label">{controlling ? "REMOTE PREVIEW" : "PATTERN PREVIEW"}</span><Wave shape={presets[pattern].shape} /><strong>{presets[pattern].name}</strong><span>{valid ? `${(total / 1000).toFixed(1)}s total · ${repeats} ${repeats === 1 ? "repeat" : "repeats"}` : "Adjust your timings"}</span></div>
          {pattern === 5 && <label className="custom-label">Custom timing (ms)<input value={custom} onChange={e => setCustom(e.target.value)} aria-invalid={!validCustom} /><small>Vibrate, pause, vibrate. Up to 19 values, 1–3000 ms each.</small>{!validCustom && <small className="error">Use an odd number of comma-separated timings.</small>}</label>}
          <div className="slider-heading"><label htmlFor="duration">Pulse duration</label><output>{duration}<small> ms</small></output></div><input id="duration" type="range" min="50" max="3000" step="50" value={duration} disabled={pattern === 5} onChange={e => setDuration(+e.target.value)} /><div className="range-ends"><span>Short & crisp</span><span>Long & slow</span></div>
          <div className="slider-heading"><label htmlFor="repeats">Repeats</label><output>{repeats}<small> ×</small></output></div><input id="repeats" type="range" min="1" max="5" value={repeats} onChange={e => setRepeats(+e.target.value)} /><div className="range-ends"><span>Just once</span><span>A little longer</span></div>
          {!valid && total > 120000 && <p className="error">Keep the full pattern under 120 seconds.</p>}
          <div className="play-actions"><button className="primary" disabled={!valid} onClick={() => transmit(sequence)}><Icon name="play" />{controlling ? "Send vibration" : running ? "Play again" : "Feel the pattern"}</button><button className="stop-button" aria-label="Stop vibration" disabled={!running && !controlling} onClick={() => transmit([])}><Icon name="stop" /></button></div><button className="share-button" disabled={!valid} onClick={() => setSharing(!sharing)}><Icon name="plus" /> Save to playlist</button>
          {sharing && <form className="share-form" onSubmit={e => { e.preventDefault(); void save(); }}><label>Pattern name<input required maxLength={60} value={name} onChange={e => setName(e.target.value)} placeholder="Give your rhythm a name" /></label><label>Your name <small>(optional)</small><input maxLength={40} value={author} onChange={e => setAuthor(e.target.value)} placeholder="Anonymous" /></label><small>Visible to everyone who opens this app.</small><button className="primary" disabled={busy || !name.trim()}>{busy ? "Saving…" : "Share pattern"}</button></form>}
        </aside>
      </div>}
      {(tab === "Control" || tab === "Users") && <section className="remote-grid remote-single">
        {tab === "Users" && <article className="remote-card directory-card">
          <div className="directory-heading"><div><span className="eyebrow">ONLINE NOW</span><h2>Take control</h2></div><button className="connection-icon directory-refresh" aria-label="Refresh users" title="Refresh users" aria-busy={directoryLoading} disabled={directoryLoading} onClick={() => { setDirectoryLoading(true); setDirectoryRefresh(value => value + 1); }}><Icon name="refresh" /></button></div>
          {session?.role === "controller" ? <div className="paired"><strong>{pending ? "Waiting for approval…" : session.practiceName ? `Connected to ${session.practiceName}.` : "You’re connected."}</strong><p>{pending ? "Voice and vibration start after they accept." : session.practiceName ? "Demo connection · preview rhythms on this device. No microphone or other phone needed." : "Your next rhythm is one tap away."}</p>{connected && <button className="primary" onClick={() => setTab("Live")}>Open live control <Icon name="arrow" /></button>}</div> : <>
            <p>Connect to someone who has turned on Give control.</p>
            <div className="available-users" aria-live="polite">

              {directoryError ? <p className="error">{directoryError}</p> : directoryLoading && users.length === 0 ? <p>Finding available users…</p> : users.filter(user => user.code !== session?.code).map(user => <div className="available-user" key={user.code}>
                <span className="user-avatar" aria-hidden="true">{user.username.slice(0, 1).toUpperCase()}</span>
                <div><strong>@{user.username}</strong><small>{user.mode === "single" ? "Single" : "Multiple"} · {user.requireApproval ? "Approval needed" : "Open to connect"} · {user.enableCall ? "Voice on" : "Vibration only"}</small></div>
                <button className="secondary" disabled={busy || !!session || (user.count >= (user.mode === "single" ? 1 : 8))} onClick={() => pair("controller", user.code)}>{user.count >= (user.mode === "single" ? 1 : 8) ? "Busy" : user.requireApproval ? "Request" : "Connect"}</button>
              </div>)}
            </div>
            <div className="practice-profiles">{practiceProfiles.map(profile => <div className="available-user" key={profile.name}><span className="user-avatar" aria-hidden="true">{profile.name[0]}</span><div><strong>@{profile.name.toLowerCase()}</strong><small>{profile.mode} · {profile.approval ? "Approval needed" : "Open to connect"} · Vibration only</small></div><button className="secondary" disabled={busy || !!session} onClick={() => connectPractice(profile)}>{profile.approval ? "Request" : "Connect"}</button></div>)}</div>
          </>}
        </article>}
        {tab === "Control" && <article className="remote-card giveaway-card">
          <span className="eyebrow">YOUR PHONE, YOUR RULES</span><h2>Give control</h2>
          <form className="username-form" onSubmit={event => { event.preventDefault(); void saveUsername(); }}><label htmlFor="username">Your username</label><div className="username-edit"><input id="username" value={username} onChange={event => setUsername(event.target.value)} placeholder="Generate one or enter your own" minLength={3} maxLength={24} pattern="[A-Za-z0-9_-]{3,24}" autoCapitalize="none" autoComplete="off" spellCheck={false} disabled={!!session || busy} /><button className="secondary" disabled={busy || !!session}>{username.trim() ? "Save" : "Generate"}</button></div><small>3–24 letters, numbers, underscores or hyphens. Remembered on this browser.</small></form>
          <fieldset className="connection-mode" disabled={!!session || busy}><legend>Who can connect?</legend><div><button type="button" aria-pressed={mode === "single"} onClick={() => setMode("single")}>Single</button><button type="button" aria-pressed={mode === "multiple"} onClick={() => setMode("multiple")}>Multiple</button></div></fieldset>
          <label className="approval-option"><span>Require approval<small>Accept each person before voice or vibration starts.</small></span><input type="checkbox" checked={requireApproval} disabled={!!session || busy} onChange={event => setRequireApproval(event.target.checked)} /></label>
          <label className="approval-option"><span>Enable voice call<small>Connect microphones automatically when someone joins.</small></span><input type="checkbox" checked={enableCall} disabled={!!session || busy} onChange={event => setEnableCall(event.target.checked)} /></label>
          {session?.role === "receiver" ? <><div className="giveaway-active"><i />Visible as @{profile?.username}</div><button className="secondary" onClick={() => disconnect()}>Turn off Give control</button></> : <button className="primary" disabled={busy || !!session || !supported} onClick={() => pair("receiver")}>{busy ? "Preparing…" : "Turn on Give control"}<Icon name="arrow" /></button>}
          <small>{mode === "multiple" ? "Up to 8 controllers. The latest vibration command takes over. Each person controls your phone." : "One controller at a time."} {requireApproval ? "You approve who joins." : "Anyone in the list can connect while this is on."}</small>
          {session?.role === "receiver" && peers.length > 0 && <div className="peer-list"><h3>Your connections</h3>{peers.map(peer => <div className="peer-row" key={peer.code}><div><strong>@{peer.username}</strong><small>{peer.status === "pending" ? "Wants to connect" : "Connected"}</small></div><div className="peer-actions">{peer.status === "pending" && <button className="primary" disabled={busy} onClick={() => respondToPeer(peer.code, "approve")}>Accept</button>}<button className="secondary" disabled={busy} onClick={() => respondToPeer(peer.code, "reject")}>{peer.status === "pending" ? "Decline" : "Remove"}</button></div></div>)}</div>}
        </article>}
        <div className="remote-note"><Icon name="sparkle" /><span>Voice connects automatically when enabled. Use end at the top to disconnect. Keep this page open to stay available; sessions last 30 minutes.</span></div>
      </section>}
      {tab === "Patterns" && patternView === "Playlist" && <section><div className="community-toolbar"><h2>Shared playlist <span>{library.length}</span></h2><input aria-label="Search patterns" placeholder="Search a rhythm or creator…" value={search} onChange={e => setSearch(e.target.value)} /></div>{loading ? <div className="empty-state">Loading the playlist…</div> : library.length === 0 ? <div className="empty-state"><span className="feature-icon"><Icon name="sparkle" /></span><h2>Start the shared playlist.</h2><p>No shared patterns yet. Create a rhythm and share it here.</p><button className="primary" onClick={() => { setTab("Patterns"); setPatternView("Presets"); setSharing(true); }}>Create a pattern <Icon name="plus" /></button></div> : <div className="community-grid">{library.filter(item => `${item.name} ${item.author}`.toLowerCase().includes(search.toLowerCase())).map(item => <article className="saved-card" key={item.id}><div className="saved-meta"><span>SHARED PATTERN</span><span>{(item.sequence.reduce((a, b) => a + b, 0) / 1000).toFixed(1)}s</span></div><Wave shape={item.sequence.filter((_, i) => i % 2 === 0).slice(0, 10).map(n => Math.max(2, Math.min(9, Math.round(n / 100))))} /><h3>{item.name}</h3><p>by {item.author}</p><button className="secondary" onClick={() => transmit(item.sequence)}><Icon name={controlling ? "arrow" : "play"} />{controlling ? "Send pattern" : "Play pattern"}</button></article>)}</div>}{library.length > 0 && !library.some(item => `${item.name} ${item.author}`.toLowerCase().includes(search.toLowerCase())) && <div className="empty-state">No patterns match “{search}”.</div>}{running && <button className="floating-stop" onClick={() => transmit([])}><Icon name="stop" /> Stop vibration</button>}</section>}
      {tab === "Patterns" && patternView === "Presets" && <div className="mobile-transport"><span>{presets[pattern].name}<small>{valid ? `${(total / 1000).toFixed(1)}s · ${repeats}×` : "Check timings"}</small></span><button className="primary" disabled={!valid} onClick={() => transmit(sequence)}><Icon name={controlling ? "arrow" : "play"} />{controlling ? "Send" : "Play"}</button><button className="stop-button" aria-label="Stop pattern" disabled={!running && !controlling} onClick={() => transmit([])}><Icon name="stop" /></button></div>}
      {running && (tab === "Control" || tab === "Users") && <button className="floating-stop" onClick={stopLocal}><Icon name="stop" /> Stop vibration</button>}
      {notice && <p className="inline-feedback" role="status">{notice}</p>}
      <footer><span><span className="footer-mark"><Icon name="wave" /></span> Made for the moments you can feel.</span><span>Made for Android Chrome</span></footer>
    </main>
  </div>;
}
