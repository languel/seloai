import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, Plus, Trash2, Upload } from 'lucide-react';
import { SPRITESHEET_PRESETS } from '../data/defaultData';
import { getCachedImage, getCustomSpriteFrame, getPresetSpriteFrame } from '../engine/renderer';
import type { Direction, VillageMap, VillagerConfig } from '../engine/types';

interface CharacterEditorViewProps {
  villagers: VillagerConfig[];
  map: VillageMap;
  onApplyVillagers: (next: VillagerConfig[]) => void;
}

const DIRECTIONS: Direction[] = ['down', 'left', 'right', 'up'];

export const CharacterEditorView: React.FC<CharacterEditorViewProps> = ({
  villagers,
  map,
  onApplyVillagers,
}) => {
  const [drafts, setDrafts] = useState<VillagerConfig[]>(() => structuredClone(villagers));
  const [selectedId, setSelectedId] = useState<string>(villagers[0]?.id ?? '');
  const [savedNotice, setSavedNotice] = useState(false);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    setDrafts(structuredClone(villagers));
  }, [villagers]);

  useEffect(() => {
    if (!drafts.some((d) => d.id === selectedId) && drafts[0]) {
      setSelectedId(drafts[0].id);
    }
  }, [drafts, selectedId]);

  const current = drafts.find((d) => d.id === selectedId);

  // Live 4-direction animated sprite preview
  useEffect(() => {
    if (!current) return;
    let raf = 0;
    const render = (now: number) => {
      const canvas = previewCanvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.imageSmoothingEnabled = false;
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          const animFrame = (now / 1000) * 5;
          DIRECTIONS.forEach((dir, idx) => {
            const boxX = idx * 72 + 4;
            const boxY = 8;

            ctx.fillStyle = 'rgba(18, 22, 28, 0.08)';
            ctx.strokeStyle = 'rgba(120, 110, 100, 0.35)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(boxX, boxY, 64, 64, 8);
            ctx.fill();
            ctx.stroke();

            const frame = current.customSprite
              ? getCustomSpriteFrame(current.customSprite, dir, animFrame, true)
              : getPresetSpriteFrame(current.spritesheetId, dir, animFrame, true);

            if (frame) {
              const img = getCachedImage(frame.url);
              if (img) {
                ctx.drawImage(
                  img,
                  frame.sx,
                  frame.sy,
                  frame.sw,
                  frame.sh,
                  boxX + 8,
                  boxY + 4,
                  48,
                  48,
                );
              }
            }

            ctx.fillStyle = '#5c534a';
            ctx.font = '600 10px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(dir.toUpperCase(), boxX + 32, boxY + 58);
          });
        }
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [current]);

  const updateCurrent = (patch: Partial<VillagerConfig>) => {
    if (!current) return;
    setDrafts((prev) => prev.map((v) => (v.id === current.id ? { ...v, ...patch } : v)));
  };

  const addNewVillager = () => {
    const idx = drafts.length + 1;
    const preset = SPRITESHEET_PRESETS[idx % SPRITESHEET_PRESETS.length];
    const spawn = map.spawnPoints[idx % Math.max(1, map.spawnPoints.length)] ?? { x: 20, y: 15 };
    const created: VillagerConfig = {
      id: `v-${Date.now()}`,
      name: `Villager ${idx}`,
      role: 'Folk Artisan',
      accentColor: '#a82424',
      spritesheetId: preset.id,
      identity:
        'A thoughtful craftsperson who loves sharing local folklore and asking travelers about their journeys.',
      plan: 'Stroll around the village square and greet neighbors.',
      voiceStyle: 'Warm, clear, friendly.',
      homeTile: { x: spawn.x, y: spawn.y },
      speed: 0.75,
    };
    setDrafts((prev) => [...prev, created]);
    setSelectedId(created.id);
  };

  const duplicateCurrent = () => {
    if (!current) return;
    const copy: VillagerConfig = {
      ...structuredClone(current),
      id: `v-${Date.now()}`,
      name: `${current.name} II`,
    };
    setDrafts((prev) => [...prev, copy]);
    setSelectedId(copy.id);
  };

  const deleteCurrent = () => {
    if (!current || drafts.length <= 1) return;
    setDrafts((prev) => prev.filter((v) => v.id !== current.id));
  };

  const handleCustomSpriteUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !current) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      const img = new Image();
      img.onload = () => {
        const cols = Math.max(1, Math.floor(img.naturalWidth / 32));
        const rows = Math.max(1, Math.floor(img.naturalHeight / 32));
        updateCurrent({
          customSprite: {
            textureUrl: url,
            frameWidth: 32,
            frameHeight: 32,
            cols,
            rows,
            framesPerDirection: Math.min(3, cols),
            rowMap: {
              down: 0,
              left: Math.min(1, rows - 1),
              right: Math.min(2, rows - 1),
              up: Math.min(3, rows - 1),
            },
          },
        });
      };
      img.src = url;
    };
    reader.readAsDataURL(file);
  };

  const applyLive = () => {
    onApplyVillagers(structuredClone(drafts));
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2000);
  };

  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-[270px_1fr] overflow-hidden">
      {/* Left Roster */}
      <aside className="flex flex-col border-r border-borderFolk bg-surface overflow-hidden">
        <div className="flex items-center justify-between border-b border-borderFolk bg-card p-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
            Villager Roster ({drafts.length})
          </h2>
          <button
            type="button"
            onClick={addNewVillager}
            className="inline-flex items-center gap-1 rounded bg-crimson px-2 py-1 text-xs font-semibold text-white hover:opacity-95"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>New</span>
          </button>
        </div>

        <ul className="flex-1 overflow-y-auto p-2 space-y-1.5 thin-scroll">
          {drafts.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => setSelectedId(v.id)}
                className={`flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition ${
                  v.id === selectedId
                    ? 'border-crimson bg-card shadow-sm'
                    : 'border-transparent hover:border-borderFolk hover:bg-card/60'
                }`}
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-full border border-black/20"
                  style={{ backgroundColor: v.accentColor }}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold">{v.name}</div>
                  <div className="truncate text-[11px] text-muted">{v.role}</div>
                </div>
              </button>
            </li>
          ))}
        </ul>

        <div className="border-t border-borderFolk bg-card p-3">
          <button
            type="button"
            onClick={applyLive}
            className="flex w-full items-center justify-center gap-1.5 rounded bg-crimson px-3 py-2 text-xs font-semibold text-white hover:opacity-95"
          >
            <Check className="h-3.5 w-3.5" />
            <span>{savedNotice ? 'Applied to Village!' : 'Apply Roster to Village'}</span>
          </button>
        </div>
      </aside>

      {/* Main Character Form & Sprite Preview */}
      <section className="overflow-y-auto bg-linen p-5 thin-scroll">
        {current ? (
          <div className="mx-auto max-w-3xl space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-borderFolk pb-3">
              <div>
                <h1 className="text-lg font-bold">Edit Character: {current.name}</h1>
                <p className="text-xs text-muted">
                  Configure persona prompts for LFM3-1.7B, voice style for LFM3-Omni-2B, and sprite sheets.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={duplicateCurrent}
                  className="inline-flex items-center gap-1 rounded border border-borderFolk bg-card px-2.5 py-1.5 text-xs hover:bg-surface"
                >
                  <Copy className="h-3.5 w-3.5" />
                  <span>Duplicate</span>
                </button>
                <button
                  type="button"
                  onClick={deleteCurrent}
                  disabled={drafts.length <= 1}
                  className="inline-flex items-center gap-1 rounded border border-crimson/50 bg-card px-2.5 py-1.5 text-xs text-crimson hover:bg-crimson/10 disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Delete</span>
                </button>
              </div>
            </div>

            {/* Live Animation Preview */}
            <div className="rushnyk-card rounded-lg p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Walk Cycle Preview (4 Directions)
                </span>
                <span className="text-[11px] text-muted">
                  {current.customSprite ? 'Custom Spritesheet' : `Preset: ${current.spritesheetId}`}
                </span>
              </div>
              <canvas
                ref={previewCanvasRef}
                width={296}
                height={80}
                className="pixel-canvas rounded border border-borderFolk bg-surface"
              />
            </div>

            {/* Identity & Prompt Fields */}
            <div className="rushnyk-card rounded-lg p-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="char-name" className="block text-xs font-medium mb-1">
                    Name
                  </label>
                  <input
                    id="char-name"
                    type="text"
                    value={current.name}
                    onChange={(e) => updateCurrent({ name: e.target.value })}
                    className="w-full rounded border border-borderFolk bg-surface px-2.5 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="char-role" className="block text-xs font-medium mb-1">
                    Village Role
                  </label>
                  <input
                    id="char-role"
                    type="text"
                    value={current.role}
                    onChange={(e) => updateCurrent({ role: e.target.value })}
                    className="w-full rounded border border-borderFolk bg-surface px-2.5 py-1.5 text-xs"
                  />
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label htmlFor="char-speed" className="block text-xs font-medium mb-1">
                      Walk Speed (tiles/s)
                    </label>
                    <input
                      id="char-speed"
                      type="number"
                      step={0.05}
                      min={0.2}
                      max={3}
                      value={current.speed}
                      onChange={(e) => updateCurrent({ speed: Number(e.target.value) })}
                      className="w-full rounded border border-borderFolk bg-surface px-2.5 py-1.5 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label htmlFor="char-color" className="block text-xs font-medium mb-1">
                      Color
                    </label>
                    <input
                      id="char-color"
                      type="color"
                      value={current.accentColor}
                      onChange={(e) => updateCurrent({ accentColor: e.target.value })}
                      className="h-8 w-10 cursor-pointer rounded border border-borderFolk bg-surface p-0.5"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label htmlFor="char-identity" className="block text-xs font-medium mb-1">
                  Identity & Personality Prompt (LFM3-1.7B / LFM3-Omni)
                </label>
                <textarea
                  id="char-identity"
                  rows={3}
                  value={current.identity}
                  onChange={(e) => updateCurrent({ identity: e.target.value })}
                  className="w-full rounded border border-borderFolk bg-surface px-2.5 py-1.5 text-xs leading-relaxed"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="char-plan" className="block text-xs font-medium mb-1">
                    Current Plan / Goal
                  </label>
                  <textarea
                    id="char-plan"
                    rows={2}
                    value={current.plan}
                    onChange={(e) => updateCurrent({ plan: e.target.value })}
                    className="w-full rounded border border-borderFolk bg-surface px-2.5 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="char-voice" className="block text-xs font-medium mb-1">
                    Voice Persona (LFM3-Omni TTS)
                  </label>
                  <textarea
                    id="char-voice"
                    rows={2}
                    value={current.voiceStyle}
                    onChange={(e) => updateCurrent({ voiceStyle: e.target.value })}
                    className="w-full rounded border border-borderFolk bg-surface px-2.5 py-1.5 text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label htmlFor="char-homex" className="block text-xs font-medium mb-1">
                    Home Tile X
                  </label>
                  <input
                    id="char-homex"
                    type="number"
                    min={0}
                    max={map.width - 1}
                    value={current.homeTile.x}
                    onChange={(e) =>
                      updateCurrent({ homeTile: { ...current.homeTile, x: Number(e.target.value) } })
                    }
                    className="w-full rounded border border-borderFolk bg-surface px-2.5 py-1.5 text-xs font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="char-homey" className="block text-xs font-medium mb-1">
                    Home Tile Y
                  </label>
                  <input
                    id="char-homey"
                    type="number"
                    min={0}
                    max={map.height - 1}
                    value={current.homeTile.y}
                    onChange={(e) =>
                      updateCurrent({ homeTile: { ...current.homeTile, y: Number(e.target.value) } })
                    }
                    className="w-full rounded border border-borderFolk bg-surface px-2.5 py-1.5 text-xs font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Spritesheet Picker + Custom Embroidery Sprite Upload */}
            <div className="rushnyk-card rounded-lg p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Spritesheet Appearance
                </h2>
                <div className="flex items-center gap-2">
                  {current.customSprite && (
                    <button
                      type="button"
                      onClick={() => updateCurrent({ customSprite: undefined })}
                      className="rounded border border-borderFolk bg-surface px-2 py-1 text-[11px] hover:bg-card"
                    >
                      Use Built-in Presets
                    </button>
                  )}
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-indigoFolk bg-indigoFolk/10 px-2.5 py-1 text-xs font-medium text-indigoFolk hover:bg-indigoFolk/20">
                    <Upload className="h-3.5 w-3.5" />
                    <span>Upload Custom Sprite PNG</span>
                    <input
                      type="file"
                      accept="image/png,image/webp"
                      className="sr-only"
                      onChange={handleCustomSpriteUpload}
                    />
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {SPRITESHEET_PRESETS.map((preset) => {
                  const selected = !current.customSprite && current.spritesheetId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() =>
                        updateCurrent({ spritesheetId: preset.id, customSprite: undefined })
                      }
                      className={`rounded border px-2.5 py-2 text-left text-xs transition ${
                        selected
                          ? 'border-crimson bg-crimson/10 font-semibold'
                          : 'border-borderFolk bg-surface hover:border-crimson/40'
                      }`}
                    >
                      <div className="font-mono text-[11px] text-muted">{preset.id}</div>
                      <div className="truncate">{preset.label}</div>
                    </button>
                  );
                })}
              </div>

              {current.customSprite && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 rounded border border-borderFolk bg-surface p-3 text-xs">
                  <div>
                    <label htmlFor="cs-fw" className="block text-[11px] text-muted">
                      Frame W (px)
                    </label>
                    <input
                      id="cs-fw"
                      type="number"
                      min={8}
                      max={128}
                      value={current.customSprite.frameWidth}
                      onChange={(e) =>
                        updateCurrent({
                          customSprite: {
                            ...current.customSprite!,
                            frameWidth: Number(e.target.value),
                          },
                        })
                      }
                      className="w-full rounded border border-borderFolk bg-card px-2 py-1 font-mono"
                    />
                  </div>
                  <div>
                    <label htmlFor="cs-fh" className="block text-[11px] text-muted">
                      Frame H (px)
                    </label>
                    <input
                      id="cs-fh"
                      type="number"
                      min={8}
                      max={128}
                      value={current.customSprite.frameHeight}
                      onChange={(e) =>
                        updateCurrent({
                          customSprite: {
                            ...current.customSprite!,
                            frameHeight: Number(e.target.value),
                          },
                        })
                      }
                      className="w-full rounded border border-borderFolk bg-card px-2 py-1 font-mono"
                    />
                  </div>
                  <div>
                    <label htmlFor="cs-fpd" className="block text-[11px] text-muted">
                      Frames / Dir
                    </label>
                    <input
                      id="cs-fpd"
                      type="number"
                      min={1}
                      max={12}
                      value={current.customSprite.framesPerDirection}
                      onChange={(e) =>
                        updateCurrent({
                          customSprite: {
                            ...current.customSprite!,
                            framesPerDirection: Number(e.target.value),
                          },
                        })
                      }
                      className="w-full rounded border border-borderFolk bg-card px-2 py-1 font-mono"
                    />
                  </div>
                  <div>
                    <label htmlFor="cs-rdown" className="block text-[11px] text-muted">
                      Down Row
                    </label>
                    <input
                      id="cs-rdown"
                      type="number"
                      min={0}
                      max={12}
                      value={current.customSprite.rowMap.down}
                      onChange={(e) =>
                        updateCurrent({
                          customSprite: {
                            ...current.customSprite!,
                            rowMap: {
                              ...current.customSprite!.rowMap,
                              down: Number(e.target.value),
                            },
                          },
                        })
                      }
                      className="w-full rounded border border-borderFolk bg-card px-2 py-1 font-mono"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="text-center text-xs text-muted">Select a villager to edit.</div>
        )}
      </section>
    </div>
  );
};
