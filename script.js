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
  console.log(`loadVocab: loading chapter ${currentChapter}`);
  // try chapter-specific vocab in the vocab/ folder first, then fall back
  // to root-level vocab.json for compatibility
  const vocabPath = `vocab/vocab-ch${currentChapter}.json`;
  let resp = await fetch(vocabPath).catch(() => null);
  if (!resp || !resp.ok) {
    // fallback to root-level vocab.json
    resp = await fetch("vocab.json").catch(() => null);
  }
  if (!resp || !resp.ok) {
    vocabData = {};
    const vocabList = document.getElementById("vocab-list");
    if (vocabList) vocabList.innerHTML = `<p><em>Vocabulary not available for chapter ${currentChapter}. If you opened the file directly in the browser (file://), fetch() will fail — try running a local server, e.g. <code>python3 -m http.server 8000</code>.</em></p>`;
    return;
  }
  try {
    vocabData = await resp.json();
  } catch (err) {
    console.error('Failed to parse vocab JSON', err);
    vocabData = {};
    const vocabList = document.getElementById("vocab-list");
    if (vocabList) vocabList.innerHTML = `<p><em>Vocabulary could not be parsed for chapter ${currentChapter}.</em></p>`;
    return;
  }
  const vocabList = document.getElementById("vocab-list");
  vocabList.innerHTML = "";
  vocabEntries = [];
  for (const [lemma, gloss] of Object.entries(vocabData)) {
    const div = document.createElement("div");
    div.className = "vocab-entry";
    div.dataset.word = lemma.toLowerCase();
    // display the value but make everything before the en dash (–) bold
    // if an en dash is present. Escape HTML to be safe.
    if (typeof gloss === 'string' && gloss.indexOf(':') !== -1) {
      const parts = gloss.split(/:/);
      const left = parts.shift().trim();
      const right = parts.join(':').trim();
      // If the left part ends with one or more parenthetical groups, pull
      // them out so they are not included in the bolded text. Example:
      // "faciō (v.t.)" -> bold "faciō" and render "(v.t.)" unbolded.
      const m = left.match(/^(.*?)(\s*(?:\([^)]*\)\s*)+)$/);
      if (m) {
        const mainLeft = m[1].trim();
        const trailingParens = m[2].trim();
        div.innerHTML = `<b>${renderVocabText(mainLeft)}</b> ${renderVocabText(trailingParens)}: ${renderVocabText(right)}`;
      } else {
        div.innerHTML = `<b>${renderVocabText(left)}</b>: ${renderVocabText(right)}`;
      }
    } else {
      div.innerHTML = renderVocabText(gloss);
    }
    vocabList.appendChild(div);
    vocabEntries.push({ lemma: lemma.toLowerCase(), stem: stemLatin(lemma), el: div });
  }
  console.log(`loadVocab: loaded ${vocabEntries.length} entries for chapter ${currentChapter}`);
  if (vocabEntries.length === 0 && vocabList) {
    vocabList.innerHTML = `<p><em>No vocabulary entries found for chapter ${currentChapter}.</em></p>`;
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
    if (!resp || !resp.ok) {
      // show user-friendly message in the notes pane
      notesData = {};
      notesList = [];
      const notesPane = document.getElementById('notes-content');
      if (notesPane) notesPane.innerHTML = `<p><em>Notes not available for chapter ${currentChapter}. If resources fail to load, try running a local server (e.g. <code>python3 -m http.server 8000</code>).</em></p>`;
      return;
    }
    try {
      notesData = await resp.json();
    } catch (err) {
      console.error('Failed to parse notes JSON', err);
      notesData = {};
      notesList = [];
      const notesPane = document.getElementById('notes-content');
      if (notesPane) notesPane.innerHTML = `<p><em>Notes could not be parsed for chapter ${currentChapter}.</em></p>`;
      return;
    }
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
    // If the latin_ref is very long, shorten the displayed heading to
    // a compact 'first ... last' form. We show up to MAX_DISPLAY words
    // (default 12) by combining the first half and last half when needed.
    const MAX_DISPLAY = 12;
    const words = (note.latin_ref || '').split(/\s+/).filter(Boolean);
    let displayRef = note.latin_ref || '';
    if (words.length > MAX_DISPLAY) {
      const head = Math.ceil(MAX_DISPLAY / 2);
      const tail = Math.floor(MAX_DISPLAY / 2);
      const left = words.slice(0, head).join(' ');
      const right = words.slice(words.length - tail).join(' ');
      displayRef = `${left} … ${right}`;
    }
    div.innerHTML = `<b>${renderRichText(displayRef)}</b><div class="note-text">${renderRichText(note.note)}</div>`;
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

  // Replace strong (**text**) first (non-greedy)
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Then italics (*text*) — avoid matching inside already converted strong tags
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');

  return s;
}

