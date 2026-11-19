/**
 * The music lab: audition the band away from the village. Drive it by hand (mood, intensity,
 * dance, lead) or by telling it a story: lines typed here go to the same listener the village
 * uses, which picks the mood and intensity. A piano roll shows the last half minute.
 * Open /music-lab.html while `pnpm dev` is running.
 */
import { MOOD_IDS, type Lead, type Mood, type MusicCue } from './cue';
import type { PhrasePlan } from './composer';
import { MusicListener, type StoryLine } from './listener';
import { MusicPlayer } from './player';
import { DANCES, TONIC_MIDI, type DanceId } from './theory';

const root = document.getElementById('lab')!;
const params = new URLSearchParams(location.search);
let seed = Number(params.get('seed') ?? 7) || 7;

root.innerHTML = `
  <h1>Music lab: tapan, gaida, kaval</h1>
  <p class="hint">Everything is synthesized and composed as it plays. In <b>story</b> mode the listener reads the lines you add (as it reads the village's) and chooses the mood and intensity; in <b>hand</b> mode you do.</p>
  <div class="row">
    <button id="play">▶ Play</button>
    <button id="modeStory" class="on">story</button><button id="modeHand">hand</button>
    <label>seed <input id="seed" type="number" value="${seed}" style="width:70px"></label>
    <span id="now"></span>
  </div>
  <h2>Direction</h2>
  <div class="row" id="moods"></div>
  <div class="row"><label>intensity</label><input id="intensity" type="range" min="0" max="100" value="20"><span id="ival"></span>
    <button id="urgent">urgent</button></div>
  <div class="row">
    <label>dance <select id="dance"><option value="">by mood</option>${Object.values(DANCES).map((d) => `<option value="${d.id}">${d.label}</option>`).join('')}</select></label>
    <label>lead <select id="lead"><option value="">by intensity</option><option>kaval</option><option>gaida</option></select></label>
    <label><input type="checkbox" data-mute="gaida"> mute gaida</label>
    <label><input type="checkbox" data-mute="drone"> mute drone</label>
    <label><input type="checkbox" data-mute="kaval"> mute kaval</label>
    <label><input type="checkbox" data-mute="tapan"> mute tapan</label>
  </div>
  <h2>Tell it a story</h2>
  <div class="row" id="scenes"></div>
  <textarea id="line" placeholder="A line of the story, e.g. The serpent coils in the dry well and the village is afraid!"></textarea>
  <div class="row"><button id="say">Say it (speech)</button><button id="narrate">Narrate it</button><button id="dance4">Start a khoro</button><button id="silence">Let it go quiet</button></div>
  <div>cue: <span id="reason">—</span></div>
  <h2>Last half minute <span class="legend"><span style="background:#c0392b"></span>gaida<span style="background:#5b8fd9"></span>kaval<span style="background:#e9e3d6"></span>tapan dum<span style="background:#8a8378"></span>tek</span></h2>
  <canvas id="roll" width="1400" height="300"></canvas>
  <div id="log"></div>
`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let ctx: AudioContext | null = null;
let player: MusicPlayer | null = null;
const listener = new MusicListener();
const lines: StoryLine[] = [];
let dancing = 0;
let storyMode = true;
let hand: MusicCue = { mood: 'pastoral', intensity: 0.2 };
let urgent = false;
const t0 = performance.now();
const clock = () => (performance.now() - t0) / 1000;

type Placed = { plan: PhrasePlan; at: number };
const placed: Placed[] = [];

function ensurePlayer() {
  if (!ctx) ctx = new AudioContext();
  if (!player) {
    player = new MusicPlayer({ ctx, seed });
    player.onPhrase((plan, at) => {
      placed.push({ plan, at });
      while (placed.length > 40) placed.shift();
      const log = $('log');
      log.insertAdjacentHTML('afterbegin', `<div>${at.toFixed(1)}s · ${plan.label} · intensity ${plan.intensity.toFixed(2)} · ${plan.length.toFixed(1)}s</div>`);
      while (log.childElementCount > 40) log.lastElementChild?.remove();
    });
    for (const box of document.querySelectorAll<HTMLInputElement>('[data-mute]')) {
      player.muted[box.dataset.mute as keyof MusicPlayer['muted']] = box.checked;
    }
  }
  return player;
}

