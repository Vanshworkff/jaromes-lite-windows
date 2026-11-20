// Study tools and the daily summary (Jaromes Lite, by Vansh Bohra).
// - Flashcard decks, saved in ~/.gg/sidekick/study.json, reviewed with spaced repetition (Leitner boxes:
//   a right answer moves a card up a box and it comes back later; a wrong one sends it back to box 1, due now).
// - Reading PDFs (lecture slides, notes, textbooks) so cards and quizzes can be made from them.
// - A study log (cards reviewed, quizzes, focus blocks, study minutes) that the daily summary is built from.
// - The evening summary: the first time they talk after 6 pm, the reply starts with how the day went.
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { DIR, readJson, writeJson } from './store.mjs';
import { briefDay, DAY_STARTS } from './brief.mjs';

const FILE = path.join(DIR, 'study.json');
// Days until a card in each box comes back: box 1 = today again, then 1, 3, 7, 16, 35 days.
export const BOX_DAYS = [0, 0, 1, 3, 7, 16, 35];
const MAX_BOX = BOX_DAYS.length - 1;
const DAY_MS = 864e5;
const KEEP_LOG_DAYS = 120;
export const EVENING_HOUR = 18;

let cache = null;
export function load() {
  if (!cache) {
    const d = readJson(FILE, { backup: true }) ?? {};
    cache = { decks: Array.isArray(d.decks) ? d.decks : [], log: Array.isArray(d.log) ? d.log : [] };
  }
  return cache;
}
const save = () => writeJson(FILE, load(), { backup: true });
/** For tests: point at another file. */
export function _reset(data = null) { cache = data ? { decks: data.decks ?? [], log: data.log ?? [] } : { decks: [], log: [] }; }

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const newId = (prefix) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** The deck whose name matches (exactly, then by words), or null. */
export function findDeck(name) {
  const n = norm(name);
  if (!n) return null;
  const decks = load().decks;
  return decks.find((d) => norm(d.name) === n)
    ?? decks.find((d) => norm(d.name).includes(n) || n.includes(norm(d.name)))
    ?? decks.find((d) => n.split(' ').every((w) => norm(d.name).includes(w)))
    ?? null;
}

const dueCount = (d, now) => d.cards.filter((c) => (c.due ?? 0) <= now).length;

/** Add cards to a deck (made if it doesn't exist). Duplicate questions are skipped. → summary line. */
export async function addCards(name, cards, subject = '', now = Date.now()) {
  const st = load();
  let deck = findDeck(name);
  if (!deck) {
    deck = { id: newId('d'), name: String(name).trim().slice(0, 80) || 'Study deck', subject: String(subject).slice(0, 60), created: now, cards: [] };
    st.decks.push(deck);
  }
  const seen = new Set(deck.cards.map((c) => norm(c.q)));
  let added = 0;
  for (const c of cards) {
    const q = String(c.q ?? '').trim(), a = String(c.a ?? '').trim();
    if (!q || !a || seen.has(norm(q))) continue;
    seen.add(norm(q));
    deck.cards.push({ id: newId('c'), q: q.slice(0, 400), a: a.slice(0, 800), box: 1, due: now, right: 0, wrong: 0 });
    added++;
  }
  logEvent({ type: 'cards_made', deck: deck.name, n: added }, now);
  await save();
  return { deck, added };
}

/** The cards to review next: due ones first (lowest box, oldest due), then, if asked, the weakest of the rest. */
export function nextCards(deck, count = 10, now = Date.now(), { extra = false } = {}) {
  const due = deck.cards.filter((c) => (c.due ?? 0) <= now).sort((a, b) => a.box - b.box || a.due - b.due);
  if (due.length >= count || !extra) return due.slice(0, count);
  const rest = deck.cards.filter((c) => (c.due ?? 0) > now).sort((a, b) => a.box - b.box || (b.wrong - b.right) - (a.wrong - a.right));
  return [...due, ...rest].slice(0, count);
}

/** Record answers ([{ id, right }]). → { right, total, missed: [q] }. */
export async function grade(deck, results, now = Date.now()) {
  let right = 0, total = 0;
  const missed = [];
  for (const r of results) {
    const c = deck.cards.find((x) => x.id === r.id) ?? deck.cards.find((x) => norm(x.q) === norm(r.id));
    if (!c) continue;
    total++;
    if (r.right) {
      right++; c.right++;
      c.box = Math.min(MAX_BOX, c.box + 1);
      c.due = now + BOX_DAYS[c.box] * DAY_MS;
    } else {
      c.wrong++; c.box = 1; c.due = now;
      missed.push(c.q);
    }
    c.seen = now;
  }
  if (total) logEvent({ type: 'review', deck: deck.name, right, total }, now);
  await save();
  return { right, total, missed };
}

