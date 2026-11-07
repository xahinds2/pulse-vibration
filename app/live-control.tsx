"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import Icon from "./icons";
import { previewControllerRhythm, stopControllerFeedback } from "../lib/controller-feedback";

type Point = { x: number; y: number };

export type LivePlayback = { stop: () => Promise<void> };

export default function LiveControl({ enabled, remote, onRemote, hidden, playbackRef }: { enabled: boolean; remote: boolean; onRemote: (sequence: number[]) => Promise<void>; hidden: boolean; playbackRef: Ref<LivePlayback> }) {
  const [point, setPoint] = useState<Point>({ x: .5, y: .65 });
  const [active, setActive] = useState(false);
  const [loop, setLoop] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [trace, setTrace] = useState<number[]>([]);
  const [error, setError] = useState("");
  const state = useRef({ point, active: false, loop: false, started: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const output = useRef({ remote, onRemote });
  output.current = { remote, onRemote };
  const queue = useRef(Promise.resolve());
  const lastLocal = useRef(0);

  function send(sequence: number[]) {
    if (output.current.remote) {
      previewControllerRhythm(sequence);
      const deliver = output.current.onRemote;
      queue.current = queue.current.then(() => deliver(sequence)).catch(error => {
        stopControllerFeedback(); state.current.active = false; setActive(false); setError(error.message || "Connection lost.");
      });
    } else {
      previewControllerRhythm(sequence);
    }
  }

  function rhythm() {
    const { x, y } = state.current.point;
    const period = Math.round(160 + y * 840);
    const pulse = Math.round(period * (.15 + x * .7));
    const count = Math.ceil(1600 / period);
    return Array.from({ length: count * 2 - 1 }, (_, i) => i % 2 ? period - pulse : pulse);
  }

  function stop() {
    if (!state.current.active) return queue.current;
    state.current.active = false;
    setActive(false);
    if (timer.current) clearTimeout(timer.current);
    send([]);
    return queue.current;
  }

  useImperativeHandle(playbackRef, () => ({ stop }));

  function tick() {
    if (!state.current.active) return;
    const seconds = (Date.now() - state.current.started) / 1000;
    setElapsed(seconds);
    if (!state.current.loop && seconds >= 30) { stop(); return; }
    send(rhythm());
    setTrace(previous => [...previous.slice(-49), 1 - state.current.point.y]);
    timer.current = setTimeout(tick, 800);
  }

  function start() {
    if (!enabled) return;
    setError("");
    state.current.active = true;
    state.current.started = Date.now();
    setActive(true); setElapsed(0); setTrace([]);
    tick();
  }

  function move(next: Point) {
    state.current.point = next; setPoint(next);
    if (state.current.active && !remote && Date.now() - lastLocal.current > 80) {
      lastLocal.current = Date.now(); send(rhythm());
    }
  }

  function drag(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    move({ x: Math.max(0, Math.min(1, ((event.clientX - rect.left) / rect.width - .08) / .84)), y: Math.max(0, Math.min(1, ((event.clientY - rect.top) / rect.height - .12) / .68)) });
  }

  useEffect(() => {
    function leave() { void stop(); }
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      state.current.active = false;
      if (timer.current) clearTimeout(timer.current);
      if (output.current.remote) {
        stopControllerFeedback();
        const deliver = output.current.onRemote;
        void queue.current.then(() => deliver([])).catch(() => {});
      } else stopControllerFeedback();
    };
  }, []);

  const speed = (1000 / (160 + point.y * 840)).toFixed(1);
  const points = trace.map((value, i) => `${i * 6},${75 - value * 60}`).join(" ");

  return <section hidden={hidden} className="live-control" aria-label="Live vibration control">
    <div className="live-title"><span><Icon name="wave" /></span><h2>Live control</h2><span className="live-target">{remote ? "PAIRED PHONE" : "THIS PHONE"}</span></div>
    <div className="live-chart"><div className="chart-heading"><span>{active ? "LIVE RHYTHM" : "PULSE SPEED"}</span><time>{Math.floor(elapsed / 60).toString().padStart(2, "0")}:{Math.floor(elapsed % 60).toString().padStart(2, "0")}</time></div><svg viewBox="0 0 300 90" preserveAspectRatio="none" role="img" aria-label="Recent pulse speed"><polyline points={points || "0,65 300,65"} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg><div className="live-readout"><span>{speed} pulses / second</span><span>{Math.round(15 + point.x * 70)}% pulse time</span></div></div>
    <div className="live-pad" role="group" aria-label="Drag to change vibration rhythm" onPointerDown={event => { if (!enabled) return; event.currentTarget.setPointerCapture(event.pointerId); drag(event); }} onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) drag(event); }} onPointerUp={event => event.currentTarget.releasePointerCapture(event.pointerId)} onPointerCancel={stop}>
      <span className="pad-fast">Fast</span><span className="pad-medium">Medium</span><span className="pad-slow">Slow</span><span className="pad-short">Short pulses</span><span className="pad-long">Long pulses</span>
      <button className="pad-handle" aria-label="Adjust rhythm with arrow keys" style={{ left: `${8 + point.x * 84}%`, top: `${12 + point.y * 68}%` }} onKeyDown={event => { const deltas: Record<string, Point> = { ArrowUp: { x: 0, y: -.05 }, ArrowDown: { x: 0, y: .05 }, ArrowLeft: { x: -.05, y: 0 }, ArrowRight: { x: .05, y: 0 } }; const delta = deltas[event.key]; if (delta) { event.preventDefault(); move({ x: Math.max(0, Math.min(1, point.x + delta.x)), y: Math.max(0, Math.min(1, point.y + delta.y)) }); } }}><Icon name="wave" /></button>
    </div>
    <div className="live-actions"><button className={`loop-toggle ${loop ? "on" : ""}`} aria-pressed={loop} onClick={() => { state.current.loop = !loop; setLoop(!loop); }}><Icon name="loop" /> Loop {loop ? "on" : "off"}</button><button className="live-play" disabled={!enabled} onClick={active ? stop : start}><Icon name={active ? "stop" : "play"} />{active ? "Stop" : "Play"}</button></div>
    <p className="live-help">Drag to change rhythm{remote ? " · Sound previews what you send" : " instantly · Sound preview on"}. {loop ? "Plays until you stop." : "Plays for 30 seconds."} Timing, not motor strength.</p>
    {error && <p className="live-error" role="status">{error}</p>}
  </section>;
}
