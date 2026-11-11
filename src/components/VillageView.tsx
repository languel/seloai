import React, { useEffect, useRef, useState } from 'react';
import {
  Bug,
  Compass,
  Headphones,
  Mic,
  MicOff,
  Pause,
  Play,
  Send,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { brainRouter } from '../ai/brainRouter';
import { omniEngine } from '../ai/omniEngine';
import { MicRecorder } from '../ai/audioPipeline';
import {
  drawAnimatedSprites,
  drawPlayer,
  drawTileGrid,
  drawVillager,
  getCachedImage,
} from '../engine/renderer';
import type { VillageSimulation } from '../engine/simulation';
import type { ModelSettings, VillagerConfig, VillagerRuntime } from '../engine/types';

interface VillageViewProps {
  sim: VillageSimulation;
  villagers: VillagerConfig[];
  settings: ModelSettings;
  onUpdateSettings: (patch: Partial<ModelSettings>) => void;
  onOpenMonitor: () => void;
}

export const VillageView: React.FC<VillageViewProps> = ({
  sim,
  villagers,
  settings,
  onUpdateSettings,
  onOpenMonitor,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [selectedId, setSelectedId] = useState<string>(villagers[0]?.id ?? '');
  const [tick, setTick] = useState(0);
  const [showPaths, setShowPaths] = useState(false);
  const [followSelected, setFollowSelected] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const cameraRef = useRef({ x: 0, y: 0, zoom: 1.15 });
  const dragRef = useRef<{ active: boolean; moved: boolean; lastX: number; lastY: number }>({
    active: false,
    moved: false,
    lastX: 0,
    lastY: 0,
  });
  const keysRef = useRef(new Set<string>());
  const recorderRef = useRef<MicRecorder | null>(null);

  useEffect(() => {
    if (!villagers.some((v) => v.id === selectedId) && villagers[0]) {
      setSelectedId(villagers[0].id);
    }
  }, [villagers, selectedId]);

  useEffect(() => {
    const unsub = sim.subscribe(() => setTick((t) => t + 1));
    return unsub;
  }, [sim]);

  // Center camera initially
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const worldW = sim.map.width * sim.map.tileDim;
    const worldH = sim.map.height * sim.map.tileDim;
    cameraRef.current.x = worldW / 2;
    cameraRef.current.y = worldH / 2;
  }, [sim.map.width, sim.map.height, sim.map.tileDim]);

  // Keyboard movement (WASD / Arrows) when not typing in input
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', 'W', 'A', 'S', 'D'].includes(e.key)) {
        keysRef.current.add(e.key.toLowerCase());
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.key.toLowerCase());
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // Main 60fps simulation + render loop
  useEffect(() => {
    let rafId = 0;
    let lastTime = performance.now();

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      // Keyboard player nudge
      const keys = keysRef.current;
      let dx = 0;
      let dy = 0;
      if (keys.has('arrowleft') || keys.has('a')) dx -= 1;
      if (keys.has('arrowright') || keys.has('d')) dx += 1;
      if (keys.has('arrowup') || keys.has('w')) dy -= 1;
      if (keys.has('arrowdown') || keys.has('s')) dy += 1;
      if (dx !== 0 || dy !== 0) {
        const len = Math.hypot(dx, dy);
        sim.nudgePlayer(dx / len, dy / len, dt);
      }

      sim.stepFrame(dt);

      if (recorderRef.current?.active) {
        setMicLevel(recorderRef.current.readLevel());
      }

      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(1, Math.round(rect.width * dpr));
        const h = Math.max(1, Math.round(rect.height * dpr));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.imageSmoothingEnabled = false;

          if (followSelected && selectedId) {
            const rt = sim.runtimes.get(selectedId);
            if (rt) {
              const tx = (rt.x + 0.5) * sim.map.tileDim;
              const ty = (rt.y + 0.5) * sim.map.tileDim;
              cameraRef.current.x += (tx - cameraRef.current.x) * 0.12;
              cameraRef.current.y += (ty - cameraRef.current.y) * 0.12;
            }
          }

          renderWorld(ctx, rect.width, rect.height, now / 1000);
        }
      }

      rafId = requestAnimationFrame(frame);
    };

    const renderWorld = (ctx: CanvasRenderingContext2D, viewW: number, viewH: number, timeSec: number) => {
      ctx.fillStyle = '#18211b';
      ctx.fillRect(0, 0, viewW, viewH);

      const cam = cameraRef.current;
      ctx.save();
      ctx.translate(viewW / 2, viewH / 2);
      ctx.scale(cam.zoom, cam.zoom);
      ctx.translate(-cam.x, -cam.y);

      const map = sim.map;
      const tilesetImg = getCachedImage(map.tileSetUrl);
      const tilesetCols = Math.max(1, Math.floor(map.tileSetDimX / map.tileDim));

      if (tilesetImg) {
        for (const layer of map.bgTiles) {
          drawTileGrid(ctx, tilesetImg, layer, map.tileDim, tilesetCols);
        }
        for (const layer of map.objectTiles) {
          drawTileGrid(ctx, tilesetImg, layer, map.tileDim, tilesetCols);
        }
      }

      drawAnimatedSprites(ctx, map, timeSec);

      // Subtle spatial hearing radius ring around player when proximity audio is enabled
      if (sim.modelSettings.proximityAudioEnabled) {
        ctx.save();
        ctx.strokeStyle = 'rgba(31, 181, 201, 0.28)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.arc(
          (sim.player.x + 0.5) * map.tileDim,
          (sim.player.y + 0.5) * map.tileDim,
          sim.modelSettings.proximityRadiusTiles * map.tileDim,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
        ctx.restore();
      }

      // Debug paths
      if (showPaths) {
        ctx.save();
        for (const rt of sim.runtimes.values()) {
          if (rt.path.length === 0) continue;
          const cfg = sim.configs.get(rt.id);
          ctx.strokeStyle = cfg?.accentColor || '#e6a945';
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo((rt.x + 0.5) * map.tileDim, (rt.y + 0.5) * map.tileDim);
          for (const pt of rt.path) {
            ctx.lineTo((pt.x + 0.5) * map.tileDim, (pt.y + 0.5) * map.tileDim);
          }
          ctx.stroke();
        }
        ctx.restore();
      }

      // Y-sort entities (villagers + player)
      const entities: Array<{ y: number; draw: () => void }> = [];
      for (const rt of sim.runtimes.values()) {
        const cfg = sim.configs.get(rt.id);
        if (!cfg) continue;
        entities.push({
          y: rt.y,
          draw: () => drawVillager(ctx, cfg, rt, map.tileDim, rt.id === selectedId),
        });
      }
      entities.push({
        y: sim.player.y,
        draw: () => drawPlayer(ctx, sim.player, map.tileDim),
      });
      entities.sort((a, b) => a.y - b.y);
      for (const ent of entities) ent.draw();

      ctx.restore();
    };

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, [sim, selectedId, showPaths, followSelected]);

  const screenToWorld = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { wx: 0, wy: 0 };
    const rect = canvas.getBoundingClientRect();
    const cam = cameraRef.current;
    const wx = (clientX - rect.left - rect.width / 2) / cam.zoom + cam.x;
    const wy = (clientY - rect.top - rect.height / 2) / cam.zoom + cam.y;
    return { wx, wy };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = { active: true, moved: false, lastX: e.clientX, lastY: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.lastX;
    const dy = e.clientY - dragRef.current.lastY;
    if (Math.hypot(dx, dy) > 4) {
      dragRef.current.moved = true;
      setFollowSelected(false);
    }
    cameraRef.current.x -= dx / cameraRef.current.zoom;
    cameraRef.current.y -= dy / cameraRef.current.zoom;
    dragRef.current.lastX = e.clientX;
    dragRef.current.lastY = e.clientY;
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current.active) return;
    const wasClick = !dragRef.current.moved;
    dragRef.current.active = false;
    if (!wasClick) return;

    const { wx, wy } = screenToWorld(e.clientX, e.clientY);
    const tileX = wx / sim.map.tileDim;
    const tileY = wy / sim.map.tileDim;

    // Hit-test villagers first
    let clickedVillager: VillagerRuntime | null = null;
    let bestDist = 1.1;
    for (const rt of sim.runtimes.values()) {
      const d = Math.hypot(rt.x + 0.5 - tileX, rt.y + 0.5 - tileY);
      if (d < bestDist) {
        bestDist = d;
        clickedVillager = rt;
      }
    }

    if (clickedVillager) {
      setSelectedId(clickedVillager.id);
    } else {
      sim.movePlayerTo(Math.floor(tileX), Math.floor(tileY));
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    cameraRef.current.zoom = Math.min(3.5, Math.max(0.45, cameraRef.current.zoom * factor));
  };

  const selectedCfg = villagers.find((v) => v.id === selectedId);
  const selectedRt = selectedCfg ? sim.runtimes.get(selectedCfg.id) : undefined;
  const activeConversation = selectedCfg
    ? sim.conversations.find((c) => c.participantIds.includes(selectedCfg.id))
    : undefined;

  const handleSendText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCfg || !chatInput.trim() || sending) return;
    const text = chatInput.trim();
    setChatInput('');
    setSending(true);
    setVoiceError(null);
    try {
      await sim.sendUserTextToVillager(
        selectedCfg.id,
        text,
        settings.enableOmniTts || settings.enableWebSpeechFallback,
      );
    } catch (err: any) {
      setVoiceError(err?.message || String(err));
    } finally {
      setSending(false);
    }
  };

  const toggleVoiceRecording = async () => {
    setVoiceError(null);
    if (recording && recorderRef.current) {
      setRecording(false);
      setMicLevel(0);
      try {
        const { audioBuffer, duration } = await recorderRef.current.stop();
        if (duration < 0.3) {
          setVoiceError('Recording too short — hold or speak for at least half a second.');
          return;
        }
        if (!selectedCfg) return;
        setSending(true);
        await sim.sendUserVoiceToVillager(selectedCfg.id, audioBuffer);
      } catch (err: any) {
        setVoiceError(err?.message || String(err));
      } finally {
        setSending(false);
      }
      return;
    }

    if (!omniEngine.isReady()) {
      setVoiceError('LFM3-Omni-2B is not loaded yet. Open AI Monitor to load it for WebGPU STT + TTS.');
      return;
    }

    try {
      const rec = new MicRecorder();
      await rec.start();
      recorderRef.current = rec;
      setRecording(true);
    } catch {
      setVoiceError('Microphone permission denied or unavailable.');
    }
  };

  const centerOnSelected = () => {
    if (!selectedRt) return;
    cameraRef.current.x = (selectedRt.x + 0.5) * sim.map.tileDim;
    cameraRef.current.y = (selectedRt.y + 0.5) * sim.map.tileDim;
  };

  // Suppress unused tick warning while keeping live reactivity
  void tick;

  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-[1fr_390px] overflow-hidden">
      {/* Left: Interactive Village World */}
      <section className="relative flex flex-col overflow-hidden bg-stone-900" aria-label="Village Canvas">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onWheel={handleWheel}
          className="pixel-canvas h-full w-full cursor-grab active:cursor-grabbing touch-none"
        />

        {/* Floating Top-Left Simulation Controls */}
        <div className="absolute left-3 top-3 flex flex-wrap items-center gap-1.5 rounded-lg border border-borderFolk bg-card/90 px-2.5 py-1.5 shadow-md backdrop-blur">
          <button
            type="button"
            onClick={() => {
              sim.paused = !sim.paused;
              setTick((t) => t + 1);
            }}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium hover:bg-surface"
            aria-label={sim.paused ? 'Resume simulation' : 'Pause simulation'}
          >
            {sim.paused ? <Play className="h-3.5 w-3.5 text-sage" /> : <Pause className="h-3.5 w-3.5 text-crimson" />}
            <span>{sim.paused ? 'Resume' : 'Pause'}</span>
          </button>

          <div className="h-4 w-px bg-borderFolk" />

          {[1, 2, 4].map((spd) => (
            <button
              key={spd}
              type="button"
              onClick={() => {
                sim.speedMultiplier = spd;
                setTick((t) => t + 1);
              }}
              className={`rounded px-2 py-0.5 text-xs font-mono ${
                sim.speedMultiplier === spd ? 'bg-crimson text-white' : 'hover:bg-surface text-muted'
              }`}
            >
              {spd}×
            </button>
          ))}

          <div className="h-4 w-px bg-borderFolk" />

          <button
            type="button"
            onClick={() => (cameraRef.current.zoom = Math.min(3.5, cameraRef.current.zoom + 0.25))}
            className="rounded p-1 hover:bg-surface"
            aria-label="Zoom in"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => (cameraRef.current.zoom = Math.max(0.45, cameraRef.current.zoom - 0.25))}
            className="rounded p-1 hover:bg-surface"
            aria-label="Zoom out"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setShowPaths((p) => !p)}
            aria-pressed={showPaths}
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${
              showPaths ? 'bg-indigoFolk text-white' : 'hover:bg-surface'
            }`}
          >
            <Bug className="h-3.5 w-3.5" />
            <span>Paths</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setFollowSelected((f) => !f);
              centerOnSelected();
            }}
            aria-pressed={followSelected}
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${
              followSelected ? 'bg-ochre text-white' : 'hover:bg-surface'
            }`}
          >
            <Compass className="h-3.5 w-3.5" />
            <span>Follow</span>
          </button>
          <button
            type="button"
            onClick={() => {
              const next = !settings.proximityAudioEnabled;
              if (!next) {
                brainRouter.stopSpeech();
              }
              onUpdateSettings({ proximityAudioEnabled: next });
            }}
            aria-pressed={settings.proximityAudioEnabled}
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${
              settings.proximityAudioEnabled ? 'bg-sage text-white' : 'hover:bg-surface'
            }`}
          >
            <Headphones className="h-3.5 w-3.5" />
            <span>Eavesdrop {settings.proximityAudioEnabled ? 'On' : 'Off'}</span>
          </button>
        </div>

        {/* Bottom-left quick controls hint */}
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-borderFolk bg-card/85 px-3 py-1.5 text-xs text-muted backdrop-blur">
          Click villager to inspect · Click ground or <kbd className="font-mono">WASD</kbd> to walk · Drag to pan · Scroll to zoom
        </div>
      </section>

      {/* Right: Villager Inspector + Voice & Chat */}
      <aside className="flex flex-col border-l border-borderFolk bg-surface overflow-hidden" aria-label="Villager Inspector">
        {/* Villager Quick Roster */}
        <div className="border-b border-borderFolk bg-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
              Villagers ({villagers.length})
            </h2>
            <span className="font-mono text-[11px] text-muted">{sim.fps} FPS</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {villagers.map((v) => {
              const rt = sim.runtimes.get(v.id);
              const active = v.id === selectedId;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setSelectedId(v.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                    active
                      ? 'border-crimson bg-crimson text-white'
                      : 'border-borderFolk bg-surface text-ink hover:border-crimson/60'
                  }`}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: active ? '#fff' : v.accentColor }}
                  />
                  <span>{v.name}</span>
                  {rt?.state === 'thinking' && <span className="text-[10px] opacity-80">…</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected Villager Details */}
        {selectedCfg && selectedRt ? (
          <>
            <div className="border-b border-borderFolk bg-card/60 p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold leading-tight">{selectedCfg.name}</h3>
                  <p className="text-xs text-muted">{selectedCfg.role}</p>
                </div>
                <span className="rounded-full border border-borderFolk bg-surface px-2 py-0.5 text-[11px] font-medium capitalize">
                  {selectedRt.state}
                </span>
              </div>
              <p className="text-xs leading-relaxed text-ink/90">{selectedCfg.identity}</p>
              <div className="rounded border border-borderFolk bg-surface/80 px-2.5 py-1.5 text-xs">
                <span className="font-semibold text-ochre">Plan:</span> {selectedCfg.plan}
              </div>

              <details className="text-xs">
                <summary className="cursor-pointer font-medium text-indigoFolk hover:underline">
                  Recent Memories ({selectedRt.memories.length})
                </summary>
                <ul className="mt-1.5 max-h-28 space-y-1 overflow-y-auto thin-scroll pr-1">
                  {[...selectedRt.memories].reverse().slice(0, 8).map((m) => (
                    <li key={m.id} className="rounded bg-card px-2 py-1 text-[11px] border border-borderFolk/60">
                      {m.summary}
                    </li>
                  ))}
                </ul>
              </details>
            </div>

            {/* Active Conversation Stream */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5 thin-scroll">
              <div className="flex items-center justify-between text-xs text-muted">
                <span className="font-semibold uppercase tracking-wider">Conversation</span>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateSettings({
                      enableOmniTts: !settings.enableOmniTts,
                    })
                  }
                  aria-pressed={settings.enableOmniTts}
                  className="inline-flex items-center gap-1 rounded border border-borderFolk bg-card px-2 py-0.5 text-[11px] hover:bg-surface"
                >
                  {settings.enableOmniTts ? (
                    <Volume2 className="h-3 w-3 text-sage" />
                  ) : (
                    <VolumeX className="h-3 w-3 text-muted" />
                  )}
                  <span>Voice Reply {settings.enableOmniTts ? 'On' : 'Off'}</span>
                </button>
              </div>

              {!activeConversation || activeConversation.messages.length === 0 ? (
                <div className="rounded-lg border border-dashed border-borderFolk p-4 text-center text-xs text-muted">
                  Say hello to <strong>{selectedCfg.name}</strong> below, or speak with your microphone using{' '}
                  <strong>LFM3-Omni-2B</strong>.
                </div>
              ) : (
                <ul className="space-y-2">
                  {activeConversation.messages.map((msg) => {
                    const isHuman = msg.senderId === sim.player.id;
                    const isNarration = msg.kind === 'narration' || msg.senderId === 'narrator';
                    return (
                      <li
                        key={msg.id}
                        className={`rounded-lg border px-3 py-2 text-xs ${
                          isNarration
                            ? 'border-ochre/40 bg-ochre/10 italic'
                            : isHuman
                              ? 'ml-4 border-indigoFolk/40 bg-indigoFolk/10'
                              : 'mr-2 border-borderFolk bg-card'
                        }`}
                      >
                        <div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-muted not-italic">
                          <span className="font-semibold text-ink">{msg.senderName}</span>
                          <span className="rounded bg-surface px-1.5 py-0.5 font-mono uppercase">
                            {isNarration ? 'scribe' : msg.source}
                          </span>
                        </div>
                        <p className="leading-relaxed whitespace-pre-wrap">{msg.text || '…'}</p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Composer & LFM3-Omni Voice Input */}
            <div className="border-t border-borderFolk bg-card p-3 space-y-2">
              {voiceError && (
                <div role="alert" className="flex items-center justify-between gap-2 rounded border border-crimson/50 bg-crimson/10 px-2.5 py-1.5 text-[11px] text-crimson">
                  <span>{voiceError}</span>
                  {!omniEngine.isReady() && (
                    <button
                      type="button"
                      onClick={onOpenMonitor}
                      className="shrink-0 underline font-semibold"
                    >
                      Open Monitor
                    </button>
                  )}
                </div>
              )}

              {recording && (
                <div className="flex items-center gap-2 rounded bg-surface px-2.5 py-1.5 text-xs">
                  <span className="h-2 w-2 rounded-full bg-crimson animate-pulse" />
                  <span className="font-medium">Listening…</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-borderFolk/40">
                    <div
                      className="h-full bg-crimson transition-all duration-75"
                      style={{ width: `${Math.round(micLevel * 100)}%` }}
                    />
                  </div>
                </div>
              )}

              <form onSubmit={handleSendText} className="flex items-end gap-2">
                <div className="flex-1">
                  <label htmlFor="village-chat-input" className="visually-hidden">
                    Message {selectedCfg.name}
                  </label>
                  <textarea
                    id="village-chat-input"
                    rows={2}
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        handleSendText(e);
                      }
                    }}
                    placeholder={`Talk to ${selectedCfg.name}…`}
                    className="w-full resize-none rounded-md border border-borderFolk bg-surface px-2.5 py-1.5 text-xs text-ink placeholder:text-muted"
                  />
                </div>

                <button
                  type="button"
                  onClick={toggleVoiceRecording}
                  aria-pressed={recording}
                  aria-label={recording ? 'Stop voice recording and send' : 'Talk with microphone'}
                  className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition ${
                    recording
                      ? 'border-crimson bg-crimson text-white'
                      : 'border-borderFolk bg-surface text-ink hover:border-crimson'
                  }`}
                >
                  {recording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </button>

                <button
                  type="submit"
                  disabled={sending || !chatInput.trim()}
                  aria-label="Send message"
                  className="inline-flex h-9 shrink-0 items-center gap-1 rounded-md bg-crimson px-3 text-xs font-semibold text-white hover:opacity-95 disabled:opacity-45"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>Send</span>
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="p-6 text-center text-xs text-muted">No villagers in the village yet.</div>
        )}
      </aside>
    </div>
  );
};
