// --- small, pragmatic lemmatizer & linker for Latin ---

let vocabData = {};
let vocabEntries = [];
let notesData = {}; // new
const MIN_STEM_LEN = 3;

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
  const resp = await fetch("vocab.json");
  vocabData = await resp.json();
  const vocabList = document.getElementById("vocab-list");
  vocabList.innerHTML = "";
  vocabEntries = [];
  for (const [lemma, gloss] of Object.entries(vocabData)) {
    const div = document.createElement("div");
    div.className = "vocab-entry";
    div.dataset.word = lemma.toLowerCase();
    div.innerHTML = `<b>${lemma}</b> — ${gloss}`;
    vocabList.appendChild(div);
    vocabEntries.push({ lemma: lemma.toLowerCase(), stem: stemLatin(lemma), el: div });
  }
}

/* ---------- load notes ---------- */
async function loadNotes() {
  const resp = await fetch("notes.json");
  notesData = await resp.json();
}

function getNoteFor(word) {
  const w = normalize(word);
  return Object.values(notesData).find(n =>
    n.latin_ref.toLowerCase().includes(w)
  );
}

/* ---------- main text load ---------- */
async function loadChapter() {
  const response = await fetch("texts/atticus-ch2.txt");
  const text = await response.text();

  const words = text.split(/\s+/);
  const latinContainer = document.getElementById("latin-text");
  latinContainer.innerHTML = "";
  const p = document.createElement("p");

  words.forEach((raw) => {
    const clean = normalize(raw);
    const span = document.createElement("span");
    span.className = "word";
    span.dataset.raw = raw;
    span.textContent = raw + " ";

    // vocab tooltip
    if (vocabData[clean]) {
      span.title = vocabData[clean];
    } else {
      const lemma = guessLemmaFromHeuristics(clean);
      if (lemma && vocabData[lemma]) span.title = vocabData[lemma];
    }

    // note check
    const noteObj = getNoteFor(clean);
    if (noteObj) {
      span.classList.add("note-available");
      span.title = noteObj.note; // hover shows note
      // Shift-click reveals note in Notes pane
      span.addEventListener("click", (e) => {
        if (e.shiftKey) showNoteInPane(noteObj);
      });
    }

    p.appendChild(span);
  });

  latinContainer.appendChild(p);
  attachVocabEvents();
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
  const notesPane = document.getElementById("notes-content");
  const noteDiv = document.createElement("div");
  noteDiv.className = "note";
  noteDiv.innerHTML = `<b>${noteObj.latin_ref}</b><p>${noteObj.note}</p>`;
  notesPane.prepend(noteDiv);
  noteDiv.scrollIntoView({ behavior: "smooth", block: "center" });
}

/* ---------- boot ---------- */
(async () => {
  await loadVocab();
  await loadNotes();
  await loadChapter();
})();
