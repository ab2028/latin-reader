let vocabData = {};

async function loadVocab() {
  try {
    const response = await fetch("vocab.json");
    vocabData = await response.json();
    buildVocabSidebar(vocabData);
  } catch (err) {
    console.error("Failed to load vocab.json", err);
  }
}

function buildVocabSidebar(vocab) {
  const vocabList = document.getElementById("vocab-list");
  vocabList.innerHTML = "";

  for (const [latin, gloss] of Object.entries(vocab)) {
    const div = document.createElement("div");
    div.className = "vocab-entry";
    div.dataset.word = latin.toLowerCase();
    div.innerHTML = `<b>${latin}</b> — ${gloss}`;
    vocabList.appendChild(div);
  }
}

async function loadChapter() {
  const response = await fetch("texts/atticus-ch2.txt");
  const text = await response.text();

  const words = text.split(/\s+/);
  const latinContainer = document.getElementById("latin-text");
  latinContainer.innerHTML = "";

  const p = document.createElement("p");
  words.forEach((word, i) => {
    const cleanWord = word.replace(/[.,;:?!()]/g, "").toLowerCase();
    const span = document.createElement("span");
    span.className = "word";
    span.dataset.word = cleanWord;
    span.textContent = word + " ";

    // Add tooltip if in vocab
    if (vocabData[cleanWord]) {
      span.title = vocabData[cleanWord];
    }

    p.appendChild(span);
  });

  latinContainer.appendChild(p);
  attachEvents();
}

function attachEvents() {
  const vocabEntries = document.querySelectorAll(".vocab-entry");

  document.querySelectorAll(".word").forEach(wordSpan => {
    // Hover: tooltip handled by browser automatically
    // Single click → scroll + highlight
    wordSpan.addEventListener("click", () => {
      const w = wordSpan.dataset.word;
      const entry = Array.from(vocabEntries).find(e => e.dataset.word === w);
      if (entry) {
        vocabEntries.forEach(e => e.classList.remove("highlight"));
        entry.scrollIntoView({ behavior: "smooth", block: "center" });
        entry.classList.add("highlight");
        setTimeout(() => entry.classList.remove("highlight"), 2000);
      }
    });
  });
}

// Optional: highlight on selection
document.addEventListener("mouseup", () => {
  const sel = window.getSelection().toString().trim().toLowerCase();
  if (sel && vocabData[sel]) {
    const entry = document.querySelector(`.vocab-entry[data-word="${sel}"]`);
    if (entry) {
      entry.scrollIntoView({ behavior: "smooth", block: "center" });
      entry.classList.add("highlight");
      setTimeout(() => entry.classList.remove("highlight"), 2000);
    }
  }
});

(async () => {
  await loadVocab();
  await loadChapter();
})();
