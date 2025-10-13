// --- small, pragmatic lemmatizer & linker for Latin ---

let notesData = {}; // raw notes map from notes.json
let notesList = []; // processed array of note objects
let currentChapter = 2;
let latestLookupToken = 0; // used to discard stale Whitaker responses
const WHITAKER_ENDPOINTS = [
  word => `https://latin-words.com/cgi-bin/translate.cgi?latin=${encodeURIComponent(word)}`,
  word => `https://latin-words.com/cgi-bin/translate.cgi?backup=1&latin=${encodeURIComponent(word)}`,
  word => `https://archives.nd.edu/cgi-bin/wordz.pl?keyword=${encodeURIComponent(word)}`,
];

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

/* ---------- Whitaker lookup ---------- */
function initializeVocabPane() {
  const vocabList = document.getElementById('vocab-list');
  if (!vocabList) return;
  vocabList.innerHTML = `<p class="lookup-status"><em>Click a word in the Latin text to look it up in Whitaker’s Words via latin-words.com (internet connection required).</em></p>`;
  vocabList.setAttribute('aria-live', 'polite');
}

function collectLookupCandidates(rawCandidates) {
  const candidates = [];
  const seen = new Set();
  for (const raw of rawCandidates) {
    if (!raw) continue;
    const cleaned = normalize(raw);
    if (!cleaned) continue;
    if (!seen.has(cleaned)) {
      candidates.push(cleaned);
      seen.add(cleaned);
    }
    const stripped = stripEnclitic(cleaned);
    if (stripped && !seen.has(stripped)) {
      candidates.push(stripped);
      seen.add(stripped);
    }
  }
  return candidates;
}

function buildWhitakerUrl(word, endpointIndex = 0) {
  const idx = Math.max(0, Math.min(endpointIndex, WHITAKER_ENDPOINTS.length - 1));
  const builder = WHITAKER_ENDPOINTS[idx] || WHITAKER_ENDPOINTS[0];
  try {
    return builder(String(word || ''));
  } catch (err) {
    console.warn('Failed to build Whitaker URL', err);
    return WHITAKER_ENDPOINTS[0](String(word || ''));
  }
}

function renderLookupError(word, message, linkWord, linkUrl) {
  const vocabList = document.getElementById('vocab-list');
  if (!vocabList) return;
  const target = linkWord || word;
  const href = linkUrl || buildWhitakerUrl(target, 0);
  vocabList.innerHTML = `
    <div class="lookup-status error">
      <strong>Whitaker’s Words lookup failed</strong> for “${escapeHtml(word)}”.<br>
      ${escapeHtml(message)}
      <div class="lookup-actions">
        <a href="${href}" target="_blank" rel="noopener noreferrer">Open Whitaker’s Words in a new tab</a>
      </div>
    </div>
  `;
}

function renderLookupResult(originalWord, lookedUpWord, text, sourceUrl) {
  const vocabList = document.getElementById('vocab-list');
  if (!vocabList) return;
  vocabList.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'lookup-status success';
  const sameWord = originalWord === lookedUpWord;
  header.innerHTML = `
    <strong>Whitaker’s Words</strong> for “${escapeHtml(originalWord)}”
    ${sameWord ? '' : `<span class="lookup-note">(searched as “${escapeHtml(lookedUpWord)}”)</span>`}
  `;

  const pre = document.createElement('pre');
  pre.className = 'whitaker-output';
  pre.textContent = text;

  const footer = document.createElement('div');
  footer.className = 'lookup-actions';
  const link = document.createElement('a');
  link.href = sourceUrl || buildWhitakerUrl(lookedUpWord, 0);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'Open in new tab';
  footer.appendChild(link);

  vocabList.appendChild(header);
  vocabList.appendChild(pre);
  vocabList.appendChild(footer);
}

