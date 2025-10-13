// --- small, pragmatic lemmatizer & linker for Latin ---

let notesData = {}; // raw notes map from notes.json
let notesList = []; // processed array of note objects
let currentChapter = 2;
let activeWhitakerController = null;
let currentWhitakerRequest = 0;

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
        // still wire up vocab events (they may be empty) and return
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
  if (activeWhitakerController) {
    activeWhitakerController.abort();
    activeWhitakerController = null;
  }
  currentWhitakerRequest++;
  resetVocabPane();
  // reload notes and text for the chapter
  (async () => {
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

          // Prefer showing the note text for note-available words on hover.
          if (match.note && match.note.note) {
            wordSpan.title = match.note.note;
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

/* ---------- Whitaker's Words integration ---------- */
const DEFAULT_WHITAKER_ENDPOINTS = [
  { label: 'latin.ucant.org', buildUrl: (word) => `https://latin.ucant.org/api/words?word=${encodeURIComponent(word)}` },
  { label: 'latin.ucant.org (html)', buildUrl: (word) => `https://latin.ucant.org/cgi-bin/words?keyword=${encodeURIComponent(word)}` },
  { label: 'archives.nd.edu', buildUrl: (word) => `https://archives.nd.edu/cgi-bin/wordz.pl?keyword=${encodeURIComponent(word)}` },
];

function resetVocabPane() {
  const vocabList = document.getElementById('vocab-list');
  if (!vocabList) return;
  vocabList.innerHTML = `<p class="whitaker-hint"><em>Click a Latin word to look it up with Whitaker's Words.</em></p>`;
}

function getWhitakerEndpoints() {
  const globalSetting = (typeof window !== 'undefined' && window.WHITAKERS_WORDS_ENDPOINTS) || null;
  if (!globalSetting) return DEFAULT_WHITAKER_ENDPOINTS;
  const candidates = Array.isArray(globalSetting) ? globalSetting : [globalSetting];
  const normalized = candidates.map((item, idx) => {
    if (!item) return null;
    if (typeof item === 'function') {
      return { label: `custom ${idx + 1}`, buildUrl: item };
    }
    if (typeof item === 'string') {
      const template = item;
      return {
        label: template.replace(/^https?:\/\//, ''),
        buildUrl: (word) => template.replace(/\{word\}/g, encodeURIComponent(word)),
      };
    }
    if (typeof item === 'object') {
      if (typeof item.buildUrl === 'function') {
        return { label: item.label || `custom ${idx + 1}`, buildUrl: item.buildUrl };
      }
      if (typeof item.url === 'string') {
        const template = item.url;
        const label = item.label || template.replace(/^https?:\/\//, '');
        return {
          label,
          buildUrl: (word) => template.replace(/\{word\}/g, encodeURIComponent(word)),
        };
      }
    }
    return null;
  }).filter(Boolean);
  return normalized.length ? normalized : DEFAULT_WHITAKER_ENDPOINTS;
}

function splitWhitakerBlocks(text) {
  if (!text) return [];
  const cleaned = text.replace(/\r/g, '');
  return cleaned
    .split(/\n{2,}/)
    .map(segment => segment.replace(/^\s*\n/, '').replace(/\s+$/, ''))
    .filter(segment => segment && segment.trim().length);
}

function formatWhitakerText(raw) {
  if (!raw) return [];
  if (typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(raw, 'text/html');
      if (doc) {
        const preBlocks = Array.from(doc.querySelectorAll('pre'));
        if (preBlocks.length) {
          const combined = preBlocks.map((p) => p.textContent || '').join('\n\n');
          if (combined && combined.trim().length) {
            return splitWhitakerBlocks(combined);
          }
        }
        const bodyText = doc.body ? doc.body.textContent : '';
        if (bodyText && bodyText.trim().length) {
          return splitWhitakerBlocks(bodyText);
        }
      }
    } catch (err) {
      console.warn('Whitaker HTML parse failed', err);
    }
  }
  return splitWhitakerBlocks(raw);
}

function formatWhitakerEntry(entry) {
  if (!entry) return '';
  if (typeof entry === 'string') return entry;
  if (typeof entry !== 'object') return String(entry);
  const lines = [];
  const head = entry.entry || entry.head || entry.lemma || entry.word || entry.title || '';
  if (head) lines.push(String(head));
  const defFields = ['definitions','definition','glosses','gloss','meanings','meaning','senses','sense','translations','translation','body','text'];
  const defParts = [];
  for (const field of defFields) {
    const value = entry[field];
    if (!value) continue;
    if (Array.isArray(value)) {
      value.forEach((v) => {
        if (v || v === 0) defParts.push(typeof v === 'string' ? v : JSON.stringify(v));
      });
    } else if (typeof value === 'object') {
      defParts.push(JSON.stringify(value));
    } else {
      defParts.push(String(value));
    }
  }
  if (defParts.length) {
    if (lines.length) lines.push('');
    lines.push(defParts.join('\n'));
  }
  const skipKeys = new Set(['entry','head','lemma','word','title', ...defFields]);
  const extras = [];
  for (const [key, val] of Object.entries(entry)) {
    if (skipKeys.has(key)) continue;
    if (val === undefined) continue;
    extras.push(`${key}: ${typeof val === 'string' ? val : JSON.stringify(val)}`);
  }
  if (extras.length) {
    if (lines.length) lines.push('');
    lines.push(extras.join('\n'));
  }
  return lines.join('\n').trim();
}

function formatWhitakerJson(data) {
  if (!data) return [];
  const collected = [];
  const arrays = [];
  if (Array.isArray(data)) arrays.push(data);
  const candidateKeys = ['entries','Entries','results','result','words','word','data'];
  for (const key of candidateKeys) {
    if (Array.isArray(data[key])) arrays.push(data[key]);
  }
  if (!arrays.length && typeof data === 'object') {
    for (const value of Object.values(data)) {
      if (Array.isArray(value)) arrays.push(value);
    }
  }
  for (const arr of arrays) {
    for (const entry of arr) {
      const text = formatWhitakerEntry(entry);
      if (text) collected.push(text);
    }
    if (collected.length) break;
  }
  if (!collected.length && typeof data === 'object') {
    const text = formatWhitakerEntry(data);
    if (text) collected.push(text);
  }
  return collected;
}

function renderWhitakerResults(displayWord, blocks, sourceLabel, rawMode = false) {
  const vocabList = document.getElementById('vocab-list');
  if (!vocabList) return;
  vocabList.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'whitaker-heading';
  header.innerHTML = `<h3>Whitaker's Words</h3><p><span class="whitaker-word">${escapeHtml(displayWord)}</span>${sourceLabel ? ` · <span class="whitaker-source">${escapeHtml(sourceLabel)}</span>` : ''}</p>`;
  vocabList.appendChild(header);

  if (!blocks.length) {
    const empty = document.createElement('p');
    empty.className = 'whitaker-empty';
    empty.innerHTML = '<em>No results found.</em>';
    vocabList.appendChild(empty);
    return;
  }

  blocks.forEach((block) => {
    const entry = document.createElement('article');
    entry.className = 'whitaker-entry';
    const pre = document.createElement('pre');
    pre.textContent = block;
    entry.appendChild(pre);
    vocabList.appendChild(entry);
  });

  if (rawMode) {
    const hint = document.createElement('p');
    hint.className = 'whitaker-raw-hint';
    hint.innerHTML = '<small>Whitaker\'s Words returned an unexpected format. Displaying raw response.</small>';
    vocabList.appendChild(hint);
  }
}

function renderWhitakerError(displayWord, errors) {
  const vocabList = document.getElementById('vocab-list');
  if (!vocabList) return;
  vocabList.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'whitaker-heading';
  header.innerHTML = `<h3>Whitaker's Words</h3><p><span class="whitaker-word">${escapeHtml(displayWord)}</span></p>`;
  vocabList.appendChild(header);

  const body = document.createElement('div');
  body.className = 'whitaker-error';
  body.innerHTML = '<p><em>Unable to retrieve an entry.</em></p>';

  if (errors && errors.length) {
    const list = document.createElement('ul');
    list.className = 'whitaker-error-list';
    errors.slice(0, 5).forEach((err) => {
      const li = document.createElement('li');
      li.textContent = err;
      list.appendChild(li);
    });
    body.appendChild(list);
  }

  const help = document.createElement('p');
  help.className = 'whitaker-help';
  help.innerHTML = 'If the public Whitaker\'s Words services are blocked, set <code>window.WHITAKERS_WORDS_ENDPOINTS</code> to point at a proxy or local installation before this script loads.';
  body.appendChild(help);

  vocabList.appendChild(body);
}

async function lookupWhitakersWord(rawWord, opts = {}) {
  const vocabList = document.getElementById('vocab-list');
  if (!vocabList) return;

  const seen = new Set();
  const queue = [];

  function pushCandidate(candidate) {
    const normalized = normalize(candidate);
    if (!normalized) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    queue.push(normalized);
  }

  pushCandidate(rawWord);
  if (opts.candidates) {
    opts.candidates.forEach(pushCandidate);
  }
  const base = normalize(rawWord);
  const stripped = stripEnclitic(base || '');
  if (stripped && stripped !== base) pushCandidate(stripped);

  if (!queue.length) {
    resetVocabPane();
    return;
  }

  if (activeWhitakerController) {
    activeWhitakerController.abort();
  }
  const controller = new AbortController();
  activeWhitakerController = controller;
  const requestId = ++currentWhitakerRequest;

  const displayWord = rawWord && rawWord.trim() ? rawWord.trim() : queue[0];

  vocabList.innerHTML = `<p class="whitaker-status"><em>Looking up <strong>${escapeHtml(displayWord)}</strong>…</em></p>`;

  const endpoints = getWhitakerEndpoints();
  const errors = [];

  for (const query of queue) {
    for (const endpoint of endpoints) {
      if (requestId !== currentWhitakerRequest) return;
      let url;
      try {
        url = endpoint.buildUrl(query);
      } catch (err) {
        errors.push(`${endpoint.label}: ${err.message || err}`);
        continue;
      }
      try {
        const response = await fetch(url, { signal: controller.signal, mode: 'cors' });
        if (!response.ok) {
          errors.push(`${endpoint.label}: HTTP ${response.status}`);
          continue;
        }
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          let data;
          try {
            data = await response.json();
          } catch (err) {
            errors.push(`${endpoint.label}: invalid JSON (${err.message || err})`);
            continue;
          }
          if (requestId !== currentWhitakerRequest) return;
          const parsed = formatWhitakerJson(data);
          if (parsed.length) {
            renderWhitakerResults(displayWord, parsed, endpoint.label);
            return;
          }
          const fallback = JSON.stringify(data, null, 2);
          if (fallback && fallback.trim().length) {
            renderWhitakerResults(displayWord, [fallback], endpoint.label, true);
            return;
          }
          errors.push(`${endpoint.label}: empty JSON response`);
          continue;
        }
        const text = await response.text();
        if (requestId !== currentWhitakerRequest) return;
        const parsedText = formatWhitakerText(text);
        if (parsedText.length) {
          renderWhitakerResults(displayWord, parsedText, endpoint.label);
          return;
        }
        if (text && text.trim().length) {
          renderWhitakerResults(displayWord, [text.trim()], endpoint.label, true);
          return;
        }
        errors.push(`${endpoint.label}: empty response`);
      } catch (err) {
        if (controller.signal.aborted) return;
        errors.push(`${endpoint.label}: ${err.message || err}`);
      }
    }
  }

  if (requestId !== currentWhitakerRequest) return;
  renderWhitakerError(displayWord, errors);
}

// Delegated click handler on the main latin text container. This drives the
// Whitaker's Words lookup when the reader clicks a word (unless shift-click
// is used for notes).
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
      span.dataset.raws.split('\t').forEach((tok) => {
        if (tok && !rawCandidates.includes(tok)) rawCandidates.push(tok);
      });
    }
    if (!rawCandidates.length && span.textContent) {
      span.textContent.split(/\s+/).forEach((tok) => {
        if (tok && !rawCandidates.includes(tok)) rawCandidates.push(tok);
      });
    }
    if (!rawCandidates.length) return;

    span.classList.add('clicked');
    setTimeout(() => span.classList.remove('clicked'), 220);

    lookupWhitakersWord(rawCandidates[0], { candidates: rawCandidates });
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