// Vocab-specific renderer: uses the safe markdown-like renderer then
// italicizes parenthetical abbreviations (e.g. "(v.t.)") so vocab
// entries show those abbreviations in italics without affecting notes.
function renderVocabText(raw) {
  let s = renderRichText(raw);
  // scan and wrap parenthetical segments whose inner text ends with a dot
  let out = '';
  let i = 0;
  while (i < s.length) {
    const open = s.indexOf('(', i);
    if (open === -1) { out += s.slice(i); break; }
    out += s.slice(i, open);
    const close = s.indexOf(')', open + 1);
    if (close === -1) { out += s.slice(open); break; }
    const inner = s.slice(open + 1, close);
    const innerTrim = inner.trim();
    // skip if inner already contains html tags
    if (/[<]\/?.+?>/.test(inner)) {
      out += s.slice(open, close + 1);
      i = close + 1;
      continue;
    }
    if (innerTrim.endsWith('.')) {
      out += `<em>(${innerTrim})</em>`;
    } else {
      out += s.slice(open, close + 1);
    }
    i = close + 1;
  }
  return out;
}


/* ---------- main text load ---------- */
async function loadChapter() {
  const textPath = `texts/atticus-ch${currentChapter}.txt`;
  try {
    let response = await fetch(textPath).catch(() => null);
    let text = null;
    if (!response || !response.ok) {
      // try a sensible fallback (chapter 2) if the chapter file isn't present
      const fallback = await fetch("texts/atticus-ch2.txt").catch(() => null);
      if (fallback && fallback.ok) {
        text = await fallback.text();
      } else {
        // nothing available — show a friendly message
        const latinContainer = document.getElementById("latin-text");
        if (latinContainer) {
          latinContainer.innerHTML = `<p><em>Sorry — text for chapter ${currentChapter} is not available.</em></p>`;
        }
        // still wire up vocab events (they may be empty) and return
        attachVocabEvents();
        return;
      }
    } else {
      text = await response.text();
    }

    // Normalize escaped-newline sequences and render the cleaned text.
    const normalizedText = text.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n");
    renderLatinText(normalizedText);
    // reset scroll to top of reading pane for new chapter
    const latinContainer = document.getElementById("latin-text");
    if (latinContainer) latinContainer.scrollTop = 0;
    attachVocabEvents();
  } catch (err) {
    console.error('Error loading chapter', err);
    const latinContainer = document.getElementById("latin-text");
    if (latinContainer) latinContainer.innerHTML = `<p><em>Failed to load chapter ${currentChapter}.</em></p>`;
    attachVocabEvents();
  }
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
      // create a stable group id for this matched phrase so we can
      // highlight all constituent words together on hover
      const groupId = `${match.note.id}-${tokenIndex}`;
      let wordsCovered = 0;
      let j = tokenIndex;
      while (j < tokens.length && wordsCovered < match.length) {
        const innerToken = tokens[j];
        if (innerToken.type === 'word') {
          const wordSpan = document.createElement('span');
          wordSpan.classList.add('word', 'note-available');
          wordSpan.dataset.noteId = match.note.id;
          wordSpan.dataset.noteGroup = groupId;
          wordSpan.dataset.noteText = match.note.note;
          wordSpan.dataset.raw = innerToken.raw;
          wordSpan.textContent = innerToken.raw;

          const tooltip = resolveVocabTooltip(innerToken.clean);
          // Prefer showing the note text for note-available words on hover.
          // Fall back to the vocab tooltip only if no note exists.
          if (match.note && match.note.note) {
            wordSpan.title = match.note.note;
          } else if (tooltip) {
            wordSpan.title = tooltip;
          }

          wordSpan.addEventListener('mousedown', (e) => {
            if (e.shiftKey) {
              e.preventDefault();
            }
          });

          wordSpan.addEventListener('click', (e) => {
            if (e.shiftKey) {
              e.preventDefault();
              e.stopPropagation();
              const notesPane = document.getElementById('notes-content');
              const target = notesPane.querySelector(`.note-entry[data-note-id="${match.note.id}"]`);
              if (target) {
                target.classList.add('highlight');
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                setTimeout(() => target.classList.remove('highlight'), 1200);
              } else {
                showNoteInPane(match.note);
              }
              return;
            }
          });

          // hover interactions: when entering any word in the phrase,
          // highlight the entire phrase and specially mark the hovered word
          wordSpan.addEventListener('mouseenter', (e) => {
            const group = wordSpan.dataset.noteGroup;
            if (!group) return;
            document.querySelectorAll(`.word.note-available[data-note-group="${group}"]`).forEach(el => el.classList.add('note-hover'));
            wordSpan.classList.add('note-hover-word');
          });
          wordSpan.addEventListener('mouseleave', (e) => {
            const group = wordSpan.dataset.noteGroup;
            if (!group) return;
            document.querySelectorAll(`.word.note-available[data-note-group="${group}"]`).forEach(el => el.classList.remove('note-hover'));
            wordSpan.classList.remove('note-hover-word');
          });

          fragment.appendChild(wordSpan);
          wordsCovered++;
        } else {
          fragment.appendChild(document.createTextNode(innerToken.raw));
        }
        j++;
      }

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

      const rawCandidates = [];
      if (span.dataset.raw) rawCandidates.push(span.dataset.raw);
      if (span.dataset.raws) {
        for (const token of span.dataset.raws.split('\t')) {
          if (token && !rawCandidates.includes(token)) rawCandidates.push(token);
        }
      }
      if (!rawCandidates.length && span.textContent) {
        span.textContent.split(/\s+/).forEach(tok => {
          if (tok && !rawCandidates.includes(tok)) rawCandidates.push(tok);
        });
      }

      let entry = null;
      for (const raw of rawCandidates) {
        entry = findVocabEntryForWord(raw);
        if (entry) break;
      }

      if (entry) {
        entry.scrollIntoView({ behavior: "smooth", block: "center" });
        entry.classList.add("highlight");
        setTimeout(() => entry.classList.remove("highlight"), 2000);
      }
    });
  });
}

