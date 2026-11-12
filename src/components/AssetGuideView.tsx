import React, { useState } from 'react';
import { BookOpen, Check, Copy, Download, Sparkles } from 'lucide-react';
import { brainRouter } from '../ai/brainRouter';

interface PromptTemplate {
  id: string;
  category: 'image' | 'llm';
  title: string;
  attachmentNote: string;
  prompt: string;
}

const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'img-character',
    category: 'image',
    title: 'Character Spritesheet (Cozy Fantasy RPG)',
    attachmentNote: 'Attach character-spritesheet-template-384x512.png as image reference',
    prompt: `Create a top-down 2D pixel-art RPG character spritesheet strictly matching the attached 3x4 grid template (384x512 px, 3 columns x 4 rows of 128x128 cells representing 32x32 pixel blocks).
Subject: A fantasy village weaver wearing a tailored linen tunic with crimson and indigo trim, dark wool vest, and leather boots.
Layout rules:
- Row 1 (top): facing DOWN (front view), 3 walking animation frames (left foot, neutral, right foot).
- Row 2: facing LEFT, 3 walking animation frames.
- Row 3: facing RIGHT, 3 walking animation frames.
- Row 4 (bottom): facing UP (back view), 3 walking animation frames.
Style: Crisp 16-bit/32-bit pixel art, clean dark outlines, flat solid #00FF00 chroma-key or transparent background, NO grid lines, NO text labels, centered cleanly inside each cell's safe box.`,
  },
  {
    id: 'img-tileset',
    category: 'image',
    title: 'Village Tileset (Fantasy & Medieval Craft Theme)',
    attachmentNote: 'Attach tileset-template-512x512.png as image reference',
    prompt: `Create a seamless 2D top-down RPG pixel-art tileset strictly aligned to the attached 16x16 grid of 32x32 pixel tiles (512x512 px total).
Visual theme: Cozy fantasy and medieval craft pixel art — warm parchment stone tones, madder crimson, indigo blue, golden ochre, and forest sage.
Zone layout matching the reference colors:
- Rows 1-3 (green zone): seamless meadow grass, clover, wildflower patches, mossy border grass.
- Rows 4-6 (tan zone): cobblestone plaza tiles, dirt footpath edges, wooden bridge planks.
- Rows 7-8 (blue zone): clear creek water, shoreline edges, river reeds.
- Rows 9-12 (cream zone): half-timbered cottage walls, thatched roofs, carved timber doors and window frames.
- Rows 13-14 (dark green zone): oak trees, berry bushes, wooden fences.
- Rows 15-16 (crimson zone): wooden weaving loom, hearth firepit, earthenware jugs, lanterns, decorative woven rug tiles.
Rules: Orthographic top-down 3/4 RPG perspective, crisp pixel edges, NO anti-aliasing blur, NO visible black grid lines in the output, transparent background around object tiles.`,
  },
  {
    id: 'img-animated-prop',
    category: 'image',
    title: 'Animated Village Prop Strip (4 Frames)',
    attachmentNote: 'Output 128x32 px horizontal 4-frame strip (32x32 per frame)',
    prompt: `Create a 128x32 pixel-art 4-frame horizontal sprite strip (four 32x32 frames side by side) on a transparent background.
Subject: A cozy medieval stone hearth / clay oven with glowing embers and gentle flickering sparks.
Frames 1 to 4 must animate smoothly in a seamless loop at the exact same pixel baseline with zero horizontal drift.`,
  },
  {
    id: 'llm-villager',
    category: 'llm',
    title: 'LLM Prompt: Generate Villager Roster JSON',
    attachmentNote: 'Attach villager-character-template.json for exact schema',
    prompt: `Generate a JSON array of 4 villagers for SeloAI matching the schema in villager-character-template.json.
Theme: A fantasy and medieval craft village inspired by weaving, blacksmithing, astronomy, alchemy, and herbalism.
Requirements:
- Fields per villager: id, name, role, accentColor (hex), spritesheetId ("f1".."f8"), identity (2 vivid sentences), plan (1 current goal), voiceStyle (tone for TTS), homeTile ({x, y} within 12..38, 10..30), speed (0.65..0.9).
- Return ONLY valid JSON with no markdown commentary.`,
  },
  {
    id: 'llm-map',
    category: 'llm',
    title: 'LLM Prompt: Generate Village Map JSON',
    attachmentNote: 'Attach village-map-template.json for exact column-major [x][y] structure',
    prompt: `Generate a valid SeloAI VillageMap JSON matching village-map-template.json with width=24 and height=18.
Rules:
- bgTiles[0] and objectTiles[0] and collisionGrid are column-major [x][y] arrays of length 24, each column of length 18.
- Use tile index 271 for grass, 962 for dirt path, -1 for empty object cells.
- Mark impassable water/wall/tree cells as true in collisionGrid and keep at least 3 walkable spawnPoints.`,
  },
];

