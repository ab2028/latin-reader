// --- small, pragmatic lemmatizer & linker for Latin ---

let vocabData = {};
let vocabEntries = [];
let notesData = {}; // raw notes map from notes.json
let notesList = []; // processed array of note objects
const MIN_STEM_LEN = 3;
let currentChapter = 2;

/* ---------- basic utilities ---------- */
function normalize(w) {
  return (w || "")
    .toLowerCase()
    .replace(/[()[\]{}.,;:!?'"“”‘’«»\-–—]/g, "")
    .trim();
}

function stripEnclitic(w) {
  if (w.endsWith("que") && w.length > 4) return w.slice(0, -3);
  if (w.endsWith("ve") && w.length > 3) return w.slice(0, -2);
  if (w.endsWith("ne") && w.length > 3) return w.slice(0, -2);
  return w;
}

function stemLatin(w) {
  let base = stripEnclitic(normalize(w));
  const nounAdjSuffixes = [
    "orum","arum","ibus","ium","uum",
    "ae","am","as","os","um","us","is","e","i","o","u","em","es","a"
  ];
  const verbSuffixes = [
    "ntur","tur","mini","mur",
    "mus","tis","unt","ent","ant",
    "ris","re","isti","imus","itis","erunt","ere",
    "bam","bat","bant","bo","bis","bit",
    "or","o","s","t","m","nt","it"
  ];
  for (const s of nounAdjSuffixes) {
    if (base.endsWith(s) && base.length - s.length >= MIN_STEM_LEN) {
      base = base.slice(0, -s.length);
      break;
    }
  }
  for (const s of verbSuffixes) {
    if (base.endsWith(s) && base.length - s.length >= MIN_STEM_LEN) {
      base = base.slice(0, -s.length);
      break;
    }
  }
  return base;
}

/* ---------- irregular map ---------- */
const IRREGULAR_FORMS = new Map([
  ["est","sum"],["sunt","sum"],["esse","sum"],["erat","sum"],["fuit","sum"],["fuerunt","sum"],["sit","sum"],["sint","sum"],
  ["tulit","fero"],["latus","fero"],["contulit","confero"],["auxit","augeo"]
]);

function guessLemmaFromHeuristics(word) {
  const w = normalize(word);
  if (IRREGULAR_FORMS.has(w)) return IRREGULAR_FORMS.get(w);
  if (w.endsWith("i") && w.length > 2) {
    const root = w.slice(0, -1);
    const cand1 = root + "us";
    const cand2 = root + "um";
    if (vocabData[cand1]) return cand1;
    if (vocabData[cand2]) return cand2;
  }
  if (w.endsWith("ae") && w.length > 3) {
    const cand = w.slice(0, -2) + "a";
    if (vocabData[cand]) return cand;
  }
  const targetStem = stemLatin(w);
  if (targetStem.length < MIN_STEM_LEN) return null;

  let best = null, bestScore = 0;
  for (const { lemma, stem } of vocabEntries) {
    let k = 0;
    while (k < targetStem.length && k < stem.length && targetStem[k] === stem[k]) k++;
    if (k > bestScore && k >= MIN_STEM_LEN) { bestScore = k; best = lemma; }
  }
  return best;
}

/* ---------- load vocab ---------- */
async function loadVocab() {
  // try chapter-specific vocab in the vocab/ folder first, then fall back
  // to root-level vocab.json for compatibility
  const vocabPath = `vocab/vocab-ch${currentChapter}.json`;
  let resp = await fetch(vocabPath).catch(() => null);
  if (!resp || !resp.ok) {
    // fallback to root-level vocab.json
    resp = await fetch("vocab.json").catch(() => null);
  }
  if (!resp) {
    vocabData = {};
    return;
  }
  vocabData = await resp.json();
  const vocabList = document.getElementById("vocab-list");
  vocabList.innerHTML = "";
  vocabEntries = [];
  for (const [lemma, gloss] of Object.entries(vocabData)) {
    const div = document.createElement("div");
    div.className = "vocab-entry";
    div.dataset.word = lemma.toLowerCase();
    // display the value but make everything before the en dash (–) bold
    // if an en dash is present. Escape HTML to be safe.
    if (typeof gloss === 'string' && gloss.indexOf('–') !== -1) {
      const parts = gloss.split(/–/);
      const left = parts.shift().trim();
      const right = parts.join('–').trim();
      div.innerHTML = `<b>${renderRichText(left)}</b> – ${renderRichText(right)}`;
    } else {
      div.innerHTML = renderRichText(gloss);
    }
    vocabList.appendChild(div);
    vocabEntries.push({ lemma: lemma.toLowerCase(), stem: stemLatin(lemma), el: div });
  }
}

/* ---------- load notes ---------- */
async function loadNotes() {
  try {
    // chapter-specific notes in notes/ folder, then fallback to root notes.json
    const notesPath = `notes/notes-ch${currentChapter}.json`;
    let resp = await fetch(notesPath).catch(() => null);
    if (!resp || !resp.ok) {
      resp = await fetch("notes.json").catch(() => null);
    }
    if (!resp) throw new Error(`Failed to load notes for chapter ${currentChapter}`);
    notesData = await resp.json();
    // parse notes into pattern segments; support ellipsis (...) as a wildcard
    notesList = Object.entries(notesData).map(([latin_ref, note], idx) => {
      const rawTokens = latin_ref.split(/\s+/).filter(Boolean);
      const segments = [];
      let cur = [];
      for (const rt of rawTokens) {
        // treat three dots or single ellipsis char as wildcard separators
        if (rt.includes('...') || rt.includes('\u2026')) {
          if (cur.length) { segments.push(cur); cur = []; }
          // wildcard represented by a gap between segments
          continue;
        }
        const n = normalize(rt);
        if (n) cur.push(n);
      }
      if (cur.length) segments.push(cur);

      // flattened tokens (non-wildcard) for backward-compatibility
      const tokens = segments.flat();

      return {
        id: `note-${idx}`,
        latin_ref,
        note,
        tokens,
        patternSegments: segments,
      };
    });
    // render the notes list into the notes pane so they're always visible
    renderNotesList();
  } catch (err) {
    console.error("Failed to load notes.json", err);
    notesData = {};
    notesList = [];
  }
}

function renderNotesList() {
  const notesPane = document.getElementById('notes-content');
  notesPane.innerHTML = "";
  for (const note of notesList) {
    const div = document.createElement('div');
    div.className = 'note-entry';
    div.dataset.noteId = note.id;
    // show latin_ref bold then the note text; preserve line breaks in note
  div.innerHTML = `<b>${renderRichText(note.latin_ref)}</b><div class="note-text">${renderRichText(note.note)}</div>`;
    // clicking a note entry should highlight it (and optionally could jump to text)
    div.addEventListener('click', () => {
      div.classList.add('highlight');
      setTimeout(() => div.classList.remove('highlight'), 1200);
      div.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    notesPane.appendChild(div);
  }
}

function escapeHtml(s) {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\n/g, '<br>');
}

// Render a tiny subset of Markdown (bold ** and italics *) safely.
// We escape first, then convert marks to tags. This prevents HTML injection
// while allowing authors to use *italic* and **bold** in JSON values.
function renderRichText(raw) {
  if (!raw && raw !== 0) return '';
  let s = escapeHtml(String(raw));

  // Replace strong (**text**) first, non-greedy
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Then italics (*text*) — avoid matching inside already converted strong tags
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');

  return s;
}

/* ---------- main text load ---------- */
async function loadChapter() {
  const textPath = `texts/atticus-ch${currentChapter}.txt`;
  let response = await fetch(textPath).catch(() => null);
  if (!response || !response.ok) response = await fetch("texts/atticus-ch2.txt");
  const text = await response.text();

  // Normalize escaped-newline sequences and render the cleaned text.
  const normalizedText = text.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n");
  renderLatinText(normalizedText);
  attachVocabEvents();
}

function setChapter(n) {
  currentChapter = n;
  document.querySelectorAll('.chapter-btn').forEach(b => b.classList.toggle('active', +b.dataset.ch === n));
  // reload vocab, notes, text for the chapter
  (async () => {
    await loadVocab();
    await loadNotes();
    await loadChapter();
  })();
}

function renderLatinText(text) {
  const latinContainer = document.getElementById("latin-text");
  latinContainer.innerHTML = "";

  const { tokens, wordEntries } = tokenizeText(text);
  const noteMatches = findNoteMatches(wordEntries);

  const fragment = document.createDocumentFragment();
  let tokenIndex = 0;
  let wordIndex = 0;

  while (tokenIndex < tokens.length) {
    const token = tokens[tokenIndex];

    if (token.type === "space") {
      fragment.appendChild(document.createTextNode(token.raw));
      tokenIndex++;
      continue;
    }

    const match = noteMatches.get(wordIndex);
    if (match) {
      const span = document.createElement("span");
      span.classList.add("word", "note-available", "note-phrase");
      span.dataset.noteId = match.note.id;
      span.title = match.note.note;

      let wordsCovered = 0;
      let j = tokenIndex;
      let content = "";
      while (j < tokens.length && wordsCovered < match.length) {
        const innerToken = tokens[j];
        content += innerToken.raw;
        if (innerToken.type === "word") wordsCovered++;
        j++;
      }

      span.textContent = content;
      span.dataset.raw = tokens[tokenIndex].raw;
      // Prevent native selection starting on shift+mousedown (avoids the
      // blue/OS-level selection) and handle shift+click to scroll/highlight.
      span.addEventListener('mousedown', (e) => {
        if (e.shiftKey) {
          e.preventDefault();
        }
      });

      span.addEventListener("click", (e) => {
        if (e.shiftKey) {
          // prevent text selection caused by shift-click (extra safety)
          e.preventDefault();
          e.stopPropagation();
          // find the corresponding note entry and highlight/scroll it
          const notesPane = document.getElementById('notes-content');
          const target = notesPane.querySelector(`.note-entry[data-note-id="${match.note.id}"]`);
          if (target) {
            target.classList.add('highlight');
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => target.classList.remove('highlight'), 1200);
          } else {
            // fallback: show as transient note
            showNoteInPane(match.note);
          }
        }
      });

      fragment.appendChild(span);
      tokenIndex = j;
      wordIndex += match.length;
      continue;
    }

    const span = document.createElement("span");
    span.className = "word";
    span.dataset.raw = token.raw;
    span.textContent = token.raw;

    const tooltip = resolveVocabTooltip(token.clean);
    if (tooltip) span.title = tooltip;

    fragment.appendChild(span);
    tokenIndex++;
    wordIndex++;
  }

  const p = document.createElement("p");
  p.appendChild(fragment);
  latinContainer.appendChild(p);
}

function tokenizeText(text) {
  const rawTokens = text.match(/\S+|\s+/g) || [];
  const tokens = [];
  const wordEntries = [];

  rawTokens.forEach((raw) => {
    if (/^\s+$/.test(raw)) {
      tokens.push({ type: "space", raw });
    } else {
      const entry = {
        type: "word",
        raw,
        clean: normalize(raw),
        wordIndex: wordEntries.length,
      };
      tokens.push(entry);
      wordEntries.push(entry);
    }
  });

  return { tokens, wordEntries };
}

function findNoteMatches(wordEntries) {
  const matches = [];

  for (const note of notesList) {
    if (!note.tokens.length) continue;

    // If the note has patternSegments (wildcards between segments), attempt
    // to match each segment in order allowing gaps between them.
    const segs = note.patternSegments || [note.tokens];
    // iterate positions where the first segment actually occurs
    const firstSeg = segs[0];
    for (let i = 0; i <= wordEntries.length - firstSeg.length; i++) {
      // check if first segment matches at i
      let okFirst = true;
      for (let m = 0; m < firstSeg.length; m++) {
        if (wordEntries[i + m].clean !== firstSeg[m]) { okFirst = false; break; }
      }
      if (!okFirst) continue;

      // first segment matched at i; now try to find subsequent segments after it
      let cursor = i + firstSeg.length;
      let lastMatchedEnd = i + firstSeg.length; // exclusive index
      let allFound = true;
      for (let s = 1; s < segs.length; s++) {
        const seg = segs[s];
        let foundAt = -1;
        for (let k = cursor; k <= wordEntries.length - seg.length; k++) {
          let ok = true;
          for (let m = 0; m < seg.length; m++) {
            if (wordEntries[k + m].clean !== seg[m]) { ok = false; break; }
          }
          if (ok) { foundAt = k; break; }
        }
        if (foundAt === -1) { allFound = false; break; }
        // advance cursor and record end
        lastMatchedEnd = foundAt + seg.length;
        cursor = foundAt + seg.length;
      }

      if (allFound) {
        const matchStart = i;
        const matchLength = lastMatchedEnd - matchStart; // inclusive span length
        matches.push({ start: matchStart, length: matchLength, note });
      }
    }
  }

  matches.sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length;
    return a.start - b.start;
  });

  const occupied = new Set();
  const map = new Map();

  for (const match of matches) {
    let conflict = false;
    for (let i = 0; i < match.length; i++) {
      if (occupied.has(match.start + i)) {
        conflict = true;
        break;
      }
    }
    if (conflict) continue;
    for (let i = 0; i < match.length; i++) {
      occupied.add(match.start + i);
    }
    map.set(match.start, match);
  }

  return map;
}