// Delegated click handler on the main latin text container. This is
// robust against per-span event ordering or accidental stopPropagation
// from other handlers. It will only act on non-shift clicks and will
// highlight the first matching vocab entry for the clicked word.
let _latinDelegatedAttached = false;
function attachDelegatedLatinClick() {
  if (_latinDelegatedAttached) return;
  const latin = document.getElementById('latin-text');
  if (!latin) return;
  latin.addEventListener('click', (e) => {
    if (e.shiftKey) return; // keep shift for notes
    const span = e.target.closest && e.target.closest('.word');
    if (!span || !latin.contains(span)) return;
    // find vocab entry using dataset.raw or the first token
    // Build an array of candidate tokens from the clicked span. If the
    // span stored multiple raws (for multi-word phrases) try them in
    // order left-to-right, then right-to-left as a fallback.
    const rawCandidates = span.dataset.raws ? span.dataset.raws.split('\t') : [(span.dataset.raw || (span.textContent || '').split(/\s+/)[0])];
    let foundEntry = null;
    for (const c of rawCandidates) {
      const e = findVocabEntryForWord(c);
      if (e) { foundEntry = e; break; }
    }
    if (!foundEntry) {
      for (let i = rawCandidates.length - 1; i >= 0; i--) {
        const e = findVocabEntryForWord(rawCandidates[i]);
        if (e) { foundEntry = e; break; }
      }
    }
    if (foundEntry) {
      // clear previous highlights
      document.querySelectorAll('.vocab-entry.highlight').forEach(x => x.classList.remove('highlight'));
      foundEntry.scrollIntoView({ behavior: 'smooth', block: 'center' });
      foundEntry.classList.add('highlight');
      setTimeout(() => foundEntry.classList.remove('highlight'), 2000);
    }
  });
  _latinDelegatedAttached = true;
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
async function bootstrapApp() {
  // attach chapter button handlers
  document.querySelectorAll('.chapter-btn').forEach(b => {
    b.addEventListener('click', () => setChapter(+b.dataset.ch));
  });

  // Instructions modal wiring
  const instrBtn = document.getElementById('instructions-btn');
  const instrModal = document.getElementById('instructions-modal');
  if (instrBtn && instrModal) {
    function openInstr() {
      instrModal.setAttribute('aria-hidden', 'false');
      // move focus into modal
      const firstFocusable = instrModal.querySelector('button, a, [tabindex]');
      if (firstFocusable) firstFocusable.focus();
      document.addEventListener('keydown', handleEsc);
    }
    function closeInstr() {
      instrModal.setAttribute('aria-hidden', 'true');
      instrBtn.focus();
      document.removeEventListener('keydown', handleEsc);
    }
    function handleEsc(e) {
      if (e.key === 'Escape') closeInstr();
    }

    instrBtn.addEventListener('click', openInstr);
    instrModal.querySelectorAll('[data-action="close"]').forEach(el => el.addEventListener('click', closeInstr));
    // overlay click closes (already wired via data-action close selector)
    instrModal.addEventListener('click', (e) => {
      if (e.target === instrModal.querySelector('.modal-overlay')) closeInstr();
    });
  }

  // attach delegated click handler for vocab lookups
  attachDelegatedLatinClick();

  // load default chapter
  setChapter(currentChapter);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrapApp, { once: true });
} else {
  bootstrapApp();
}
