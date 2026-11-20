// Meeting notes (Jaromes, by Vansh Bohra). While a meeting is on, the voice helper keeps the mic open and sends what
// was said in chunks ({type: "meeting_text"}); each chunk is kept with the time it came in. When it ends, one side call
// turns the transcript into Notion-style notes (summary, key points, decisions, action items, topics, open questions),
// saved as a Markdown page in ~/Documents/Meeting Notes with the full transcript at the bottom.
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const NOTES_DIR = path.join(os.homedir(), 'Documents', 'Meeting Notes');
export const MIN_WORDS = 15; // fewer words than this: nothing worth summing up

const pad = (n) => String(n).padStart(2, '0');
/** "12:05" (or "1:02:05") from seconds since the start. */
export function stamp(secs) {
  const s = Math.max(0, Math.round(secs)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}
export const wordCount = (segments) => segments.reduce((n, s) => n + (s.text.match(/\S+/g)?.length ?? 0), 0);

/** The transcript as timed lines, for the model and the page. */
export function transcriptText(segments) {
  return segments.map((s) => `[${stamp(s.t)}] ${s.text}`).join('\n');
}

export const notesPrompt = (name) => `You turn the transcript of a meeting or lecture that ${name} recorded into clear, well-organised notes, the way a great Notion page would look. You never talk to anyone; you only write JSON.
The transcript comes from speech recognition: expect misheard words, missing punctuation and no speaker names. ${name} is the one recording and is usually in the meeting: speech recognition often mangles their name, so any odd word or name that sounds like "${name}" (for example a made-up name with similar sounds) means ${name}; write it as ${name}. Fix obvious mishearings from context, but never invent facts, names, numbers, dates or decisions that aren't there. If something is unclear, leave it out or list it under open questions.
Reply with one JSON object and nothing else:
{"title": "...", "summary": "...", "key_points": ["..."], "decisions": ["..."], "action_items": [{"task": "...", "owner": "...", "due": "..."}], "topics": [{"heading": "...", "points": ["..."]}], "open_questions": ["..."], "tags": ["..."]}
- title: a short, specific title (3 to 8 words), not "Meeting notes".
- summary: 2 to 4 plain sentences on what it was about and what came out of it.
- key_points: the 3 to 8 most important points, one short sentence each.
- decisions: what was agreed or decided ([] if nothing).
- action_items: who does what by when; owner and due only if said ("" otherwise). [] if none.
- topics: the discussion in order, grouped under short headings, 2 to 6 short points each. For a lecture these are the main ideas, with definitions and examples.
- open_questions: questions left open or things to check ([] if none).
- tags: 1 to 4 one-word tags (lowercase).
Write in the language the transcript is in.`;

export function notesInput({ segments, startedAt, endedAt, title }) {
  const when = new Date(startedAt);
  return `Recorded ${when.toDateString()} at ${when.toTimeString().slice(0, 5)}, ${Math.max(1, Math.round((endedAt - startedAt) / 60000))} minutes${title ? `, called "${title}"` : ''}.\n\nTranscript:\n${transcriptText(segments)}\n\nWrite the JSON now.`;
}

const list = (v) => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : []);
/** The model's reply → notes, or null when it isn't usable JSON. */
export function parseNotes(text) {
  const m = String(text ?? '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  let o;
  try { o = JSON.parse(m[0]); } catch { return null; }
  if (!o || typeof o !== 'object' || !String(o.summary ?? '').trim()) return null;
  return {
    title: String(o.title ?? '').trim().slice(0, 90),
    summary: String(o.summary).trim(),
    key_points: list(o.key_points),
    decisions: list(o.decisions),
    action_items: (Array.isArray(o.action_items) ? o.action_items : []).map((a) => (typeof a === 'string' ? { task: a } : a ?? {}))
      .map((a) => ({ task: String(a.task ?? '').trim(), owner: String(a.owner ?? '').trim(), due: String(a.due ?? '').trim() })).filter((a) => a.task),
    topics: (Array.isArray(o.topics) ? o.topics : []).map((t) => ({ heading: String(t?.heading ?? '').trim(), points: list(t?.points) })).filter((t) => t.heading && t.points.length),
    open_questions: list(o.open_questions),
    tags: list(o.tags).map((t) => t.toLowerCase().replace(/[^\p{L}\p{N}-]+/gu, '')).filter(Boolean).slice(0, 4),
  };
}

const timeOf = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const dateOf = (ms) => new Date(ms).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

/** The notes page in Markdown (imports cleanly into Notion: headings, callouts as quotes, to-do checkboxes). */
export function toMarkdown({ notes, segments, startedAt, endedAt, by = 'Jaromes', title: given }) {
  const mins = Math.max(1, Math.round((endedAt - startedAt) / 60000));
  const title = notes?.title || given || `Meeting on ${dateOf(startedAt)}`;
  const out = [`# 📝 ${title}`, ''];
  out.push(`> 📅 ${dateOf(startedAt)} · 🕒 ${timeOf(startedAt)}–${timeOf(endedAt)} (${mins} min) · 🗣️ ${wordCount(segments)} words · 🎙️ Notes by ${by}${notes?.tags?.length ? ` · 🏷️ ${notes.tags.map((t) => `#${t}`).join(' ')}` : ''}`, '');
  if (notes) {
    out.push('## ✨ Summary', '', notes.summary, '');
    if (notes.key_points.length) out.push('## 🔑 Key points', '', ...notes.key_points.map((p) => `- ${p}`), '');
    if (notes.decisions.length) out.push('## ✅ Decisions', '', ...notes.decisions.map((p) => `- ${p}`), '');
    if (notes.action_items.length) {
      out.push('## 📌 Action items', '', ...notes.action_items.map((a) => `- [ ] ${a.task}${a.owner ? ` · 👤 ${a.owner}` : ''}${a.due ? ` · 📆 ${a.due}` : ''}`), '');
    }
    if (notes.topics.length) {
      out.push('## 🗂️ Discussion', '');
      for (const t of notes.topics) out.push(`### ${t.heading}`, '', ...t.points.map((p) => `- ${p}`), '');
    }
    if (notes.open_questions.length) out.push('## ❓ Open questions', '', ...notes.open_questions.map((p) => `- ${p}`), '');
  } else {
    out.push('> ⚠️ The summary couldn\'t be written this time (no AI connection or it timed out). The full transcript is below; say "redo my meeting notes" to try again.', '');
  }
  out.push('---', '', '## 📜 Transcript', '');
  out.push(segments.length ? segments.map((s) => `**${stamp(s.t)}** ${s.text}`).join('\n\n') : '_Nothing was heard._', '');
  return out.join('\n');
}

const safeName = (s) => String(s).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70) || 'Meeting';
/** Writes the page; a name that's taken gets " (2)". → its path. */
export async function saveNotes(markdown, { startedAt, title, dir = NOTES_DIR }) {
  await fs.mkdir(dir, { recursive: true });
  const d = new Date(startedAt);
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())} – ${safeName(title)}`;
  let file = path.join(dir, `${base}.md`);
  for (let i = 2; existsSync(file); i++) file = path.join(dir, `${base} (${i}).md`);
  await fs.writeFile(file, markdown, 'utf8');
  return file;
}

/** The newest notes page, for "summarise my last meeting" / "open my meeting notes". */
export async function latestNotes(dir = NOTES_DIR) {
  try {
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.md'));
    if (!files.length) return null;
    const stats = await Promise.all(files.map(async (f) => ({ f, t: (await fs.stat(path.join(dir, f))).mtimeMs })));
    return path.join(dir, stats.sort((a, b) => b.t - a.t)[0].f);
  } catch { return null; }
}

/** The transcript kept while a meeting runs, so a crash or quit doesn't lose it. */
export function readUnfinished(file) {
  try { const o = JSON.parse(readFileSync(file, 'utf8')); return Array.isArray(o?.segments) && o.startedAt ? o : null; } catch { return null; }
}