async function lookupWhitakersWords(rawCandidates) {
  const vocabList = document.getElementById('vocab-list');
  if (!vocabList) return;

  const displayWordRaw = (rawCandidates || []).find(w => w && w.trim());
  const candidates = collectLookupCandidates(rawCandidates);
  if (!candidates.length) {
    const displayWord = displayWordRaw ? displayWordRaw.trim() : '—';
    renderLookupError(displayWord, 'No valid word selected.', '');
    return;
  }

  const displayWord = displayWordRaw ? displayWordRaw.trim() : candidates[0];
  const originalWord = candidates[0];
  const requestId = ++latestLookupToken;

  vocabList.innerHTML = `<p class="lookup-status"><em>Looking up “${escapeHtml(displayWord)}” in Whitaker’s Words…</em></p>`;

  let lastError = null;
  let lastTried = null;
  let lastEndpointIndex = 0;
  for (const candidate of candidates) {
    for (let endpointIndex = 0; endpointIndex < WHITAKER_ENDPOINTS.length; endpointIndex++) {
      const url = buildWhitakerUrl(candidate, endpointIndex);
      try {
        lastTried = candidate;
        lastEndpointIndex = endpointIndex;
        const resp = await fetch(url, { mode: 'cors' });
        if (requestId !== latestLookupToken) return;
        if (!resp || !resp.ok) {
          throw new Error(`HTTP ${resp ? resp.status : 'network error'}`);
        }
        const html = await resp.text();
        if (requestId !== latestLookupToken) return;
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const text = extractWhitakerText(doc);
        if (text) {
          renderLookupResult(displayWord, candidate, text, url);
          return;
        }
      } catch (err) {
        console.warn('Whitaker lookup failed for', candidate, 'via', url, err);
        lastError = err;
      }
    }
  }

  if (requestId !== latestLookupToken) return;
  const fallbackMessage = lastError
    ? 'Unable to retrieve a response from Whitaker’s Words. Some browsers block cross-site requests; you can use the link below instead.'
    : 'The online service did not return any results.';
  const linkWord = lastTried || originalWord;
  renderLookupError(displayWord, fallbackMessage, linkWord, buildWhitakerUrl(linkWord, lastEndpointIndex));
}

function extractWhitakerText(doc) {
  if (!doc) return '';
  const normalizeWhitakerText = raw => {
    if (!raw) return '';
    return raw
      .replace(/\u00a0/g, ' ')
      .replace(/\r/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  const pre = doc.querySelector('pre');
  if (pre && pre.textContent && pre.textContent.trim()) {
    return normalizeWhitakerText(pre.textContent);
  }

  const textarea = doc.querySelector('textarea');
  if (textarea && textarea.textContent && textarea.textContent.trim()) {
    return normalizeWhitakerText(textarea.textContent);
  }

  const main = doc.querySelector('#content, main, article');
  if (main && main.textContent && main.textContent.trim()) {
    return normalizeWhitakerText(main.textContent);
  }

  const bodyText = doc.body && doc.body.textContent ? doc.body.textContent : '';
  return normalizeWhitakerText(bodyText);
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
  } catch (err) {
    console.error('Error loading chapter', err);
    const latinContainer = document.getElementById("latin-text");
    if (latinContainer) latinContainer.innerHTML = `<p><em>Failed to load chapter ${currentChapter}.</em></p>`;
  }
}

function setChapter(n) {
  currentChapter = n;
  document.querySelectorAll('.chapter-btn').forEach(b => b.classList.toggle('active', +b.dataset.ch === n));
  // reload notes and text for the chapter, and reset the vocab pane
  (async () => {
    initializeVocabPane();
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
  return `Click to look up “${cleanWord}” in Whitaker’s Words.`;
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
    const rawCandidates = [];
    if (span.dataset.raw) rawCandidates.push(span.dataset.raw);
    if (span.dataset.raws) {
      for (const token of span.dataset.raws.split('\t')) {
        if (token) rawCandidates.push(token);
      }
    }
    if (!rawCandidates.length && span.textContent) {
      const firstToken = (span.textContent || '').split(/\s+/)[0];
      if (firstToken) rawCandidates.push(firstToken);
    }
    lookupWhitakersWords(rawCandidates);
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

  // prepare the vocab pane with instructions before any lookups occur
  initializeVocabPane();

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