function currentCue(): MusicCue {
  const dance = ($('dance') as HTMLSelectElement).value as DanceId | '';
  const lead = ($('lead') as HTMLSelectElement).value as Lead | '';
  const base = storyMode ? listener.read({ now: clock(), lines, dancing, activeConversations: lines.some((l) => clock() - l.at < 20) ? 1 : 0 }) : hand;
  return { ...base, ...(dance ? { dance } : {}), ...(lead ? { lead } : {}), ...(urgent ? { urgent } : {}) };
}

function refresh() {
  const cue = currentCue();
  player?.setCue(cue);
  $('reason').textContent = `${cue.mood} · ${cue.intensity.toFixed(2)}${cue.dance ? ` · ${cue.dance}` : ''}${cue.reason ? ` — ${cue.reason}` : ''}`;
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-mood]')) b.classList.toggle('on', b.dataset.mood === cue.mood);
  if (storyMode) ($('intensity') as HTMLInputElement).value = String(Math.round(cue.intensity * 100));
  $('ival').textContent = (cue.intensity * 100).toFixed(0);
}

// Controls.
$('moods').innerHTML = MOOD_IDS.map((m) => `<button data-mood="${m}">${m}</button>`).join('');
$('moods').addEventListener('click', (e) => {
  const m = (e.target as HTMLElement).dataset.mood as Mood | undefined;
  if (!m) return;
  setStory(false);
  hand = { ...hand, mood: m };
  refresh();
});
$('intensity').addEventListener('input', (e) => {
  setStory(false);
  hand = { ...hand, intensity: Number((e.target as HTMLInputElement).value) / 100 };
  refresh();
});
$('urgent').addEventListener('click', () => {
  urgent = !urgent;
  $('urgent').classList.toggle('on', urgent);
  refresh();
});
$('dance').addEventListener('change', refresh);
$('lead').addEventListener('change', refresh);
for (const box of document.querySelectorAll<HTMLInputElement>('[data-mute]')) {
  box.addEventListener('change', () => {
    if (player) player.muted[box.dataset.mute as keyof MusicPlayer['muted']] = box.checked;
  });
}

function setStory(on: boolean) {
  storyMode = on;
  $('modeStory').classList.toggle('on', on);
  $('modeHand').classList.toggle('on', !on);
}
$('modeStory').addEventListener('click', () => {
  setStory(true);
  refresh();
});
$('modeHand').addEventListener('click', () => {
  setStory(false);
  refresh();
});

$('play').addEventListener('click', async () => {
  const p = ensurePlayer();
  await ctx!.resume();
  if (p.playing) {
    p.stop();
    player = null;
    $('play').textContent = '▶ Play';
  } else {
    refresh();
    p.start();
    $('play').textContent = '■ Stop';
  }
});
$('seed').addEventListener('change', (e) => {
  seed = Number((e.target as HTMLInputElement).value) || 1;
  const was = player?.playing;
  player?.stop(0.4);
  player = null;
  if (was) {
    ensurePlayer().start();
    refresh();
  }
});

function add(text: string, kind: StoryLine['kind']) {
  if (!text.trim()) return;
  lines.push({ text, kind, at: clock() });
  setStory(true);
  refresh();
}
$('say').addEventListener('click', () => add(($('line') as HTMLTextAreaElement).value, 'speech'));
$('narrate').addEventListener('click', () => add(($('line') as HTMLTextAreaElement).value, 'narration'));
$('dance4').addEventListener('click', () => {
  dancing = dancing ? 0 : 4;
  $('dance4').classList.toggle('on', !!dancing);
  setStory(true);
  refresh();
});
$('silence').addEventListener('click', () => {
  lines.length = 0;
  dancing = 0;
  $('dance4').classList.remove('on');
  listener.reset();
  refresh();
});