const DOWNLOAD_FILES = [
  {
    name: 'character-spritesheet-template-384x512.png',
    label: 'Character Grid 4× (384×512 PNG)',
    desc: 'Best size to attach directly to Gemini/Flux/Midjourney',
    href: '/templates/character-spritesheet-template-384x512.png',
  },
  {
    name: 'character-spritesheet-template-96x128.png',
    label: 'Character Grid Native (96×128 PNG)',
    desc: 'Exact 1:1 32×32 pixel grid (3 cols × 4 rows)',
    href: '/templates/character-spritesheet-template-96x128.png',
  },
  {
    name: 'tileset-template-512x512.png',
    label: 'Tileset Grid (512×512 PNG)',
    desc: '16×16 zone-coded 32×32 tileset layout',
    href: '/templates/tileset-template-512x512.png',
  },
  {
    name: 'villager-character-template.json',
    label: 'Villager JSON Schema',
    desc: 'Starter VillagerConfig JSON for LLM generation',
    href: '/templates/villager-character-template.json',
  },
  {
    name: 'village-map-template.json',
    label: 'Village Map JSON Schema',
    desc: 'Minimal 8×6 column-major [x][y] map JSON',
    href: '/templates/village-map-template.json',
  },
];

export const AssetGuideView: React.FC = () => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [genConcept, setGenConcept] = useState('A wandering lute minstrel who remembers every tavern ballad');
  const [genOutput, setGenOutput] = useState('');
  const [generating, setGenerating] = useState(false);

  const copyPrompt = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleLocalVillagerDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!genConcept.trim() || generating) return;
    setGenerating(true);
    setGenOutput('');

    const systemPrompt =
      'Return ONLY a single valid JSON object with fields: name, role, accentColor, identity, plan, voiceStyle.';
    const userPrompt = `Create a SeloAI villager JSON for: ${genConcept.trim()}`;

    try {
      if (brainRouter.isTextModelReady()) {
        const res = await brainRouter.generateText(
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          {
            maxNewTokens: 200,
            temperature: 0.4,
            onChunk: (c) => setGenOutput((p) => p + c),
          },
        );
        setGenOutput(res.text);
      } else {
        setGenOutput(
          JSON.stringify(
            {
              id: `v-${Date.now()}`,
              name: 'Alden',
              role: 'Wandering Minstrel',
              accentColor: '#23436b',
              spritesheetId: 'f2',
              identity: genConcept.trim(),
              plan: 'Play twilight ballads beside the hearth fire and gather new verses from travelers.',
              voiceStyle: 'Resonant, gentle, rhythmic storyteller.',
              homeTile: { x: 24, y: 15 },
              speed: 0.72,
            },
            null,
            2,
          ),
        );
      }
    } catch (err: any) {
      setGenOutput(`Error: ${err?.message || String(err)}`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-linen p-5 thin-scroll">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="border-b border-borderFolk pb-3">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-crimson" />
            <h1 className="text-lg font-bold">
              Custom Characters, Maps &amp; Generative Asset Templates
            </h1>
          </div>
          <p className="mt-1 text-xs text-muted">
            Download pixel-aligned reference PNG grids and JSON schemas, copy ready-made prompts for
            image models or LLMs, and upload your custom Eastern European embroidery art into the
            Characters &amp; Level Editor tabs.
          </p>
        </div>

        {/* Visual Reference Grid Previews & Downloads */}
        <section aria-label="Downloadable Reference Templates" className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rushnyk-card rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold">Character Spritesheet Grid (3×4 · 32×32 cells)</h2>
              <a
                href="/templates/character-spritesheet-template-384x512.png"
                download="character-spritesheet-template-384x512.png"
                className="inline-flex items-center gap-1 rounded bg-crimson px-2.5 py-1 text-xs font-semibold text-white hover:opacity-95"
              >
                <Download className="h-3.5 w-3.5" />
                <span>384×512 PNG</span>
              </a>
            </div>
            <div className="flex flex-col sm:flex-row gap-4 items-start">
              <img
                src="/templates/character-spritesheet-template-384x512.png"
                alt="3 by 4 character walk-cycle spritesheet template grid for Down, Left, Right, and Up directions"
                className="pixel-canvas w-36 rounded border border-borderFolk bg-surface shrink-0"
              />
              <div className="text-xs space-y-2 leading-relaxed">
                <p>
                  <strong>Row 1 (Crimson):</strong> DOWN (front walk: step L, stand, step R)
                  <br />
                  <strong>Row 2 (Indigo):</strong> LEFT walk frames
                  <br />
                  <strong>Row 3 (Ochre):</strong> RIGHT walk frames
                  <br />
                  <strong>Row 4 (Sage):</strong> UP (back walk frames)
                </p>
                <p className="text-muted">
                  Send the <strong>384×512 PNG</strong> to image models so they respect the cell
                  boundaries, then nearest-neighbor downscale to <strong>96×128</strong> (or set
                  Frame W/H to 128 in the Character Editor).
                </p>
              </div>
            </div>
          </div>

          <div className="rushnyk-card rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold">Tileset Reference Grid (16×16 · 512×512 px)</h2>
              <a
                href="/templates/tileset-template-512x512.png"
                download="tileset-template-512x512.png"
                className="inline-flex items-center gap-1 rounded bg-indigoFolk px-2.5 py-1 text-xs font-semibold text-white hover:opacity-95"
              >
                <Download className="h-3.5 w-3.5" />
                <span>512×512 PNG</span>
              </a>
            </div>
            <div className="flex flex-col sm:flex-row gap-4 items-start">
              <img
                src="/templates/tileset-template-512x512.png"
                alt="16 by 16 tileset template grid organized by terrain, paths, water, cottages, trees, and folk props"
                className="pixel-canvas w-40 rounded border border-borderFolk bg-surface shrink-0"
              />
              <div className="text-xs space-y-1.5 leading-relaxed">
                <div><strong>Rows 1–3 (Green):</strong> Linen meadow grass &amp; wildflowers</div>
                <div><strong>Rows 4–6 (Tan):</strong> Cobblestone plazas, dirt trails, bridges</div>
                <div><strong>Rows 7–8 (Blue):</strong> River water, reeds, shorelines</div>
                <div><strong>Rows 9–12 (Cream):</strong> Khata cottage walls, thatch roofs</div>
                <div><strong>Rows 13–14 (Forest):</strong> Birch, rowanberry, wattle fences</div>
                <div><strong>Rows 15–16 (Crimson):</strong> Looms, hearths, rushnyk borders</div>
              </div>
            </div>
          </div>
        </section>

        {/* All Downloadable Files Bar */}
        <section aria-label="Template File Downloads" className="rushnyk-card rounded-lg p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
            All Template Files (docs/CUSTOM_ASSETS_GUIDE.md &amp; public/templates/)
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
            {DOWNLOAD_FILES.map((f) => (
              <a
                key={f.name}
                href={f.href}
                download={f.name}
                className="flex flex-col justify-between rounded border border-borderFolk bg-surface p-2.5 text-xs hover:border-crimson transition"
              >
                <div>
                  <div className="font-semibold text-ink">{f.label}</div>
                  <div className="mt-1 text-[11px] text-muted">{f.desc}</div>
                </div>
                <div className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-crimson">
                  <Download className="h-3 w-3" />
                  <span>Download</span>
                </div>
              </a>
            ))}
          </div>
        </section>

        {/* Copy-Paste Prompts for Image & LLM Models */}
        <section aria-label="Generative Prompts" className="space-y-3">
          <h2 className="text-sm font-bold">
            Ready-to-Send Prompts for Image Models &amp; Generative LLMs
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {PROMPT_TEMPLATES.map((tpl) => {
              const copied = copiedId === tpl.id;
              return (
                <article key={tpl.id} className="rushnyk-card rounded-lg p-4 flex flex-col gap-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${
                          tpl.category === 'image'
                            ? 'bg-crimson/15 text-crimson'
                            : 'bg-indigoFolk/15 text-indigoFolk'
                        }`}
                      >
                        {tpl.category === 'image' ? 'Image Model' : 'LLM JSON'}
                      </span>
                      <h3 className="mt-1 text-sm font-bold">{tpl.title}</h3>
                      <p className="text-[11px] text-muted">{tpl.attachmentNote}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyPrompt(tpl.id, tpl.prompt)}
                      className="inline-flex shrink-0 items-center gap-1 rounded border border-borderFolk bg-surface px-2.5 py-1 text-xs font-medium hover:bg-card"
                    >
                      {copied ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-sage" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded border border-borderFolk bg-surface p-2.5 font-mono text-[11px] leading-relaxed thin-scroll">
                    {tpl.prompt}
                  </pre>
                </article>
              );
            })}
          </div>
        </section>

        {/* Local LFM3-1.7B Character JSON Draft Helper */}
        <section aria-label="Local Villager Draft Generator" className="rushnyk-card rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-ochre" />
              <h2 className="text-sm font-bold">
                Quick Villager JSON Generator ({brainRouter.isTextModelReady() ? 'LFM3-1.7B WebGPU' : 'Schema Preview'})
              </h2>
            </div>
          </div>
          <form onSubmit={handleLocalVillagerDraft} className="flex flex-wrap gap-2">
            <label htmlFor="villager-concept-input" className="visually-hidden">
              Villager concept description
            </label>
            <input
              id="villager-concept-input"
              type="text"
              value={genConcept}
              onChange={(e) => setGenConcept(e.target.value)}
              className="flex-1 min-w-[240px] rounded border border-borderFolk bg-surface px-3 py-1.5 text-xs"
            />
            <button
              type="submit"
              disabled={generating}
              className="inline-flex items-center gap-1.5 rounded bg-ochre px-3 py-1.5 text-xs font-semibold text-white hover:opacity-95 disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>{generating ? 'Generating…' : 'Draft Villager JSON'}</span>
            </button>
          </form>
          {genOutput && (
            <pre className="overflow-x-auto rounded border border-borderFolk bg-surface p-3 font-mono text-[11px] leading-relaxed">
              {genOutput}
            </pre>
          )}
        </section>
      </div>
    </div>
  );
};