/** A line in the study log. Kept for KEEP_LOG_DAYS. */
export function logEvent(e, now = Date.now()) {
  const st = load();
  st.log.push({ ...e, at: now, day: briefDay(now) });
  const cutoff = now - KEEP_LOG_DAYS * DAY_MS;
  if (st.log.length > 3000 || (st.log[0]?.at ?? now) < cutoff) st.log = st.log.filter((x) => x.at >= cutoff).slice(-3000);
}
export const logAndSave = async (e, now = Date.now()) => { logEvent(e, now); await save(); };

/** "They answered the quiz X on screen by clicking: 3 of 5 right." → { right, total } (draw.mjs quizNote). */
export function parseQuizNote(note) {
  const m = /:\s*(\d+) of (\d+) right/.exec(String(note ?? ''));
  return m ? { right: Number(m[1]), total: Number(m[2]) } : null;
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Everything logged for one day (YYYY-MM-DD, turning over at 4 am), in plain lines for the model. */
export function dayStats(day, now = Date.now()) {
  const st = load();
  const ev = st.log.filter((e) => e.day === day);
  const reviews = ev.filter((e) => e.type === 'review');
  const quizzes = ev.filter((e) => e.type === 'quiz');
  const focus = ev.filter((e) => e.type === 'focus');
  const made = ev.filter((e) => e.type === 'cards_made').reduce((n, e) => n + (e.n || 0), 0);
  const cardsRight = reviews.reduce((n, e) => n + e.right, 0), cardsTotal = reviews.reduce((n, e) => n + e.total, 0);
  const focusMin = focus.reduce((n, e) => n + (e.minutes || 0), 0);
  const decksStudied = [...new Set(reviews.map((e) => e.deck))];
  const studyMin = focusMin + Math.round(cardsTotal * 0.5) + quizzes.reduce((n, e) => n + Math.round((e.total || 0) * 0.75), 0);
  // Streak: days in a row (ending today or yesterday) with any review, quiz or focus block.
  const active = new Set(st.log.filter((e) => ['review', 'quiz', 'focus'].includes(e.type)).map((e) => e.day));
  let streak = 0;
  for (let k = 0; k <= 366; k++) {
    if (active.has(briefDay(now - k * DAY_MS))) streak++;
    else if (k > 0) break;
  }
  const dueTomorrow = st.decks.map((d) => ({ name: d.name, n: dueCount(d, now + DAY_MS) })).filter((x) => x.n);
  return { day, reviews, quizzes, focus, made, cardsRight, cardsTotal, focusMin, decksStudied, studyMin, streak, dueTomorrow };
}

export function statsText(s) {
  const lines = [];
  lines.push(s.cardsTotal ? `- Flashcards: ${plural(s.cardsTotal, 'card')} reviewed, ${s.cardsRight} right (${Math.round((s.cardsRight / s.cardsTotal) * 100)}%), decks: ${s.decksStudied.join(', ')}` : '- Flashcards: none reviewed');
  if (s.made) lines.push(`- New flashcards made: ${s.made}`);
  lines.push(s.quizzes.length ? `- Quizzes: ${s.quizzes.map((q) => `${q.title ? `${q.title} ` : ''}${q.right}/${q.total}`).join(', ')}` : '- Quizzes: none');
  lines.push(s.focus.length ? `- Focus blocks: ${s.focus.length}, ${s.focusMin} min in total${s.focus.some((f) => f.task) ? ` (on: ${s.focus.map((f) => f.task).filter(Boolean).join(', ')})` : ''}, ${plural(s.focus.reduce((n, f) => n + (f.drifts || 0), 0), 'drift')}` : '- Focus blocks: none');
  lines.push(`- Study time (about): ${s.studyMin} min`);
  lines.push(`- Study streak: ${plural(s.streak, 'day')}`);
  lines.push(s.dueTomorrow.length ? `- Flashcards due by tomorrow: ${s.dueTomorrow.map((d) => `${d.name} (${d.n})`).join(', ')}` : '- Flashcards due by tomorrow: none');
  return lines.join('\n');
}

/** The evening note for the first request after EVENING_HOUR (and before the day turns over), once a day. */
export function eveningNote({ on, lastDay, now = Date.now(), intro = false, name = 'the user' }) {
  if (!on || intro) return null;
  const h = new Date(now).getHours();
  if (h < EVENING_HOUR && h >= DAY_STARTS) return null;
  const day = briefDay(now);
  if (lastDay === day) return null;
  const note = `System, not ${name}: it's evening and this is the first time ${name} has talked to you since 6 pm, so start your reply with their daily summary, in character: call daily_summary first, then say in about four short sentences what they got done today (reminders done, study, focus), what's due tomorrow, and one line of encouragement. Then answer what they just said.`;
  return { note, day };
}

export function createStudyTools({ userName = 'the user', commitmentsText = () => '', doneTodayText = () => '', fmtWhen = (ms) => new Date(ms).toLocaleString(), checkRead = null, home = '' }) {
  const deckList = (now = Date.now()) => load().decks.map((d) => `- ${d.name}${d.subject ? ` (${d.subject})` : ''}: ${plural(d.cards.length, 'card')}, ${dueCount(d, now)} due now, ${d.cards.filter((c) => c.box >= 4).length} learned well`).join('\n');
  const cardLines = (cards) => cards.map((c) => `- id ${c.id} [box ${c.box}] Q: ${c.q}\n  A: ${c.a}`).join('\n');
  return [
    {
      name: 'read_pdf',
      description: `Read the text of a PDF on ${userName}'s computer (lecture slides, notes, a textbook chapter, a worksheet), so you can explain it, summarise it, or make flashcards and quizzes from it. pages: e.g. "1-10" (default: all, up to about 80,000 characters). A scanned PDF with no text can't be read.`,
      parameters: z.object({ path: z.string(), pages: z.string().optional() }),
      execute: async ({ path: p, pages }) => {
        const abs = path.resolve(String(p).replace(/^~(?=$|\/)/, home));
        const file = checkRead ? checkRead(abs) : abs;
        const { extractText, getDocumentProxy } = await import('unpdf');
        const pdf = await getDocumentProxy(new Uint8Array(await fs.readFile(file)));
        const { text } = await extractText(pdf, { mergePages: false });
        let from = 1, to = text.length;
        const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(String(pages ?? '').trim());
        if (m) { from = Math.max(1, Number(m[1])); to = Math.min(text.length, Number(m[2] ?? m[1])); }
        let out = '';
        for (let i = from; i <= to; i++) out += `\n--- page ${i} ---\n${String(text[i - 1] ?? '').trim()}`;
        if (!out.replace(/--- page \d+ ---/g, '').trim()) return `${path.basename(abs)} has ${text.length} pages but no text layer (probably scanned). Jaromes Lite can't read scanned pages.`;
        return `${path.basename(abs)}: ${text.length} pages${m ? `, showing ${from}-${to}` : ''}.${out.length > 80_000 ? `${out.slice(0, 80_000)}\n…(cut; ask for later pages with pages)` : out}`;
      },
    },
    {
      name: 'make_flashcards',
      description: `Save flashcards into a named deck (made if it doesn't exist; cards are added to an existing one). Use when ${userName} asks for flashcards, or to study / revise / remember something: from a file or PDF (read it first), an app window, a web page or the topic itself. Write clear, short questions with one fact each, and short answers; 5 to 30 cards. deck: a short name like "Chem: bonding" or "Spanish verbs". Then tell them how many you saved and offer to quiz them.`,
      parameters: z.object({ deck: z.string().min(1).max(80), subject: z.string().max(60).optional(), cards: z.array(z.object({ q: z.string().min(1), a: z.string().min(1) })).min(1).max(60) }),
      execute: async ({ deck, subject, cards }) => {
        const { deck: d, added } = await addCards(deck, cards, subject);
        return `Saved ${plural(added, 'new card')} in "${d.name}" (${plural(d.cards.length, 'card')} in all${cards.length > added ? `; ${cards.length - added} already in the deck` : ''}).`;
      },
    },
    {
      name: 'list_decks',
      description: `List ${userName}'s flashcard decks, with how many cards each has and how many are due for review now.`,
      parameters: z.object({}),
      execute: async () => deckList() || 'No flashcard decks yet. Offer to make some from their notes, a PDF or the screen.',
    },
    {
      name: 'study_deck',
      description: `Get the next flashcards to review from a deck (spaced repetition: the ones due now, weakest first). Then quiz ${userName}: ask them one card at a time and wait for their answer. Afterwards call grade_cards with each card's id and whether they got it right (be fair: close enough counts). count: 5 to 20 (default 10). extra: true to also include cards that aren't due yet, when they want more practice.`,
      parameters: z.object({ deck: z.string(), count: z.number().optional(), extra: z.boolean().optional() }),
      execute: async ({ deck, count, extra }) => {
        const d = findDeck(deck);
        if (!d) return `No deck called "${deck}". Their decks:\n${deckList() || '(none yet)'}`;
        const cards = nextCards(d, Math.max(1, Math.min(20, Math.round(count ?? 10))), Date.now(), { extra: !!extra });
        if (!cards.length) {
          const next = Math.min(...d.cards.map((c) => c.due ?? Infinity));
          return `Nothing due in "${d.name}" right now${Number.isFinite(next) ? `; the next card is due ${fmtWhen(next)}` : ''}. Offer extra practice (extra: true) or another deck.`;
        }
        return `Deck "${d.name}": ${plural(cards.length, 'card')} to review (don't show the answers before they try):\n${cardLines(cards)}`;
      },
    },
    {
      name: 'grade_cards',
      description: 'Record how a flashcard review went, after quizzing: each card id from study_deck and whether they got it right. Right answers come back later and later; missed ones come back soon. Also logs it for their daily summary.',
      parameters: z.object({ deck: z.string(), results: z.array(z.object({ id: z.string(), right: z.boolean() })).min(1) }),
      execute: async ({ deck, results }) => {
        const d = findDeck(deck);
        if (!d) return `No deck called "${deck}".`;
        const r = await grade(d, results);
        return `${r.right} of ${r.total} right in "${d.name}".${r.missed.length ? ` To go over: ${r.missed.slice(0, 6).join('; ')}.` : ''} ${dueCount(d, Date.now())} still due in this deck.`;
      },
    },
    {
      name: 'delete_deck',
      description: `Delete a flashcard deck, only when ${userName} clearly asks to delete it.`,
      parameters: z.object({ deck: z.string() }),
      execute: async ({ deck }) => {
        const d = findDeck(deck);
        if (!d) return `No deck called "${deck}".`;
        load().decks = load().decks.filter((x) => x !== d);
        await save();
        return `Deleted "${d.name}" (${plural(d.cards.length, 'card')}).`;
      },
    },
    {
      name: 'daily_summary',
      description: `${userName}'s daily summary: reminders and to-dos done, study (flashcards, quizzes, focus blocks, study time, streak), and what's due tomorrow. Use when they ask how their day went, what they did today, for a summary or recap, or for yesterday's (day "yesterday"). Say it in a few short sentences.`,
      parameters: z.object({ day: z.enum(['today', 'yesterday']).optional() }),
      execute: async ({ day = 'today' }) => {
        const now = Date.now();
        const s = dayStats(briefDay(day === 'yesterday' ? now - DAY_MS : now), now);
        const done = day === 'today' ? doneTodayText() : '';
        const open = commitmentsText();
        const tomorrowEnd = new Date(now + DAY_MS); tomorrowEnd.setHours(23, 59, 59, 999);
        return [
          `Daily summary for ${day} (${s.day}):`,
          day === 'today' ? `Done today:\n${done || '- (nothing marked done)'}` : '',
          `Study:\n${statsText(s)}`,
          `Open reminders and commitments (check which are due by ${fmtWhen(tomorrowEnd.getTime())}):\n${open || '- (none)'}`,
        ].filter(Boolean).join('\n\n');
      },
    },
  ];
}

export const STUDY_ANIMS = {
  read_pdf: (a, base) => ({ tool: 'read', variant: 'file', label: 'reading', detail: base(a.path) }),
  make_flashcards: (a) => ({ tool: 'write', variant: 'create', label: 'making', detail: 'flashcards' }),
  list_decks: () => ({ tool: 'read', variant: 'many', label: 'checking', detail: 'your decks' }),
  study_deck: (a) => ({ tool: 'read', variant: 'file', label: 'shuffling', detail: String(a.deck ?? 'cards').slice(0, 24) }),
  grade_cards: () => ({ tool: 'write', variant: 'edit', label: 'scoring', detail: 'your cards' }),
  delete_deck: () => ({ tool: 'write', variant: 'crumble', label: 'deleting', detail: 'a deck' }),
  daily_summary: () => ({ tool: 'read', variant: 'many', label: 'adding up', detail: 'your day' }),
};
