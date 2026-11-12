import React, { useEffect, useRef, useState } from 'react';
import {
  Bug,
  ChevronDown,
  ChevronRight,
  Compass,
  Headphones,
  LayoutList,
  Mic,
  MicOff,
  Pause,
  Play,
  RotateCcw,
  Send,
  Shuffle,
  Tag,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { brainRouter } from '../ai/brainRouter';
import { omniEngine } from '../ai/omniEngine';
import {
  computeSpatialMix,
  EAVESDROP_SLIDER_MAX,
  EAVESDROP_WHOLE_MAP_RADIUS,
  isWholeMapEavesdrop,
  MicRecorder,
} from '../ai/audioPipeline';
import {
  drawAnimatedSprites,
  drawPlayer,
  drawTileGrid,
  drawVillager,
  getCachedImage,
  getCustomSpriteFrame,
  getPresetSpriteFrame,
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

interface MentionCandidate {
  id: string;
  name: string;
  role: string;
  accentColor: string;
  prefix?: '@' | '#';
  statusHint?: string;
  searchAliases?: string;
}

function findActiveMention(
  text: string,
  caret: number,
): { trigger: '@' | '#'; start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = before.match(/(?:^|\s)([@#])([^\s\n@#]*)$/);
  if (!match) return null;
  const trigger = match[1] as '@' | '#';
  const idx = before.lastIndexOf(trigger);
  return { trigger, start: idx, query: match[2] };
}

const VillagerAvatarThumb: React.FC<{ villager: VillagerConfig; size?: number }> = ({
  villager,
  size = 28,
}) => {
  const thumbRef = useRef<HTMLCanvasElement | null>(null);
  const frame = villager.customSprite
    ? getCustomSpriteFrame(villager.customSprite, 'down', 0, false)
    : getPresetSpriteFrame(villager.spritesheetId, 'down', 0, false);

  useEffect(() => {
    const canvas = thumbRef.current;
    if (!canvas || !frame) return;
    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, size, size);
      const img = getCachedImage(frame.url);
      if (img) {
        ctx.drawImage(img, frame.sx, frame.sy, frame.sw, frame.sh, 0, 0, size, size);
      } else {
        ctx.fillStyle = villager.accentColor;
        ctx.fillRect(4, 4, size - 8, size - 8);
        const preload = new Image();
        preload.onload = () => draw();
        preload.src = frame.url;
      }
    };
    draw();
  }, [frame?.url, frame?.sx, frame?.sy, frame?.sw, frame?.sh, villager.accentColor, size]);

  return (
    <canvas
      ref={thumbRef}
      width={size}
      height={size}
      className="pixel-canvas shrink-0 rounded border border-borderFolk/70 bg-stone-900/20"
      style={{ width: size, height: size }}
    />
  );
};

export const VillageView: React.FC<VillageViewProps> = ({
  sim,
  villagers,
  settings,
  onUpdateSettings,
  onOpenMonitor,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [selectedId, setSelectedId] = useState<string>(villagers[0]?.id ?? 'narrator');
  const [tick, setTick] = useState(0);
  const [showPaths, setShowPaths] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [rosterView, setRosterView] = useState<'cards' | 'compact'>('cards');
  const [rosterCollapsed, setRosterCollapsed] = useState(false);
  const [detailCollapsed, setDetailCollapsed] = useState(false);
  const [scriptCollapsed, setScriptCollapsed] = useState(false);
  const [followSelected, setFollowSelected] = useState(false);
  const [feedMode, setFeedMode] = useState<'hearing' | 'focused' | 'village'>('hearing');
  const [filterSpeech, setFilterSpeech] = useState(true);
  const [filterScribe, setFilterScribe] = useState(true);
  const [filterThoughts, setFilterThoughts] = useState(true);
  const [filterHuman, setFilterHuman] = useState(true);
  const [scriptActorFilter, setScriptActorFilter] = useState<string>('all');
  const [scriptSearch, setScriptSearch] = useState('');
  const [activeSpeech, setActiveSpeech] = useState(brainRouter.activeSpeechInfo);
  const [chatInput, setChatInput] = useState('');
  const [mentionMatch, setMentionMatch] = useState<{ trigger: '@' | '#'; start: number; query: string } | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem('seloai:sidebar-width'));
      if (Number.isFinite(saved) && saved >= 260 && saved <= 760) return saved;
    } catch {
      // ignore storage errors
    }
    return 360;
  });

  const handleSidebarResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev: PointerEvent) => {
      const maxW = Math.max(360, Math.min(760, window.innerWidth - 260));
      const next = Math.max(260, Math.min(maxW, startW + (startX - ev.clientX)));
      setSidebarWidth(next);
    };
    const onUp = (ev: PointerEvent) => {
      const maxW = Math.max(360, Math.min(760, window.innerWidth - 260));
      const finalW = Math.max(260, Math.min(maxW, startW + (startX - ev.clientX)));
      setSidebarWidth(finalW);
      try {
        localStorage.setItem('seloai:sidebar-width', String(Math.round(finalW)));
      } catch {
        // ignore storage errors
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

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
    if (selectedId !== 'narrator' && !villagers.some((v) => v.id === selectedId) && villagers[0]) {
      setSelectedId(villagers[0].id);
    }
  }, [villagers, selectedId]);

  useEffect(() => {
    const unsub = sim.subscribe(() => setTick((t) => t + 1));
    return unsub;
  }, [sim]);

  useEffect(() => {
    return brainRouter.subscribeSpeechState(setActiveSpeech);
  }, []);

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

      // Subtle spatial hearing radius ring around player when eavesdrop radius > 0 (hidden for Whole Map)
      if (
        sim.modelSettings.proximityRadiusTiles > 0 &&
        !isWholeMapEavesdrop(sim.modelSettings.proximityRadiusTiles)
      ) {
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

      // Points of Interest (#Tag markers) when labels are enabled
      if (showLabels && (map.pointsOfInterest ?? []).length > 0) {
        ctx.save();
        ctx.font = '700 10px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const poi of map.pointsOfInterest ?? []) {
          const cx = (poi.x + 0.5) * map.tileDim;
          const cy = (poi.y + 0.5) * map.tileDim;
          ctx.fillStyle = 'rgba(217, 119, 6, 0.9)';
          ctx.strokeStyle = '#fffbeb';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(cx, cy - 6);
          ctx.lineTo(cx + 6, cy);
          ctx.lineTo(cx, cy + 6);
          ctx.lineTo(cx - 6, cy);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          const tagText = `#${poi.tag}`;
          const tw = ctx.measureText(tagText).width + 10;
          ctx.fillStyle = 'rgba(24, 22, 20, 0.78)';
          ctx.beginPath();
          ctx.roundRect(cx - tw / 2, cy - 22, tw, 14, 4);
          ctx.fill();
          ctx.fillStyle = '#fde68a';
          ctx.fillText(tagText, cx, cy - 14.5);
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
          draw: () => drawVillager(ctx, cfg, rt, map.tileDim, rt.id === selectedId, showLabels),
        });
      }
      entities.push({
        y: sim.player.y,
        draw: () => drawPlayer(ctx, sim.player, map.tileDim, showLabels),
      });
      entities.sort((a, b) => a.y - b.y);
      for (const ent of entities) ent.draw();

      ctx.restore();
    };

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, [sim, selectedId, showPaths, showLabels, followSelected]);

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

  const narratorName = settings.narratorName.trim() || 'Scribe';
  const isScribeSelected = selectedId === 'narrator';
  const selectedCfg = isScribeSelected ? undefined : villagers.find((v) => v.id === selectedId);
  const selectedRt = selectedCfg ? sim.runtimes.get(selectedCfg.id) : undefined;
  const activeConversation = isScribeSelected
    ? sim.conversations.find((c) => c.participantIds.includes('narrator')) ??
      sim.conversations.find((c) => c.messages.some((m) => m.kind === 'narration'))
    : selectedCfg
      ? sim.conversations.find((c) => c.participantIds.includes(selectedCfg.id))
      : undefined;

  const listenerPos = sim.getListenerPosition();
  const isSpeakerAudible = (senderId: string, participantIds: string[]) => {
    if (settings.proximityRadiusTiles <= 0) return false;
    if (isWholeMapEavesdrop(settings.proximityRadiusTiles)) return true;
    const rt =
      sim.runtimes.get(senderId) ??
      participantIds.map((id) => sim.runtimes.get(id)).find((r) => Boolean(r));
    if (!rt) return true;
    return computeSpatialMix(
      rt.x,
      rt.y,
      listenerPos.x,
      listenerPos.y,
      settings.proximityRadiusTiles,
    ).inRange;
  };

  const rawScriptMessages = (() => {
    if (feedMode === 'focused') {
      return activeConversation?.messages ?? [];
    }
    const merged = sim.conversations.flatMap((conv) =>
      conv.messages.map((msg) => ({ msg, participantIds: conv.participantIds })),
    );
    merged.sort((a, b) => a.msg.timestamp - b.msg.timestamp);
    const recent = merged.slice(-140);
    if (feedMode === 'hearing') {
      return recent
        .filter(
          ({ msg, participantIds }) =>
            msg.senderId === sim.player.id ||
            (activeSpeech && msg.senderId === activeSpeech.speakerId && msg.text.includes(activeSpeech.text.slice(0, 24))) ||
            isSpeakerAudible(msg.senderId, participantIds),
        )
        .map((x) => x.msg);
    }
    return recent.map((x) => x.msg);
  })();

  const displayedMessages = rawScriptMessages.filter((msg) => {
    const isHuman = msg.senderId === sim.player.id;
    const isNarration = msg.kind === 'narration' || msg.senderId === 'narrator';
    const isThought = msg.kind === 'thought';
    if (isHuman && !filterHuman) return false;
    if (isNarration && !filterScribe) return false;
    if (isThought && !filterThoughts) return false;
    if (!isHuman && !isNarration && !isThought && !filterSpeech) return false;
    if (scriptActorFilter !== 'all' && msg.senderId !== scriptActorFilter) return false;
    if (scriptSearch.trim()) {
      const q = scriptSearch.trim().toLowerCase();
      if (!`${msg.senderName} ${msg.text} ${msg.reasoning ?? ''}`.toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  });

  const mentionCandidates: MentionCandidate[] = [
    {
      id: 'all',
      name: 'all',
      role: 'Broadcast instruction to every villager (@world)',
      accentColor: '#2a9d8f',
      statusHint: `${villagers.length} folk`,
      searchAliases: 'all world everyone village',
    },
    {
      id: 'world',
      name: 'world',
      role: 'Broadcast instruction across Selo (@all)',
      accentColor: '#2a9d8f',
      statusHint: `${villagers.length} folk`,
      searchAliases: 'world all everyone village',
    },
    {
      id: 'narrator',
      name: narratorName,
      role: `Narrator (${settings.narratorStyle})`,
      accentColor: '#c98a3b',
      statusHint: settings.narratorEnabled ? 'voice on' : 'text',
    },
    ...villagers.map((v) => ({
      id: v.id,
      name: v.name,
      role: v.role,
      accentColor: v.accentColor,
      statusHint: sim.runtimes.get(v.id)?.state,
    })),
  ];

  const poiCandidates: MentionCandidate[] = (sim.map.pointsOfInterest ?? []).map((p) => ({
    id: `poi-${p.id}`,
    name: p.tag,
    role: p.description ? `${p.label} — ${p.description}` : p.label,
    accentColor: '#d97706',
    prefix: '#',
    statusHint: `(${p.x}, ${p.y})`,
    searchAliases: `${p.tag} ${p.label} ${p.description ?? ''}`,
  }));

  const activePool = mentionMatch?.trigger === '#' ? poiCandidates : mentionCandidates;
  const filteredMentions = mentionMatch
    ? activePool.filter((c) => {
        const q = mentionMatch.query.toLowerCase();
        return (
          c.name.toLowerCase().includes(q) ||
          c.role.toLowerCase().includes(q) ||
          Boolean(c.searchAliases?.toLowerCase().includes(q))
        );
      })
    : [];
  const isMentionMenuOpen = Boolean(mentionMatch && filteredMentions.length > 0);
  const clampedMentionIdx =
    filteredMentions.length > 0 ? Math.min(mentionIdx, filteredMentions.length - 1) : 0;

  const insertMentionCandidate = (cand: MentionCandidate) => {
    const start = mentionMatch?.start ?? chatInput.length;
    const caret = textareaRef.current?.selectionStart ?? chatInput.length;
    const before = chatInput.slice(0, start);
    const after = chatInput.slice(caret);
    const inserted = `${cand.prefix ?? '@'}${cand.name} `;
    const nextText = `${before}${inserted}${after}`;
    setChatInput(nextText);
    setMentionMatch(null);
    setMentionIdx(0);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const nextCaret = before.length + inserted.length;
      el.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const handleChatChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    setChatInput(next);
    const match = findActiveMention(next, e.target.selectionStart ?? next.length);
    setMentionMatch(match);
    setMentionIdx(0);
  };

  const insertTriggerChar = (trigger: '@' | '#') => {
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? chatInput.length;
    const needsSpace = caret > 0 && !/\s$/.test(chatInput.slice(0, caret));
    const inserted = `${needsSpace ? ' ' : ''}${trigger}`;
    const nextText = `${chatInput.slice(0, caret)}${inserted}${chatInput.slice(caret)}`;
    const nextCaret = caret + inserted.length;
    setChatInput(nextText);
    setMentionMatch(findActiveMention(nextText, nextCaret));
    setMentionIdx(0);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const handleTriggerAtMention = () => insertTriggerChar('@');
  const handleTriggerHashMention = () => insertTriggerChar('#');

  const handleSendText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || sending) return;
    const text = chatInput.trim();
    setChatInput('');
    setMentionMatch(null);
    setSending(true);
    setVoiceError(null);
    try {
      const res = await sim.sendUserAddressedMessage(
        selectedId || undefined,
        text,
        settings.enableOmniTts || settings.enableWebSpeechFallback,
      );
      if (res.focusedTargetId) {
        setSelectedId(res.focusedTargetId);
      }
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
    <div
      className="flex h-full flex-col lg:flex-row overflow-hidden"
      style={{ '--sidebar-w': `${sidebarWidth}px` } as React.CSSProperties}
    >
      {/* Left: Interactive Village World */}
      <section className="relative flex flex-1 min-w-0 min-h-0 flex-col overflow-hidden bg-neutral-900" aria-label="Village Canvas">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onWheel={handleWheel}
          className="pixel-canvas h-full w-full cursor-grab active:cursor-grabbing touch-none"
        />

        {/* Floating Top-Left Simulation Controls */}
        <div
          role="toolbar"
          aria-label="Village simulation controls"
          className="absolute left-2 top-2 flex flex-wrap items-center gap-1 rounded-sm border border-borderFolk bg-card/95 px-1.5 py-1 backdrop-blur"
        >
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
            onClick={() => setShowLabels((l) => !l)}
            aria-pressed={showLabels}
            title="Toggle character and #POI labels on map"
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${
              showLabels ? 'bg-sage/20 text-ink font-medium' : 'hover:bg-surface text-muted'
            }`}
          >
            <Tag className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Labels</span>
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
            <Compass className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Follow</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (!isScribeSelected && selectedCfg) {
                sim.setFocalWorldline(
                  sim.focalWorldlineId === selectedCfg.id ? 'traveler' : selectedCfg.id,
                );
                setTick((t) => t + 1);
              } else {
                sim.setFocalWorldline('traveler');
                setTick((t) => t + 1);
              }
            }}
            aria-pressed={sim.focalWorldlineId !== 'traveler'}
            title="Hop Scribe & spatial audio POV to selected character (or click again to return to You)"
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${
              sim.focalWorldlineId !== 'traveler'
                ? 'bg-crimson text-white'
                : 'hover:bg-surface text-muted'
            }`}
          >
            <span>
              POV:{' '}
              {sim.focalWorldlineId === 'traveler'
                ? 'You'
                : sim.configs.get(sim.focalWorldlineId)?.name ?? 'Char'}
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              sim.scatterVillagers();
              setTick((t) => t + 1);
            }}
            title="Unstick and scatter villagers around the map"
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-surface"
          >
            <Shuffle className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Scatter</span>
          </button>
          <div
            role="group"
            aria-label="Eavesdrop distance"
            className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs transition ${
              settings.proximityRadiusTiles > 0 ? 'bg-sage/15 text-ink' : 'text-muted'
            }`}
          >
            <Headphones
              className={`h-3.5 w-3.5 shrink-0 ${
                settings.proximityRadiusTiles > 0 ? 'text-sage' : 'text-muted'
              }`}
              aria-hidden="true"
            />
            <label htmlFor="village-eavesdrop-radius" className="whitespace-nowrap font-medium">
              Eavesdrop
            </label>
            <input
              id="village-eavesdrop-radius"
              type="range"
              min={0}
              max={EAVESDROP_SLIDER_MAX}
              step={1}
              value={
                isWholeMapEavesdrop(settings.proximityRadiusTiles)
                  ? EAVESDROP_SLIDER_MAX
                  : Math.max(0, Math.min(EAVESDROP_SLIDER_MAX - 1, Math.round(settings.proximityRadiusTiles)))
              }
              aria-valuetext={
                settings.proximityRadiusTiles <= 0
                  ? 'Off'
                  : isWholeMapEavesdrop(settings.proximityRadiusTiles)
                    ? 'Whole map'
                    : `${settings.proximityRadiusTiles} tiles`
              }
              onChange={(e) => {
                const raw = Number(e.target.value);
                const nextRadius = raw >= EAVESDROP_SLIDER_MAX ? EAVESDROP_WHOLE_MAP_RADIUS : raw;
                if (nextRadius <= 0) {
                  brainRouter.stopSpeech();
                }
                onUpdateSettings({ proximityRadiusTiles: nextRadius });
              }}
              className="w-20 cursor-pointer accent-sage"
              title="Eavesdrop hearing radius (0 = Off, right end = Whole Map)"
            />
            <span className="w-7 text-right font-mono text-[11px]">
              {settings.proximityRadiusTiles <= 0
                ? 'Off'
                : isWholeMapEavesdrop(settings.proximityRadiusTiles)
                  ? 'All'
                  : `${settings.proximityRadiusTiles}t`}
            </span>
            <button
              type="button"
              onClick={() =>
                onUpdateSettings({
                  proximityRadiusTiles: isWholeMapEavesdrop(settings.proximityRadiusTiles)
                    ? 10
                    : EAVESDROP_WHOLE_MAP_RADIUS,
                })
              }
              aria-pressed={isWholeMapEavesdrop(settings.proximityRadiusTiles)}
              title="Listen across the whole map"
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                isWholeMapEavesdrop(settings.proximityRadiusTiles)
                  ? 'bg-sage text-white'
                  : 'bg-surface text-muted hover:text-ink'
              }`}
            >
              Map
            </button>
            <button
              type="button"
              onClick={() => brainRouter.flushAudioQueue()}
              title="Flush & reset queued browser/Omni audio"
              aria-label="Flush audio queue"
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-surface text-muted hover:text-crimson hover:bg-crimson/10"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              <span>Flush</span>
            </button>
          </div>
        </div>

        {/* Bottom-left quick controls hint */}
        <div className="pointer-events-none absolute bottom-2 left-2 rounded-sm border border-borderFolk bg-card/90 px-2 py-1 text-[11px] text-muted backdrop-blur">
          Click villager to inspect · Click ground or <kbd className="font-mono">WASD</kbd> to walk · Drag to pan · Scroll to zoom
        </div>
      </section>

      {/* Draggable Sidebar Resize Handle */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize inspector sidebar"
        onPointerDown={handleSidebarResizeStart}
        title="Drag to resize sidebar"
        className="hidden lg:flex w-1.5 shrink-0 cursor-col-resize items-center justify-center border-l border-borderFolk bg-surface hover:bg-ink/20 active:bg-ink/30 transition-colors"
      />

      {/* Right: Villager Inspector + Voice & Chat */}
      <aside
        className="flex w-full lg:w-[var(--sidebar-w)] shrink-0 flex-col bg-surface overflow-hidden max-h-[52vh] lg:max-h-none"
        aria-label="Villager Inspector"
      >
        {/* Villager Quick Roster */}
        <div className="border-b border-borderFolk bg-card p-2">
          <div className={`flex items-center justify-between gap-2 ${rosterCollapsed ? '' : 'mb-2'}`}>
            <button
              type="button"
              onClick={() => setRosterCollapsed((c) => !c)}
              aria-expanded={!rosterCollapsed}
              className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted hover:text-ink"
            >
              {rosterCollapsed ? (
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>Villagers ({villagers.length})</span>
              {rosterCollapsed && (
                <span className="ml-1 font-normal normal-case text-ink">
                  · {isScribeSelected ? narratorName : selectedCfg?.name ?? ''}
                </span>
              )}
            </button>
            <div className="flex items-center gap-2">
              {!rosterCollapsed && (
                <button
                  type="button"
                  onClick={() => setRosterView((m) => (m === 'cards' ? 'compact' : 'cards'))}
                  aria-pressed={rosterView === 'compact'}
                  title={rosterView === 'cards' ? 'Switch to compact pills' : 'Switch to thumbnail cards'}
                  className="inline-flex items-center gap-1 rounded border border-borderFolk bg-surface px-1.5 py-0.5 text-[10px] font-medium text-muted hover:text-ink"
                >
                  <LayoutList className="h-3 w-3" aria-hidden="true" />
                  <span>{rosterView === 'cards' ? 'Compact' : 'Thumbnails'}</span>
                </button>
              )}
              <span className="font-mono text-[11px] text-muted">{sim.fps} FPS</span>
            </div>
          </div>

          {!rosterCollapsed && (rosterView === 'cards' ? (
            <div className="max-h-40 overflow-y-auto thin-scroll space-y-1 pr-0.5">
              {villagers.map((v) => {
                const rt = sim.runtimes.get(v.id);
                const active = v.id === selectedId;
                const isBusy =
                  rt?.state === 'conversing' || rt?.state === 'speaking' || rt?.state === 'thinking';
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setSelectedId(v.id)}
                    className={`flex w-full items-center gap-2 rounded-sm border px-1.5 py-1 text-left transition ${
                      active
                        ? 'border-ink/50 bg-linen'
                        : 'border-borderFolk bg-surface hover:border-ink/30'
                    }`}
                  >
                    <VillagerAvatarThumb villager={v} size={24} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${isBusy ? 'animate-pulse' : ''}`}
                          style={{ backgroundColor: v.accentColor }}
                        />
                        <span className="truncate text-xs font-semibold text-ink">{v.name}</span>
                      </div>
                      <p className="truncate text-[10px] text-muted">{v.role}</p>
                    </div>
                    <span className="shrink-0 rounded-sm bg-card px-1 py-0.5 font-mono text-[10px] capitalize text-muted border border-borderFolk">
                      {rt?.state ?? 'idle'}
                    </span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setSelectedId('narrator')}
                className={`flex w-full items-center gap-2 rounded-sm border px-1.5 py-1 text-left transition ${
                  isScribeSelected
                    ? 'border-ochre bg-linen'
                    : 'border-borderFolk bg-surface hover:border-ochre/60'
                }`}
              >
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-borderFolk bg-card font-serif text-[11px] font-bold text-ochre">
                  S
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-ochre" />
                    <span className="truncate text-xs font-semibold text-ink">{narratorName}</span>
                  </div>
                  <p className="truncate text-[10px] text-muted">
                    Village Scribe · {settings.narratorStyle}
                  </p>
                </div>
                <span className="shrink-0 rounded-sm bg-card px-1 py-0.5 font-mono text-[10px] text-muted border border-borderFolk">
                  DM
                </span>
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {villagers.map((v) => {
                const rt = sim.runtimes.get(v.id);
                const active = v.id === selectedId;
                const isBusy =
                  rt?.state === 'conversing' || rt?.state === 'speaking' || rt?.state === 'thinking';
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setSelectedId(v.id)}
                    className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] font-medium transition ${
                      active
                        ? 'border-ink/50 bg-ink text-linen'
                        : 'border-borderFolk bg-surface text-ink hover:border-ink/40'
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${isBusy ? 'animate-pulse' : ''}`}
                      style={{ backgroundColor: v.accentColor }}
                    />
                    <span>{v.name}</span>
                    {rt?.state === 'thinking' && <span className="text-[10px] opacity-80">…</span>}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setSelectedId('narrator')}
                className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] font-medium transition ${
                  isScribeSelected
                    ? 'border-ochre bg-ochre text-white'
                    : 'border-borderFolk bg-surface text-ink hover:border-ochre/60'
                }`}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: isScribeSelected ? '#fff' : '#c79646' }}
                />
                <span>{narratorName}</span>
              </button>
            </div>
          ))}
        </div>

        {/* Selected Villager or Scribe Details + Shared Chat */}
        {(selectedCfg && selectedRt) || isScribeSelected ? (
          <>
            {isScribeSelected ? (
              <div className="border-b border-borderFolk bg-card/80 p-2 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setDetailCollapsed((c) => !c)}
                    aria-expanded={!detailCollapsed}
                    className="flex items-center gap-1.5 text-left min-w-0"
                  >
                    {detailCollapsed ? (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
                    )}
                    <div className="min-w-0">
                      <h3 className="text-xs font-bold leading-tight truncate">{narratorName}</h3>
                      <p className="text-[10px] text-muted truncate">Village Scribe · {settings.narratorStyle}</p>
                    </div>
                  </button>
                  <span className="rounded-sm border border-ochre/50 bg-surface px-1.5 py-0.5 text-[10px] font-medium text-ochre shrink-0">
                    {settings.narratorEnabled ? 'Voiced' : 'Muted'}
                  </span>
                </div>
                {!detailCollapsed && (
                  <p className="text-[11px] leading-snug text-ink/90">
                    Chronicler of Selo. Reads non-dialogue scene beats in turn, and answers directly
                    when addressed with <code className="font-mono">@{narratorName}</code>.
                  </p>
                )}
              </div>
            ) : (
              selectedCfg &&
              selectedRt && (
                <div className="border-b border-borderFolk bg-card/80 p-2 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setDetailCollapsed((c) => !c)}
                      aria-expanded={!detailCollapsed}
                      className="flex items-center gap-1.5 text-left min-w-0"
                    >
                      {detailCollapsed ? (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
                      )}
                      <div className="min-w-0">
                        <h3 className="text-xs font-bold leading-tight truncate">{selectedCfg.name}</h3>
                        <p className="text-[10px] text-muted truncate">{selectedCfg.role}</p>
                      </div>
                    </button>
                    <span className="rounded-sm border border-borderFolk bg-surface px-1.5 py-0.5 text-[10px] font-medium capitalize shrink-0">
                      {selectedRt.state}
                    </span>
                  </div>
                  {!detailCollapsed && (
                    <>
                      <p className="text-xs leading-relaxed text-ink/90">{selectedCfg.identity}</p>
                      <div className="rounded border border-borderFolk bg-surface/80 px-2.5 py-1.5 text-xs">
                        <span className="font-semibold text-ochre">Motive:</span>{' '}
                        {selectedRt.currentIntention || selectedCfg.plan}
                      </div>

                      <div className="flex flex-col gap-1 text-xs">
                        <details>
                          <summary className="cursor-pointer font-medium text-indigoFolk hover:underline">
                            Recent Memories ({selectedRt.memories.length})
                          </summary>
                          <ul className="mt-1.5 max-h-24 space-y-1 overflow-y-auto thin-scroll pr-1">
                            {[...selectedRt.memories].reverse().slice(0, 8).map((m) => (
                              <li key={m.id} className="rounded bg-card px-2 py-1 text-[11px] border border-borderFolk/60">
                                {m.summary}
                              </li>
                            ))}
                          </ul>
                        </details>
                        {selectedRt.worldFeed && selectedRt.worldFeed.length > 0 && (
                          <details>
                            <summary className="cursor-pointer font-medium text-sage hover:underline">
                              World Session Log ({selectedRt.worldFeed.length})
                            </summary>
                            <ul className="mt-1.5 max-h-24 space-y-1 overflow-y-auto thin-scroll pr-1">
                              {[...selectedRt.worldFeed].reverse().slice(0, 8).map((item, idx) => (
                                <li key={idx} className="rounded bg-card px-2 py-1 text-[11px] border border-borderFolk/60">
                                  {item}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )
            )}

            {/* Active Conversation / World Script Stream */}
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="border-b border-borderFolk bg-surface/80 px-3 py-2 space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs text-muted">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setScriptCollapsed((c) => !c)}
                      aria-expanded={!scriptCollapsed}
                      aria-label="Toggle world script panel"
                      className="rounded p-0.5 hover:bg-card"
                    >
                      {scriptCollapsed ? (
                        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                    </button>
                    {(
                      [
                        ['hearing', 'Live Audio'],
                        ['focused', 'Thread'],
                        ['village', `World Script (${sim.conversations.length})`],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          setFeedMode(id);
                          setScriptCollapsed(false);
                        }}
                        aria-pressed={feedMode === id}
                        className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                          feedMode === id ? 'bg-indigoFolk text-white' : 'hover:bg-card'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ eavesdropSpeech: !settings.eavesdropSpeech })}
                      aria-pressed={settings.eavesdropSpeech}
                      title="Hear spoken villager dialogue within eavesdrop radius"
                      className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                        settings.eavesdropSpeech
                          ? 'border-sage bg-sage/15 text-ink'
                          : 'border-borderFolk bg-card text-muted hover:text-ink'
                      }`}
                    >
                      Speech {settings.eavesdropSpeech ? 'On' : 'Off'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ eavesdropThoughts: !settings.eavesdropThoughts })}
                      aria-pressed={settings.eavesdropThoughts}
                      title="Eavesdrop on in-character villager thoughts within radius"
                      className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                        settings.eavesdropThoughts
                          ? 'border-indigoFolk bg-indigoFolk/15 text-ink'
                          : 'border-borderFolk bg-card text-muted hover:text-ink'
                      }`}
                    >
                      Thoughts {settings.eavesdropThoughts ? 'On' : 'Off'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ showReasoning: !settings.showReasoning })}
                      aria-pressed={settings.showReasoning}
                      title="Toggle separate <think> reasoning mode (audio off by default)"
                      className={`rounded border px-1.5 py-0.5 text-[10px] font-mono ${
                        settings.showReasoning
                          ? 'border-ochre bg-ochre/15 text-ink'
                          : 'border-borderFolk bg-card text-muted hover:text-ink'
                      }`}
                    >
                      &lt;think&gt; {settings.showReasoning ? 'On' : 'Off'}
                    </button>
                    {settings.showReasoning && (
                      <button
                        type="button"
                        onClick={() => onUpdateSettings({ speakReasoning: !settings.speakReasoning })}
                        aria-pressed={settings.speakReasoning}
                        title="Read <think> reasoning aloud (off by default)"
                        className={`rounded border px-1.5 py-0.5 text-[10px] font-mono ${
                          settings.speakReasoning
                            ? 'border-crimson bg-crimson/15 text-ink'
                            : 'border-borderFolk bg-card text-muted hover:text-ink'
                        }`}
                      >
                        &lt;think&gt; Sound {settings.speakReasoning ? 'On' : 'Off'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        const next = !settings.enableOmniTts;
                        if (!next) brainRouter.flushAudioQueue();
                        onUpdateSettings({
                          enableOmniTts: next,
                        });
                      }}
                      aria-pressed={settings.enableOmniTts}
                      className="inline-flex items-center gap-1 rounded border border-borderFolk bg-card px-2 py-0.5 text-[11px] hover:bg-surface"
                    >
                      {settings.enableOmniTts ? (
                        <Volume2 className="h-3 w-3 text-sage" />
                      ) : (
                        <VolumeX className="h-3 w-3 text-muted" />
                      )}
                      <span>Voice {settings.enableOmniTts ? 'On' : 'Off'}</span>
                    </button>
                  </div>
                </div>

                {!scriptCollapsed && (
                  <div className="flex flex-wrap items-center gap-1 text-[10px]">
                    <span className="text-muted mr-0.5">Show:</span>
                    {(
                      [
                        ['Speech', filterSpeech, setFilterSpeech],
                        ['Scribe', filterScribe, setFilterScribe],
                        ['Thoughts', filterThoughts, setFilterThoughts],
                        ['You', filterHuman, setFilterHuman],
                      ] as const
                    ).map(([label, active, setter]) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => setter((v) => !v)}
                        aria-pressed={active}
                        className={`rounded-sm border px-1.5 py-0.5 font-medium ${
                          active
                            ? 'border-ink/40 bg-surface text-ink'
                            : 'border-borderFolk bg-card text-muted line-through'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                    <select
                      aria-label="Filter script by character"
                      value={scriptActorFilter}
                      onChange={(e) => setScriptActorFilter(e.target.value)}
                      className="rounded border border-borderFolk bg-card px-1.5 py-0.5 text-[10px]"
                    >
                      <option value="all">All Actors</option>
                      {villagers.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                      <option value="narrator">{narratorName}</option>
                      <option value={sim.player.id}>{sim.player.name}</option>
                    </select>
                    <input
                      type="text"
                      value={scriptSearch}
                      onChange={(e) => setScriptSearch(e.target.value)}
                      placeholder="Filter text…"
                      aria-label="Filter world script text"
                      className="min-w-[88px] flex-1 rounded border border-borderFolk bg-card px-2 py-0.5 text-[10px]"
                    />
                  </div>
                )}
              </div>

              {!scriptCollapsed && (
                <div className="flex-1 overflow-y-auto p-2 space-y-1.5 thin-scroll">
                  {activeSpeech && (
                    <div className="rounded-sm border border-sage/60 bg-card px-2 py-1 text-xs flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-sage">
                          <Volume2 className="h-3 w-3 animate-pulse" aria-hidden="true" />
                          <span>
                            Now Hearing · {activeSpeech.speakerName} ({activeSpeech.engine})
                          </span>
                        </div>
                        <p className="text-ink mt-0.5 line-clamp-2">{activeSpeech.text}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {sim.configs.has(activeSpeech.speakerId) && (
                          <button
                            type="button"
                            onClick={() => setSelectedId(activeSpeech.speakerId)}
                            className="rounded-sm border border-borderFolk bg-surface px-1.5 py-0.5 text-[10px] hover:border-ink/40"
                          >
                            Focus
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => brainRouter.flushAudioQueue()}
                          className="rounded-sm border border-borderFolk bg-surface px-1.5 py-0.5 text-[10px] hover:text-crimson"
                        >
                          Flush
                        </button>
                      </div>
                    </div>
                  )}

                  {displayedMessages.length === 0 ? (
                    <div className="rounded-sm border border-dashed border-borderFolk p-3 text-center text-xs text-muted">
                      Type a message below or use <code className="font-mono">@Name</code>,{' '}
                      <code className="font-mono">@all</code> / <code className="font-mono">@world</code>, or{' '}
                      <code className="font-mono">@{narratorName}</code> to guide one or many characters.
                    </div>
                  ) : (
                    <ul className="space-y-1.5">
                      {displayedMessages.map((msg) => {
                        const isHuman = msg.senderId === sim.player.id;
                        const isNarration = msg.kind === 'narration' || msg.senderId === 'narrator';
                        const isThought = msg.kind === 'thought';
                        const isNowSpeaking =
                          Boolean(activeSpeech) &&
                          activeSpeech!.speakerId === msg.senderId &&
                          msg.text.includes(activeSpeech!.text.slice(0, 20));
                        return (
                          <li
                            key={msg.id}
                            className={`rounded-sm border px-2 py-1.5 text-xs ${
                              isNowSpeaking
                                ? 'border-sage bg-card ring-1 ring-sage/50'
                                : isNarration
                                  ? 'border-borderFolk border-l-2 border-l-ochre bg-card italic'
                                  : isThought
                                    ? 'mr-2 border-dashed border-borderFolk bg-card/70 italic text-ink/90'
                                    : isHuman
                                      ? 'ml-3 border-borderFolk border-l-2 border-l-indigoFolk bg-card'
                                      : 'mr-2 border-borderFolk bg-card'
                            }`}
                          >
                            <div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-muted not-italic">
                              <span className="font-semibold text-ink">
                                {msg.senderName}
                                {isNowSpeaking && (
                                  <span className="ml-1.5 rounded bg-sage px-1 py-0.2 text-[9px] text-white uppercase">
                                    Speaking
                                  </span>
                                )}
                              </span>
                              <span className="rounded bg-surface px-1.5 py-0.5 font-mono uppercase">
                                {isNarration ? 'scribe' : isThought ? 'thought' : msg.source}
                              </span>
                            </div>
                            <p className="leading-relaxed whitespace-pre-wrap">{msg.text || '…'}</p>
                            {settings.showReasoning && msg.reasoning && (
                              <aside
                                aria-label="Model reasoning"
                                className="mt-1.5 rounded border border-borderFolk/70 bg-surface/80 px-2 py-1 font-mono text-[10px] not-italic text-muted whitespace-pre-wrap"
                              >
                                <span className="font-semibold text-ink/70">&lt;think&gt;</span> {msg.reasoning}
                              </aside>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* Composer & LFM3-Omni Voice Input */}
            <div className="relative border-t border-borderFolk bg-card p-3 space-y-2">
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

              {isMentionMenuOpen && (
                <div className="absolute bottom-full left-3 right-3 z-20 mb-1.5 rounded-lg border border-borderFolk bg-card p-1 shadow-lg">
                  <ul
                    id="mention-listbox"
                    role="listbox"
                    aria-label="Address a character or Scribe"
                    className="max-h-48 overflow-y-auto thin-scroll space-y-0.5"
                  >
                    {filteredMentions.map((cand, idx) => {
                      const active = idx === clampedMentionIdx;
                      return (
                        <li
                          key={cand.id}
                          id={`mention-opt-${cand.id}`}
                          role="option"
                          aria-selected={active}
                          onMouseDown={(ev) => {
                            ev.preventDefault();
                            insertMentionCandidate(cand);
                          }}
                          className={`flex cursor-pointer items-center justify-between gap-2 rounded px-2.5 py-1.5 text-xs ${
                            active ? 'bg-indigoFolk text-white' : 'hover:bg-surface text-ink'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: active ? '#fff' : cand.accentColor }}
                            />
                            <span className="font-semibold truncate">
                              {cand.prefix ?? '@'}
                              {cand.name}
                            </span>
                            <span className={`truncate text-[11px] ${active ? 'text-white/80' : 'text-muted'}`}>
                              {cand.role}
                            </span>
                          </div>
                          {cand.statusHint && (
                            <span className={`shrink-0 text-[10px] font-mono ${active ? 'text-white/80' : 'text-muted'}`}>
                              {cand.statusHint}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              <form onSubmit={handleSendText} className="flex items-end gap-1.5">
                <div className="flex-1">
                  <label htmlFor="village-chat-input" className="visually-hidden">
                    Message {isScribeSelected ? narratorName : selectedCfg?.name ?? 'village'} (use @ to mention a character)
                  </label>
                  <textarea
                    ref={textareaRef}
                    id="village-chat-input"
                    rows={2}
                    value={chatInput}
                    onChange={handleChatChange}
                    aria-expanded={isMentionMenuOpen}
                    aria-controls={isMentionMenuOpen ? 'mention-listbox' : undefined}
                    aria-activedescendant={
                      isMentionMenuOpen && filteredMentions[clampedMentionIdx]
                        ? `mention-opt-${filteredMentions[clampedMentionIdx].id}`
                        : undefined
                    }
                    aria-describedby="chat-mention-hint"
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing) return;
                      if (isMentionMenuOpen) {
                        if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          setMentionIdx((i) => (i + 1) % filteredMentions.length);
                          return;
                        }
                        if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          setMentionIdx(
                            (i) => (i - 1 + filteredMentions.length) % filteredMentions.length,
                          );
                          return;
                        }
                        if (e.key === 'Tab' || e.key === 'Enter') {
                          e.preventDefault();
                          const choice = filteredMentions[clampedMentionIdx];
                          if (choice) insertMentionCandidate(choice);
                          return;
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          setMentionMatch(null);
                          return;
                        }
                      }
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendText(e);
                      }
                    }}
                    placeholder={
                      isScribeSelected
                        ? `Ask @${narratorName}, or broadcast with @all / @world / @Name…`
                        : `Talk to ${selectedCfg?.name ?? ''} or use @all, @world, @${narratorName}, @Name…`
                    }
                    className="w-full resize-none rounded-sm border border-borderFolk bg-surface px-2 py-1 text-xs text-ink placeholder:text-muted"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleTriggerAtMention}
                  aria-label="Address a character with @"
                  className="inline-flex h-8 w-7 shrink-0 items-center justify-center rounded-sm border border-borderFolk bg-surface font-mono text-xs font-bold text-ink hover:border-ink/40"
                >
                  @
                </button>

                <button
                  type="button"
                  onClick={handleTriggerHashMention}
                  aria-label="Reference a Point of Interest with #"
                  className="inline-flex h-8 w-7 shrink-0 items-center justify-center rounded-sm border border-borderFolk bg-surface font-mono text-xs font-bold text-ink hover:border-ink/40"
                >
                  #
                </button>

                {!isScribeSelected && (
                  <button
                    type="button"
                    onClick={toggleVoiceRecording}
                    aria-pressed={recording}
                    aria-label={recording ? 'Stop voice recording and send' : 'Talk with microphone'}
                    className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border transition ${
                      recording
                        ? 'border-crimson bg-crimson text-white'
                        : 'border-borderFolk bg-surface text-ink hover:border-crimson'
                    }`}
                  >
                    {recording ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                  </button>
                )}

                <button
                  type="submit"
                  disabled={sending || !chatInput.trim()}
                  aria-label="Send message"
                  className="inline-flex h-8 shrink-0 items-center gap-1 rounded-sm border border-ink/30 bg-ink px-2.5 text-xs font-semibold text-linen hover:opacity-90 disabled:opacity-45"
                >
                  <Send className="h-3 w-3" />
                  <span>Send</span>
                </button>
              </form>
              <p id="chat-mention-hint" className="text-[10px] text-muted">
                Tip: use <code className="font-mono">@Name</code>, <code className="font-mono">@{narratorName}</code>, or <code className="font-mono">#POI</code> to direct characters (e.g. &ldquo;@Mara meet Bram at #Windmill&rdquo;).
              </p>
            </div>
          </>
        ) : (
          <div className="p-6 text-center text-xs text-muted">No villagers in the village yet.</div>
        )}
      </aside>
    </div>
  );
};