function resolveVocabTooltip(cleanWord) {
  if (!cleanWord) return "";
  if (vocabData[cleanWord]) return vocabData[cleanWord];
  const lemma = guessLemmaFromHeuristics(cleanWord);
  if (lemma && vocabData[lemma]) return vocabData[lemma];
  return "";
}

/* ---------- vocab interactions ---------- */
function findVocabEntryForWord(word) {
  const clean = normalize(word);
  if (vocabData[clean]) return document.querySelector(`.vocab-entry[data-word="${clean}"]`);
  const lemma = guessLemmaFromHeuristics(clean);
  if (lemma && vocabData[lemma]) return document.querySelector(`.vocab-entry[data-word="${lemma}"]`);
  const targetStem = stemLatin(clean);
  if (targetStem.length < MIN_STEM_LEN) return null;

  let bestEl = null, bestScore = 0;
  for (const { stem, el } of vocabEntries) {
    let k = 0;
    while (k < targetStem.length && k < stem.length && targetStem[k] === stem[k]) k++;
    if (k > bestScore && k >= MIN_STEM_LEN) { bestScore = k; bestEl = el; }
  }
  return bestEl;
}

function attachVocabEvents() {
  const entries = document.querySelectorAll(".vocab-entry");
  document.querySelectorAll(".word").forEach(span => {
    span.addEventListener("click", (e) => {
      if (e.shiftKey) return; // shift is reserved for notes
      entries.forEach(e => e.classList.remove("highlight"));
      const entry = findVocabEntryForWord(span.dataset.raw);
      if (entry) {
        entry.scrollIntoView({ behavior: "smooth", block: "center" });
        entry.classList.add("highlight");
        setTimeout(() => entry.classList.remove("highlight"), 2000);
      }
    });
  });
}

/* ---------- note display ---------- */
function showNoteInPane(noteObj) {
  const notesPane = document.getElementById('notes-content');
  const existing = notesPane.querySelector(`.note-entry[data-note-id="${noteObj.id}"]`);
  if (existing) {
    existing.classList.add('highlight');
    setTimeout(() => existing.classList.remove('highlight'), 1200);
    existing.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  // fallback: briefly show a transient note (rare if notes are rendered)
  const tmp = document.createElement('div');
  tmp.className = 'note-entry';
  tmp.innerHTML = `<b>${escapeHtml(noteObj.latin_ref)}</b><div class="note-text">${escapeHtml(noteObj.note)}</div>`;
  notesPane.prepend(tmp);
  tmp.classList.add('highlight');
  setTimeout(() => tmp.classList.remove('highlight'), 1200);
  setTimeout(() => tmp.remove(), 3000);
}



/* ---------- boot ---------- */
(async () => {
  // attach chapter button handlers
  document.querySelectorAll('.chapter-btn').forEach(b => {
    b.addEventListener('click', () => setChapter(+b.dataset.ch));
  });

  // load default chapter
  setChapter(currentChapter);
})();
