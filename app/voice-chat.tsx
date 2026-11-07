"use client";

import { useEffect, useRef, useState } from "react";

type Session = { code: string; token: string; role: "receiver" | "controller" };
type Peer = { code: string; username: string; status: "pending" | "connected" };
type Call = { id: string; from: Session["role"]; offer: RTCSessionDescriptionInit; answer: RTCSessionDescriptionInit | null; ended: boolean };
type VoiceState = { connected: boolean; needsAudio: boolean };

function PeerAudio({ code, token, role, microphone, revision, resumeAudio, onState }: Session & { microphone: MediaStream; revision: number; resumeAudio: number; onState: (code: string, state: VoiceState) => void }) {
  const [voiceConnected, setVoiceConnected] = useState(false);
  const [needsAudio, setNeedsAudio] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const restart = useRef<() => void>(() => {});
  const report = useRef(onState);
  useEffect(() => { if (revision) restart.current(); }, [revision]);
  report.current = onState;
  useEffect(() => { report.current(code, { connected: voiceConnected, needsAudio }); }, [code, voiceConnected, needsAudio]);
  useEffect(() => {
    if (resumeAudio && audio.current?.srcObject) void audio.current.play().then(() => setNeedsAudio(false)).catch(() => setNeedsAudio(true));
  }, [resumeAudio]);
  useEffect(() => {

    let cancelled = false;
    let peer: RTCPeerConnection | null = null;
    let callId: string | null = null;
    let inFlight = false;
    let restartNeeded = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout>;
    let deadline: ReturnType<typeof setTimeout>;

    function closePeer() {
      clearTimeout(deadline);
      const old = peer; peer = null;
      old?.close();
      setVoiceConnected(false);
      if (audio.current) audio.current.srcObject = null;
    }

    async function signal(action?: string, description?: RTCSessionDescriptionInit) {
      const response = await fetch(action ? "/api/voice" : `/api/voice?${new URLSearchParams({ code: code, token: token })}`, action ? {
        method: "POST", signal: AbortSignal.timeout(15000), headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code, token: token, action, id: callId, description }),
      } : { cache: "no-store", signal: AbortSignal.timeout(15000) });
      const data = await response.json();
      if (!response.ok) throw Object.assign(new Error(data.error || "Voice is reconnecting."), { status: response.status });
      return data;
    }

    async function begin(iceServers: RTCIceServer[], incoming?: Call) {
      callId = incoming?.id || crypto.randomUUID();
      const connection = new RTCPeerConnection({ iceServers });
      peer = connection;
      microphone.getAudioTracks().forEach(track => connection.addTrack(track, microphone));
      connection.ontrack = event => {
        if (cancelled || peer !== connection || !audio.current) return;
        audio.current.srcObject = event.streams[0] || new MediaStream([event.track]);
        void audio.current.play().then(() => setNeedsAudio(false)).catch(() => { if (!cancelled) setNeedsAudio(true); });
      };
      connection.onconnectionstatechange = () => {
        if (cancelled || peer !== connection) return;
        if (connection.connectionState === "connected") {
          clearTimeout(deadline); restartNeeded = false; setVoiceConnected(true);
        } else if (connection.connectionState === "failed") {
          restartNeeded = true; setVoiceConnected(false);
        } else if (connection.connectionState === "disconnected") {
          setVoiceConnected(false); clearTimeout(deadline);
          deadline = setTimeout(() => { restartNeeded = true; }, 15000);
        }
      };
      deadline = setTimeout(() => { restartNeeded = true; }, 45000);
      if (incoming) {
        await connection.setRemoteDescription(incoming.offer);
        if (cancelled) return;
        await connection.setLocalDescription(await connection.createAnswer());
      } else {
        await connection.setLocalDescription(await connection.createOffer());
      }
      if (cancelled) return;
      if (connection.iceGatheringState !== "complete") await new Promise<void>(resolve => {
        const timeout = setTimeout(done, 8000);
        function done() { clearTimeout(timeout); connection.removeEventListener("icegatheringstatechange", changed); resolve(); }
        function changed() { if (connection.iceGatheringState === "complete") done(); }
        connection.addEventListener("icegatheringstatechange", changed);
      });
      if (!cancelled) await signal(incoming ? "answer" : "offer", connection.localDescription!.toJSON());
    }

    async function poll() {
      if (cancelled || inFlight) return;
      inFlight = true; clearTimeout(timer);
      try {
        if (document.hidden || !navigator.onLine) return;
        if (!microphone.getAudioTracks().some(track => track.readyState === "live")) return;
        if (restartNeeded) {
          if (callId) await signal("restart");
          if (cancelled) return;
          closePeer(); callId = null; restartNeeded = false;
        }
        const data = await signal();
        if (cancelled) return;
        failures = 0;
        const call = data.call as Call | null;
        if (peer && (call?.ended || (call && call.id !== callId))) {
          closePeer(); callId = null;
        }
        if (!peer) {
          if (role === "controller" && (!call || call.ended)) await begin(data.iceServers);
          else if (call && !call.ended && call.from !== role) await begin(data.iceServers, call);
        } else if (call?.id === callId && call.answer && peer.signalingState === "have-local-offer") {
          await peer.setRemoteDescription(call.answer);
        }
      } catch (error) {
        if (cancelled) return;
        const status = (error as Error & { status?: number }).status;
        if (status === 403 || status === 404 || status === 410) {
          cancelled = true; closePeer(); return;
        }
        failures++;
        if (peer?.connectionState !== "connected") { restartNeeded = true; setVoiceConnected(false); }
      } finally {
        inFlight = false;
        if (!cancelled) timer = setTimeout(poll, failures ? Math.min(2000 * 2 ** Math.min(failures, 4), 30000) : peer?.connectionState === "connected" || document.hidden ? 3000 : 1000);
      }
    }

    function wake() {
      if (!document.hidden) { clearTimeout(timer); void poll(); }
    }
    function microphoneEnded() { restartNeeded = true; setVoiceConnected(false); wake(); }
    restart.current = microphoneEnded;
    microphone.getTracks().forEach(track => track.addEventListener("ended", microphoneEnded));
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    window.addEventListener("pageshow", wake);
    void poll();
    return () => {
      cancelled = true; clearTimeout(timer); clearTimeout(deadline);
      restart.current = () => {};
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("pageshow", wake);
      microphone.getTracks().forEach(track => track.removeEventListener("ended", microphoneEnded));
      peer?.close();
      if (audio.current) audio.current.srcObject = null;
    };
  }, [code, token, role, microphone]);

  return <audio ref={audio} autoPlay playsInline />;
}

