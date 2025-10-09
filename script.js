async function loadChapter() {
  const response = await fetch("texts/atticus-ch2.txt");
  const text = await response.text();

  const words = text.split(/\s+/);
  const latinContainer = document.getElementById("latin-text");
  latinContainer.innerHTML = "";

  const p = document.createElement("p");
  words.forEach((word, i) => {
    const span = document.createElement("span");
    span.className = "word";
    span.dataset.id = i + 1;
    span.textContent = word + " ";
    p.appendChild(span);
  });

  latinContainer.appendChild(p);
  attachEvents();
}

function attachEvents() {
  document.querySelectorAll(".word").forEach(w => {
    w.addEventListener("mouseenter", () => {
      const id = w.dataset.id;
      document.querySelectorAll(".vocab-entry").forEach(v => v.classList.remove("highlight"));
      const entry = document.querySelector(`#vocab-${id}`);
      if (entry) entry.classList.add("highlight");
    });

    w.addEventListener("dblclick", () => {
      const id = w.dataset.id;
      const entry = document.querySelector(`#vocab-${id}`);
      if (entry) {
        entry.scrollIntoView({ behavior: "smooth", block: "center" });
        entry.classList.add("highlight");
        setTimeout(() => entry.classList.remove("highlight"), 1500);
      }
    });
  });
}

loadChapter();
