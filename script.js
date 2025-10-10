// --- small, pragmatic lemmatizer & linker for Latin ---

let vocabData = {};
let vocabEntries = [];      // [{ lemma, stem, el }]
const MIN_STEM_LEN = 3;

// remove punctuation / lowercase
function normalize(w) {
  return (w || "")
    .toLowerCase()
    .replace(/[()[\]{}.,;:!?'"“”‘’«»\-–—]/g, "")
    .trim();
}

// strip enclitics: -que, -ve, -ne
function stripEnclitic(w) {
  if (w.endsWith("que") && w.length > 4) return w.slice(0, -3);
  if (w.endsWith("ve")  && w.length > 3) return w.slice(0, -2);
  if (w.endsWith("ne")  && w.length > 3) return w.slice(0, -2);
  return w;
}

// very light stemmer: remove common nominal/verb endings once
function stemLatin(w) {
  let base = stripEnclitic(normalize(w));

  const nounAdjSuffixes = [
    "orum","arum","ibus","ium","uum",
    "ae","am","as","os","um","us","is","e","i","o","u","em","es","a"
  ];
  const verbSuffixes = [
    "ntur","tur","mini","mur",
    "mus","tis",
    "unt","ent","ant",
    "ris","re",
    "isti","imus","itis","erunt","ere",
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

// very small irregulars used in this chapter / common
const IRREGULAR_FORMS = new Map([
  // sum
  ["est","sum"],["sunt","sum"],["esse","sum"],["erat","sum"],["fuit","sum"],["fuerunt","sum"],["sit","sum"],["sint","sum"],
  // fero & compounds (enough for contulit)
  ["tulit","fero"],["latus","fero"],["contulit","confero"],
  // augeo perfect
  ["auxit","augeo"]
]);

function guessLemmaFromHeuristics(word) {
  const w = normalize(word);
  if (IRREGULAR_FORMS.has(w)) return IRREGULAR_FORMS.get(w);

  // quick 2nd-decl gen -> nom
  if (w.endsWith("i") && w.length > 2) {
    const root = w.slice(0, -1);
    const cand1 = root + "us";
    const cand2 = root + "um";
    if (vocabData[cand1]) return cand1;
    if (vocabData[cand2]) return cand2;
  }
  // 1st-decl gen -> nom
  if (w.endsWith("ae") && w.length > 3) {
    const cand = w.slice(0, -2) + "a";
    if (vocabData[cand]) return cand;
  }

  // fallback: stem match against vocab stems
  const targetStem = stemLatin(w);
  if (targetStem.length < MIN_STEM_LEN) return null;

  let best = null;
  let bestScore = 0;
  for (const { lemma, stem } of vocabEntries) {
    const s = stem;
    // score: length of common prefix
    let k = 0;
    while (k < targetStem.length && k < s.length && targetStem[k] === s[k]) k++;
    if (k > bestScore && k >= MIN_STEM_LEN) {
      bestScore = k;
      best = lemma;
    }
  }
  return best;
}

async function loadVocab() {
  const resp = await fetch("vocab.json");
  vocabData = await resp.json();

  // build sidebar + stems
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

async function loadChapter() {
  const response = await fetch("texts/atticus-ch2.txt");
  const text = await response.text();

  const words = text.split(/\s+/);
  const latinContainer = document.getElementById("latin-text");
  latinContainer.innerHTML = "";

  const p = document.createElement("p");
  words.forEach((raw, i) => {
    const clean = normalize(raw);
    const span = document.createElement("span");
    span.className = "word";
    span.dataset.raw = raw;         // original with punctuation
    span.dataset.clean = clean;     // normalized
    span.textContent = raw + " ";

    // tooltip if exact lemma present
    if (vocabData[clean]) {
      span.title = vocabData[clean];
    } else {
      // try to guess lemma for tooltip too
      const lemma = guessLemmaFromHeuristics(clean);
      if (lemma && vocabData[lemma]) {
        span.title = vocabData[lemma];
        span.dataset.lemma = lemma;
      }
    }

    p.appendChild(span);
  });

  latinContainer.appendChild(p);
  attachEvents();
}

function findVocabEntryForWord(word) {
  const clean = normalize(word);

  // direct hit
  if (vocabData[clean]) {
    return document.querySelector(`.vocab-entry[data-word="${clean}"]`);
  }

  // heuristic lemma
  const lemma = guessLemmaFromHeuristics(clean);
  if (lemma && vocabData[lemma]) {
    return document.querySelector(`.vocab-entry[data-word="${lemma}"]`);
  }

  // final fallback: stem compare
  const targetStem = stemLatin(clean);
  if (targetStem.length < MIN_STEM_LEN) return null;

  let bestEl = null;
  let bestScore = 0;
  for (const { stem, el } of vocabEntries) {
    let k = 0;
    while (k < targetStem.length && k < stem.length && targetStem[k] === stem[k]) k++;
    if (k > bestScore && k >= MIN_STEM_LEN) {
      bestScore = k;
      bestEl = el;
    }
  }
  return bestEl;
}

function attachEvents() {
  const entries = document.querySelectorAll(".vocab-entry");

  // single-click on a word: jump + highlight in sidebar
  document.querySelectorAll(".word").forEach(span => {
    span.addEventListener("click", () => {
      entries.forEach(e => e.classList.remove("highlight"));

      const raw = span.dataset.raw;
      const entry = findVocabEntryForWord(raw);
      if (entry) {
        entry.scrollIntoView({ behavior: "smooth", block: "center" });
        entry.classList.add("highlight");
        setTimeout(() => entry.classList.remove("highlight"), 2000);
      }
    });
  });

  // (keep selection behavior too, if you like)
  document.addEventListener("mouseup", () => {
    const sel = window.getSelection().toString().trim();
    if (!sel) return;
    entries.forEach(e => e.classList.remove("highlight"));
    const entry = findVocabEntryForWord(sel);
    if (entry) {
      entry.scrollIntoView({ behavior: "smooth", block: "center" });
      entry.classList.add("highlight");
      setTimeout(() => entry.classList.remove("highlight"), 2000);
    }
  });
}

// boot
(async () => {
  await loadVocab();   // builds sidebar + index
  await loadChapter(); // renders text with tooltips
})();