export default function VoiceChat({ session, connected, reconnecting, microphone, onDisconnect, peers = [], pending = false }: { session: Session; connected: boolean; reconnecting: boolean; microphone: MediaStream | null; onDisconnect: (message?: string) => void; peers?: Peer[]; pending?: boolean }) {
  const [muted, setMuted] = useState(false);
  const [needsMicrophone, setNeedsMicrophone] = useState(false);
  const [revision, setRevision] = useState(0);
  const [resumeAudio, setResumeAudio] = useState(0);
  const [states, setStates] = useState<Record<string, VoiceState>>({});
  const retryMicrophone = useRef<() => void>(() => {});
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const activePeers = session.role === "receiver" ? peers.filter(peer => peer.status === "connected") : connected ? [{ code: session.code }] : [];
  const hasPeers = activePeers.length > 0;
  const voiceConnected = activePeers.some(peer => states[peer.code]?.connected);
  const needsAudio = activePeers.some(peer => states[peer.code]?.needsAudio);

  useEffect(() => {
    microphone?.getAudioTracks().forEach(track => { track.enabled = hasPeers && !muted; });
  }, [microphone, hasPeers, muted, revision]);

  useEffect(() => {
    if (!hasPeers || !microphone) return;
    let cancelled = false;
    let restoring = false;
    let blocked = false;
    async function restore() {
      if (restoring || cancelled || blocked || document.hidden || microphone.getAudioTracks().some(track => track.readyState === "live")) return;
      restoring = true;
      try {
        const fresh = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
        if (cancelled) { fresh.getTracks().forEach(track => track.stop()); return; }
        microphone.getTracks().forEach(track => { track.removeEventListener("ended", wake); microphone.removeTrack(track); });
        fresh.getAudioTracks().forEach(track => {
          track.enabled = !mutedRef.current;
          microphone.addTrack(track);
          track.addEventListener("ended", wake);
        });
        setNeedsMicrophone(false); setRevision(value => value + 1);
      } catch {
        if (!cancelled) { blocked = true; setNeedsMicrophone(true); }
      } finally { restoring = false; }
    }
    function wake() { void restore(); }
    retryMicrophone.current = () => { blocked = false; wake(); };
    microphone.getTracks().forEach(track => track.addEventListener("ended", wake));
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    window.addEventListener("pageshow", wake);
    wake();
    return () => {
      cancelled = true; retryMicrophone.current = () => {};
      microphone.getTracks().forEach(track => track.removeEventListener("ended", wake));
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("pageshow", wake);
    };
  }, [microphone, hasPeers]);

  function toggleMute() {
    if (needsMicrophone) retryMicrophone.current();
    else if (needsAudio) setResumeAudio(value => value + 1);
    else setMuted(value => !value);
  }

  const count = activePeers.length;
  const status = reconnecting ? "Reconnecting…" : needsMicrophone ? "Tap mic to resume voice" : pending ? "Waiting for approval…" : !hasPeers ? "Give control is on · waiting…" : !microphone ? "Connected · vibration only" : needsAudio ? "Tap mic to hear audio" : !voiceConnected ? "Connected · starting voice…" : `${count > 1 ? `${count} connected` : "Connected"} · ${muted ? "microphone muted" : "voice on"}`;

  return <section className="connection-status" aria-label="Your connection">
    {microphone && activePeers.map(peer => <PeerAudio key={peer.code} code={peer.code} token={session.token} role={session.role} microphone={microphone} revision={revision} resumeAudio={resumeAudio} onState={(code, state) => setStates(previous => ({ ...previous, [code]: state }))} />)}
    <p role="status"><i className={voiceConnected ? "online" : ""} />{status}</p>
    {microphone && <button className="connection-icon" aria-label={needsMicrophone ? "Resume microphone" : needsAudio ? "Enable audio" : muted ? "Unmute microphone" : "Mute microphone"} title={muted ? "Unmute" : "Mute"} aria-pressed={muted} onClick={toggleMute}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />{muted && <path d="m3 3 18 18" />}</svg>
    </button>}
    <button className="connection-icon connection-end" aria-label="End connection" title="Disconnect voice and remote control" onClick={() => onDisconnect()}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 15v-4c5-5 13-5 18 0v4l-5-1v-3a12 12 0 0 0-8 0v3z" /><path d="m4 3 16 18" /></svg>
    </button>
  </section>;
}
