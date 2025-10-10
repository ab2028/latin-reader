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

  let i = 1;
  for (const [latin, gloss] of Object.entries(vocab)) {
    const div = document.createElement("div");
    div.className = "vocab-entry";
    div.id = `vocab-${i}`;
    div.innerHTML = `<b>${latin}</b> — ${gloss}`;
    vocabList.appendChild(div);
    i++;
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
    const cleanWord = word.replace(/[.,;:?!]/g, "").toLowerCase();
    const span = document.createElement("span");
    span.className = "word";
    span.dataset.id = i + 1;
    span.textContent = word + " ";

    // tooltip from vocab.json
    if (vocabData[cleanWord]) {
      span.title = vocabData[cleanWord];
    }

    p.appendChild(span);
  });

  latinContainer.appendChild(p);
  attachEvents();
}

function attachEvents() {
  document.querySelectorAll(".word").forEach(w => {
    w.addEventListener("mouseenter", () => {
      const tooltip = w.title;
      if (!tooltip) return;
    });

    w.addEventListener("dblclick", () => {
      const cleanWord = w.textContent.replace(/[.,;:?!]/g, "").toLowerCase();
      const entries = document.querySelectorAll(".vocab-entry");
      entries.forEach(v => v.classList.remove("highlight"));

      const entry = Array.from(entries).find(e =>
        e.textContent.toLowerCase().startsWith(cleanWord)
      );

      if (entry) {
        entry.scrollIntoView({ behavior: "smooth", block: "center" });
        entry.classList.add("highlight");
        setTimeout(() => entry.classList.remove("highlight"), 2000);
      }
    });
  });
}

(async () => {
  await loadVocab();
  await loadChapter();
})();