const SCENES: Array<[string, Array<[string, StoryLine['kind']]>]> = [
  ['Dawn in the village', [['Morning comes over the hill; the shepherd leads his flock down to the river, and the women set up their looms.', 'narration']]],
  ['The well runs dry', [['The well has run dry. There is no water, and the children cry from thirst.', 'narration'], ['We are lost. Who will mourn us when we are gone?', 'speech']]],
  ['Samodivi in the forest', [['Mist rises in the forest; under the moon the samodivi whisper a strange song.', 'narration']]],
  ['The lamia comes', [['The serpent uncoils from the dark well, and the curse demands blood!', 'narration'], ['Beware! The lamia will devour us all! Run!', 'speech'], ['No! Never! I will not give her my daughter!', 'speech']]],
  ['A quarrel', [['You lied to me! You stole the grain, thief!', 'speech'], ['Enough! Why must you always accuse me?', 'speech']]],
  ['Wedding horo', [['The wedding feast begins: the gaida plays, the bride and groom lead the horo, and everyone dances!', 'narration'], ['Rakia for everyone! Sing, dance!', 'speech']]],
  ['The water returns', [['At last the water flows again; the lamia is banished and the village is saved!', 'narration'], ['Victory! We are free!', 'speech']]],
];
$('scenes').innerHTML = SCENES.map(([name], i) => `<button data-scene="${i}">${name}</button>`).join('');
$('scenes').addEventListener('click', (e) => {
  const i = (e.target as HTMLElement).dataset.scene;
  if (i === undefined) return;
  for (const [text, kind] of SCENES[Number(i)][1]) lines.push({ text, kind, at: clock() });
  ($('line') as HTMLTextAreaElement).value = SCENES[Number(i)][1][0][0];
  setStory(true);
  refresh();
});

// The listener is read as time passes, as the village does.
setInterval(() => {
  if (storyMode) refresh();
}, 1000);

// Piano roll.
const canvas = $('roll') as HTMLCanvasElement;
const g = canvas.getContext('2d')!;
const SPAN = 30;
function draw() {
  requestAnimationFrame(draw);
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== w * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const now = ctx?.currentTime ?? 0;
  const x = (t: number) => w - 60 - ((now - t) / SPAN) * (w - 60);
  const lo = TONIC_MIDI - 6;
  const hi = TONIC_MIDI + 26;
  const drumH = 34;
  const y = (m: number) => (h - drumH) - ((m - lo) / (hi - lo)) * (h - drumH - 8);
  // Tonic lines.
  g.strokeStyle = '#4a453d';
  for (const m of [TONIC_MIDI, TONIC_MIDI + 12, TONIC_MIDI + 24]) {
    g.beginPath();
    g.moveTo(0, y(m));
    g.lineTo(w, y(m));
    g.stroke();
  }
  g.fillStyle = '#e9e3d6';
  g.fillRect(x(now), 0, 1, h);
  for (const { plan, at } of placed) {
    if (at + plan.length < now - SPAN) continue;
    g.fillStyle = '#6b6458';
    g.fillRect(x(at), 0, 1, 6);
    g.font = '10px system-ui';
    g.fillText(plan.label.split(' · ').slice(0, 2).join(' · '), x(at) + 3, 10);
    const notes = (list: typeof plan.gaida, color: string, dy: number) => {
      g.fillStyle = color;
      for (const n of list) {
        const x0 = x(at + n.t);
        const x1 = x(at + n.t + n.dur);
        g.fillRect(x0, y(n.midi) - 3 + dy, Math.max(1.5, x1 - x0 - 1), 5);
        for (const [i, gm] of (n.graces ?? []).entries()) g.fillRect(x0 - (3 - i) * 2, y(gm) - 1 + dy, 2, 2);
      }
    };
    if (plan.gaidaOn) notes(plan.gaida, '#c0392b', 0);
    notes(plan.kaval, '#5b8fd9', 1);
    for (const hit of plan.tapan) {
      g.fillStyle = hit.kind === 'dum' ? '#e9e3d6' : '#8a8378';
      const r = hit.kind === 'dum' ? 2 + 3 * hit.vel : 1 + 2 * hit.vel;
      g.beginPath();
      g.arc(x(at + hit.t), h - (hit.kind === 'dum' ? 12 : 24), r, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = `rgba(217,164,65,${0.15 + 0.5 * plan.drone})`;
    g.fillRect(x(at), h - 3, x(at + plan.length) - x(at), 3);
  }
  $('now').textContent = player?.playing ? `playing · intensity now ${player.intensity.toFixed(2)}${player.current ? ` · ${player.current.label}` : ''}` : '';
}
draw();
refresh();
