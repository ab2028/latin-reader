// --- small, pragmatic lemmatizer & linker for Latin ---

let notesData = {}; // raw notes map from notes.json
let notesList = []; // processed array of note objects
let currentChapter = 2;
let latestLookupToken = 0; // used to discard stale Whitaker responses
const WHITAKER_PROXY_URL = 'https://xmxyejzhsershpordgwj.supabase.co/functions/v1/whitaker-proxy';
const WHITAKER_ENDPOINTS_COUNT = 3;
const THEME_STORAGE_KEY = 'latin-reader-theme';
const THEME_DEFAULT = 'default';
const THEME_HIGH = 'high';
let themeStorageWriteWarningShown = false;
let themeStorageReadWarningShown = false;
const CREATOR_MODE_STORAGE_KEY = 'latin-reader-creator-mode';
const CREATOR_VOCAB_STORAGE_KEY = 'latin-reader-your-vocab';
const CREATOR_NOTES_STORAGE_KEY = 'latin-reader-your-notes';
let creatorModeEnabled = false;
let creatorModeShortcutBound = false;
let creatorStorageWriteWarningShown = false;
let creatorStorageReadWarningShown = false;
let userVocabEntries = [];
let userNotesEntries = [];
let userVocabByNormalized = new Map();
let userNotesById = new Map();
let currentLatinText = '';
const CREATOR_PANE_DEFAULTS = {
  vocab: 'whitaker-pane',
  notes: 'book-notes-pane',
};
let activeCreatorPanes = { ...CREATOR_PANE_DEFAULTS };

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

/* ---------- creator mode persistence ---------- */
function loadCreatorModeFlag() {
  try {
    const stored = localStorage.getItem(CREATOR_MODE_STORAGE_KEY);
    return stored === 'true';
  } catch (err) {
    if (!creatorStorageReadWarningShown) {
      console.warn('Unable to read creator mode flag', err);
      creatorStorageReadWarningShown = true;
    }
    return false;
  }
}

function persistCreatorModeFlag(value) {
  try {
    localStorage.setItem(CREATOR_MODE_STORAGE_KEY, value ? 'true' : 'false');
  } catch (err) {
    if (!creatorStorageWriteWarningShown) {
      console.warn('Unable to persist creator mode flag', err);
      creatorStorageWriteWarningShown = true;
    }
  }
}

function readCreatorCollection(key, fallback) {
  const base = Array.isArray(fallback) ? [...fallback] : fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (err) {
    if (!creatorStorageReadWarningShown) {
      console.warn('Unable to read creator collection', key, err);
      creatorStorageReadWarningShown = true;
    }
    return base;
  }
}

function writeCreatorCollection(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    if (!creatorStorageWriteWarningShown) {
      console.warn('Unable to persist creator collection', key, err);
      creatorStorageWriteWarningShown = true;
    }
  }
}

function normalizeCreatorVocabEntries(rawEntries) {
  if (!Array.isArray(rawEntries)) return [];
  const entries = [];
  for (const item of rawEntries) {
    const word = (item && item.word) ? String(item.word).trim() : '';
    const definition = (item && item.definition) ? String(item.definition).trim() : '';
    const normalized = normalize(word);
    if (!word || !normalized || !definition) continue;
    const id = item && item.id ? String(item.id) : `v-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const rawChapter = item && (item.chapter ?? item.chapterId ?? item.chapter_id);
    const numericChapter = Number(rawChapter);
    const chapter = Number.isFinite(numericChapter) && numericChapter > 0 ? numericChapter : currentChapter;
    entries.push({ id, word, definition, normalized, chapter });
  }
  return entries;
}

function normalizeCreatorNotesEntries(rawEntries) {
  if (!Array.isArray(rawEntries)) return [];
  const entries = [];
  for (const item of rawEntries) {
    const phrase = (item && (item.phrase || item.word)) ? String(item.phrase || item.word).trim() : '';
    const note = (item && (item.note || item.text)) ? String(item.note || item.text).trim() : '';
    if (!phrase || !note) continue;
    const tokens = phrase.split(/\s+/).map(normalize).filter(Boolean);
    if (!tokens.length) continue;
    const id = item && item.id ? String(item.id) : `n-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const rawChapter = item && (item.chapter ?? item.chapterId ?? item.chapter_id);
    const numericChapter = Number(rawChapter);
    const chapter = Number.isFinite(numericChapter) && numericChapter > 0 ? numericChapter : currentChapter;
    entries.push({ id, phrase, note, tokens, chapter });
  }
  return entries;
}

function loadCreatorCollections() {
  const vocabRaw = readCreatorCollection(CREATOR_VOCAB_STORAGE_KEY, []);
  const notesRaw = readCreatorCollection(CREATOR_NOTES_STORAGE_KEY, []);
  userVocabEntries = normalizeCreatorVocabEntries(vocabRaw);
  userNotesEntries = normalizeCreatorNotesEntries(notesRaw);
  rebuildCreatorCaches();
}

function persistUserVocab() {
  writeCreatorCollection(CREATOR_VOCAB_STORAGE_KEY, userVocabEntries);
}

function persistUserNotes() {
  writeCreatorCollection(CREATOR_NOTES_STORAGE_KEY, userNotesEntries);
}

function rebuildCreatorCaches() {
  userVocabByNormalized = new Map();
  for (const entry of userVocabEntries) {
    if (!entry || !entry.normalized) continue;
    if (!userVocabByNormalized.has(entry.normalized)) {
      userVocabByNormalized.set(entry.normalized, []);
    }
    userVocabByNormalized.get(entry.normalized).push(entry);
  }

  userNotesById = new Map();
  for (const entry of userNotesEntries) {
    if (!entry || !entry.id) continue;
    userNotesById.set(entry.id, entry);
  }
}

function getCurrentChapterVocabEntries(normalized) {
  if (!normalized) return [];
  const entries = userVocabByNormalized.get(normalized);
  if (!entries || !entries.length) return [];
  return entries.filter((entry) => Number(entry.chapter) === currentChapter);
}

function ensureCreatorModeShortcut() {
  if (creatorModeShortcutBound) return;
  creatorModeShortcutBound = true;
  document.addEventListener('keydown', (event) => {
    // Accept Ctrl OR Meta (Cmd) so shortcut works on macOS whether user
    // presses Control or Command.
    if ((event.ctrlKey || event.metaKey) && event.altKey && event.shiftKey) {
      const key = event.key || '';
      const code = event.code || '';
      // Use event.code so Option/Alt modifiers (e.g., on macOS) still register the physical L key.
      const isLetterL = code === 'KeyL' || key.toLowerCase() === 'l';
      if (isLetterL) {
        event.preventDefault();
        // ignore if typing inside an input/textarea or contentEditable
        const tgt = event.target || {};
        const tag = (tgt.tagName || '').toLowerCase();
        const isEditable = tgt.isContentEditable || tag === 'input' || tag === 'textarea' || tgt.getAttribute && tgt.getAttribute('role') === 'textbox';
        if (isEditable) return;
        console.log('Creator shortcut triggered — toggling Creator Mode');
        toggleCreatorMode();
      }
    }
  });
}

function toggleCreatorMode() {
  // Toggle creator mode without reloading the page and persist preference.
  enableCreatorMode(!creatorModeEnabled);
}

function applyCreatorModeClass() {
  const body = document.body;
  if (!body) return;
  body.classList.toggle('creator-mode', creatorModeEnabled);
}

creatorModeEnabled = loadCreatorModeFlag();
loadCreatorCollections();
ensureCreatorModeShortcut();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    applyCreatorModeClass();
  }, { once: true });
} else {
  applyCreatorModeClass();
}

function getActivePaneForGroup(group) {
  const fallback = CREATOR_PANE_DEFAULTS[group] || null;
  if (!creatorModeEnabled) return fallback;
  return activeCreatorPanes[group] || fallback;
}

function updateCreatorPaneVisibility() {
  const navs = document.querySelectorAll('.pane-toggle');
  navs.forEach((nav) => {
    const group = nav.dataset.paneGroup || 'vocab';
    const defaultPane = CREATOR_PANE_DEFAULTS[group];
    const activePane = getActivePaneForGroup(group);

    nav.hidden = !creatorModeEnabled;

    const tabs = nav.querySelectorAll('[data-pane]');
    tabs.forEach((tab) => {
      const paneId = tab.dataset.pane;
      const tabGroup = tab.dataset.paneGroup || group;
      const tabDefault = CREATOR_PANE_DEFAULTS[tabGroup] || defaultPane;
      const isDefault = paneId === tabDefault;
      const shouldHide = !creatorModeEnabled && !isDefault;
      tab.hidden = !!shouldHide;
      const isActive = creatorModeEnabled ? paneId === activePane : isDefault;
      tab.classList.toggle('active', !shouldHide && isActive);
      tab.setAttribute('aria-selected', !shouldHide && isActive ? 'true' : 'false');
      tab.tabIndex = shouldHide ? -1 : 0;
    });
  });

  const panes = document.querySelectorAll('[data-pane-target]');
  panes.forEach((section) => {
    const paneId = section.dataset.paneTarget;
    if (!paneId) return;
    const group = section.dataset.paneGroup || 'vocab';
    const defaultPane = CREATOR_PANE_DEFAULTS[group] || null;
    const activePane = getActivePaneForGroup(group);

    let shouldShow;
    if (!creatorModeEnabled) {
      if (section.classList.contains('creator-only')) {
        shouldShow = false;
      } else if (defaultPane) {
        shouldShow = paneId === defaultPane;
      } else {
        shouldShow = true;
      }
    } else {
      shouldShow = paneId === activePane;
    }

    if (shouldShow) {
      section.removeAttribute('hidden');
    } else {
      section.setAttribute('hidden', '');
    }
  });
}

function setActiveCreatorPane(paneId, group) {
  if (!paneId) return;
  const grp = group || 'vocab';
  if (!creatorModeEnabled && paneId !== 'whitaker-pane') return;
  if (!activeCreatorPanes) activeCreatorPanes = { ...CREATOR_PANE_DEFAULTS };
  activeCreatorPanes[grp] = paneId;
  updateCreatorPaneVisibility();
}

function initializeCreatorPaneToggle() {
  const navs = document.querySelectorAll('.pane-toggle');
  navs.forEach((nav) => {
    if (nav.dataset.bound === 'true') return;
    nav.dataset.bound = 'true';
    nav.addEventListener('click', (event) => {
      const button = event.target.closest('[data-pane]');
      if (!button) return;
      const paneId = button.dataset.pane;
      if (!paneId) return;
      const group = button.dataset.paneGroup || nav.dataset.paneGroup;
      event.preventDefault();
      setActiveCreatorPane(paneId, group);
    });
  });
}

function rerenderLatinTextPreservingScroll() {
  const latin = document.getElementById('latin-text');
  if (!latin || !currentLatinText) return;
  const scroll = latin.scrollTop;
  renderLatinText(currentLatinText);
  latin.scrollTop = scroll;
}

function renderYourVocabList() {
  const container = document.getElementById('your-vocab-list');
  if (!container) return;
  container.innerHTML = '';
  const entriesForChapter = userVocabEntries.filter((entry) => Number(entry && entry.chapter) === currentChapter);
  if (!entriesForChapter.length) {
    const empty = document.createElement('p');
    empty.className = 'creator-empty';
    empty.textContent = 'No saved words yet for this chapter. Use the + button after a lookup to add one.';
    container.appendChild(empty);
    return;
  }

  const entries = [...entriesForChapter].sort((a, b) => a.word.localeCompare(b.word, undefined, { sensitivity: 'base' }));
  for (const entry of entries) {
    const card = document.createElement('div');
    card.className = 'creator-entry';
    card.dataset.vocabId = entry.id;

    const heading = document.createElement('h3');
    heading.textContent = entry.word;
    card.appendChild(heading);

    const body = document.createElement('p');
    body.textContent = entry.definition;
    card.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'creator-entry-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = 'Edit definition';
    editBtn.addEventListener('click', () => promptEditUserVocabEntry(entry.id));
    actions.appendChild(editBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => deleteUserVocabEntry(entry.id));
    actions.appendChild(deleteBtn);

    card.appendChild(actions);
    container.appendChild(card);
  }
}

function renderYourNotesList() {
  const container = document.getElementById('your-notes-list');
  if (!container) return;
  container.innerHTML = '';
  const entriesForChapter = userNotesEntries.filter((entry) => Number(entry && entry.chapter) === currentChapter);
  if (!entriesForChapter.length) {
    const empty = document.createElement('p');
    empty.className = 'creator-empty';
    empty.textContent = 'No custom notes yet for this chapter.';
    container.appendChild(empty);
    return;
  }

  const entries = [...entriesForChapter].sort((a, b) => a.phrase.localeCompare(b.phrase, undefined, { sensitivity: 'base' }));
  for (const entry of entries) {
    const card = document.createElement('div');
    card.className = 'note-entry creator-note-entry';
    card.dataset.noteId = entry.id;

    const view = document.createElement('div');
    view.className = 'creator-note-view';
    view.innerHTML = `<b>${escapeHtml(entry.phrase)}</b><div class="note-text">${renderRichText(entry.note)}</div>`;
    card.appendChild(view);

    const actions = document.createElement('div');
    actions.className = 'creator-entry-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = 'Edit note';
    actions.appendChild(editBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Delete';
    actions.appendChild(deleteBtn);

    card.appendChild(actions);

    const form = document.createElement('form');
    form.className = 'creator-note-editor creator-inline-form';
    form.hidden = true;

    const phraseField = document.createElement('label');
    phraseField.className = 'creator-field';
    phraseField.innerHTML = '<span>Word or phrase</span>';
    const phraseInput = document.createElement('input');
    phraseInput.type = 'text';
    phraseInput.required = true;
    phraseInput.value = entry.phrase;
    phraseField.appendChild(phraseInput);

    const noteField = document.createElement('label');
    noteField.className = 'creator-field';
    noteField.innerHTML = '<span>Your note</span>';
    const noteInput = document.createElement('textarea');
    noteInput.rows = 4;
    noteInput.required = true;
    noteInput.value = entry.note;
    noteField.appendChild(noteInput);

    const editorActions = document.createElement('div');
    editorActions.className = 'creator-form-actions';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'submit';
    saveBtn.className = 'creator-primary';
    saveBtn.textContent = 'Save changes';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'creator-secondary';
    cancelBtn.textContent = 'Cancel';
    editorActions.appendChild(cancelBtn);
    editorActions.appendChild(saveBtn);

    form.appendChild(phraseField);
    form.appendChild(noteField);
    form.appendChild(editorActions);

    card.appendChild(form);
    container.appendChild(card);

    const enterEditMode = () => {
      if (!creatorModeEnabled) return;
      card.classList.add('editing');
      view.hidden = true;
      actions.hidden = true;
      form.hidden = false;
      phraseInput.focus();
    };

    const exitEditMode = (reset = false) => {
      card.classList.remove('editing');
      if (reset) {
        phraseInput.value = entry.phrase;
        noteInput.value = entry.note;
      }
      form.hidden = true;
      view.hidden = false;
      actions.hidden = false;
    };

    card.addEventListener('click', (event) => {
      if (card.classList.contains('editing')) return;
      if (event.target.closest('button, input, textarea, form, label')) return;
      card.classList.add('highlight');
      setTimeout(() => card.classList.remove('highlight'), 1200);
    });

    editBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      enterEditMode();
    });

    cancelBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      exitEditMode(true);
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const result = updateUserNoteEntry(entry.id, phraseInput.value, noteInput.value);
      if (!result.success) {
        if (result.message) alert(result.message);
        return;
      }
    });

    deleteBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      deleteUserNoteEntry(entry.id);
    });
  }
}

function addOrUpdateUserVocab(word, definition) {
  if (!creatorModeEnabled) {
    return { success: false, message: 'Creator Mode is disabled.' };
  }
  const trimmedWord = (word || '').trim();
  const trimmedDefinition = (definition || '').trim();
  const normalized = normalize(trimmedWord);
  if (!trimmedWord || !normalized) {
    return { success: false, message: 'Please provide a word to save.' };
  }
  if (!trimmedDefinition) {
    return { success: false, message: 'Please enter a definition.' };
  }

  const existing = userVocabEntries.find((entry) => entry.normalized === normalized && entry.word.toLowerCase() === trimmedWord.toLowerCase() && Number(entry.chapter) === currentChapter);
  if (existing) {
    existing.word = trimmedWord;
    existing.definition = trimmedDefinition;
    existing.chapter = currentChapter;
  } else {
    userVocabEntries.push({
      id: `v-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      word: trimmedWord,
      definition: trimmedDefinition,
      normalized,
      chapter: currentChapter,
    });
  }

  persistUserVocab();
  rebuildCreatorCaches();
  renderYourVocabList();
  rerenderLatinTextPreservingScroll();
  return { success: true, message: existing ? 'Definition updated.' : 'Added to your vocab list.' };
}

function deleteUserVocabEntry(id) {
  const idx = userVocabEntries.findIndex((entry) => entry.id === id);
  if (idx === -1) return;
  const entry = userVocabEntries[idx];
  if (Number(entry.chapter) !== currentChapter) {
    alert("Switch to the word's chapter before deleting it.");
    return;
  }
  if (!confirm(`Remove “${entry.word}” from your vocab list?`)) return;
  userVocabEntries.splice(idx, 1);
  persistUserVocab();
  rebuildCreatorCaches();
  renderYourVocabList();
  rerenderLatinTextPreservingScroll();
}

function promptEditUserVocabEntry(id) {
  const entry = userVocabEntries.find((item) => item.id === id);
  if (!entry) return;
  if (Number(entry.chapter) !== currentChapter) {
    alert("Switch to the word's chapter to edit it.");
    return;
  }
  const nextDefinition = prompt(`Edit definition for “${entry.word}”`, entry.definition);
  if (nextDefinition === null) return;
  const trimmed = nextDefinition.trim();
  if (!trimmed) {
    alert('Definition cannot be empty.');
    return;
  }
  entry.definition = trimmed;
  persistUserVocab();
  rebuildCreatorCaches();
  renderYourVocabList();
  rerenderLatinTextPreservingScroll();
}

function addUserNoteEntry(phrase, note) {
  if (!creatorModeEnabled) {
    return { success: false, message: 'Creator Mode is disabled.' };
  }
  const trimmedPhrase = (phrase || '').trim();
  const trimmedNote = (note || '').trim();
  if (!trimmedPhrase) {
    return { success: false, message: 'Please enter a word or phrase.' };
  }
  if (!trimmedNote) {
    return { success: false, message: 'Please enter a note.' };
  }
  const tokens = trimmedPhrase.split(/\s+/).map(normalize).filter(Boolean);
  if (!tokens.length) {
    return { success: false, message: 'Unable to recognize words in that phrase.' };
  }

  const existing = userNotesEntries.find((entry) => {
    if (!entry || !entry.tokens) return false;
    if (Number(entry.chapter) !== currentChapter) return false;
    return entry.tokens.length === tokens.length && entry.tokens.every((t, idx) => t === tokens[idx]);
  });
  if (existing) {
    existing.phrase = trimmedPhrase;
    existing.note = trimmedNote;
    existing.tokens = tokens;
  } else {
    userNotesEntries.push({
      id: `n-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      phrase: trimmedPhrase,
      note: trimmedNote,
      tokens,
      chapter: currentChapter,
    });
  }

  persistUserNotes();
  rebuildCreatorCaches();
  renderYourNotesList();
  rerenderLatinTextPreservingScroll();
  return { success: true, message: existing ? 'Note updated.' : 'Note added.' };
}

function updateUserNoteEntry(id, phrase, note) {
  if (!creatorModeEnabled) {
    return { success: false, message: 'Creator Mode is disabled.' };
  }
  const entry = userNotesEntries.find((item) => item.id === id);
  if (!entry) {
    return { success: false, message: 'Note not found.' };
  }
  if (Number(entry.chapter) !== currentChapter) {
    return { success: false, message: "Switch to the note's chapter to edit it." };
  }
  const trimmedPhrase = (phrase || '').trim();
  if (!trimmedPhrase) {
    return { success: false, message: 'Please enter a word or phrase.' };
  }
  const tokens = trimmedPhrase.split(/\s+/).map(normalize).filter(Boolean);
  if (!tokens.length) {
    return { success: false, message: 'Unable to recognize words in that phrase.' };
  }
  const trimmedNote = (note || '').trim();
  if (!trimmedNote) {
    return { success: false, message: 'Note cannot be empty.' };
  }
  entry.phrase = trimmedPhrase;
  entry.note = trimmedNote;
  entry.tokens = tokens;
  persistUserNotes();
  rebuildCreatorCaches();
  renderYourNotesList();
  rerenderLatinTextPreservingScroll();
  return { success: true, message: 'Note updated.' };
}

function deleteUserNoteEntry(id) {
  const idx = userNotesEntries.findIndex((entry) => entry.id === id);
  if (idx === -1) return;
  const entry = userNotesEntries[idx];
  if (Number(entry.chapter) !== currentChapter) {
    alert("Switch to the note's chapter before deleting it.");
    return;
  }
  if (!confirm(`Delete your note for “${entry.phrase}”?`)) return;
  userNotesEntries.splice(idx, 1);
  persistUserNotes();
  rebuildCreatorCaches();
  renderYourNotesList();
  rerenderLatinTextPreservingScroll();
}

function focusCustomNoteInPanel(noteId) {
  if (!noteId) return;
  const container = document.getElementById('your-notes-list');
  if (!container) return;
  const target = container.querySelector(`.note-entry[data-note-id="${noteId}"]`);
  if (!target) return;
  if (creatorModeEnabled) {
    setActiveCreatorPane('your-notes-pane', 'notes');
  }
  target.classList.add('highlight');
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => target.classList.remove('highlight'), 1200);
}

function initializeCreatorNotesForm() {
  const addBtn = document.getElementById('your-notes-add');
  const form = document.getElementById('your-notes-form');
  const cancelBtn = document.getElementById('your-notes-cancel');
  const phraseInput = document.getElementById('your-notes-word');
  const noteInput = document.getElementById('your-notes-text');
  if (!addBtn || !form || !phraseInput || !noteInput) return;
  addBtn.setAttribute('aria-expanded', 'false');

  addBtn.addEventListener('click', () => {
    if (!creatorModeEnabled) return;
    form.removeAttribute('hidden');
    addBtn.setAttribute('aria-expanded', 'true');
    phraseInput.value = '';
    noteInput.value = '';
    phraseInput.focus();
  });

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      form.setAttribute('hidden', '');
      addBtn.setAttribute('aria-expanded', 'false');
      form.reset();
    });
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!creatorModeEnabled) return;
    const result = addUserNoteEntry(phraseInput.value, noteInput.value);
    if (!result.success) {
      if (result.message) alert(result.message);
      return;
    }
    form.reset();
    form.setAttribute('hidden', '');
    addBtn.setAttribute('aria-expanded', 'false');
    setActiveCreatorPane('your-notes-pane', 'notes');
  });
}

function exportCreatorData() {
  if (!creatorModeEnabled) {
    alert('Enable Creator Mode to export your custom notes and vocab.');
    return;
  }
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    vocab: userVocabEntries,
    notes: userNotesEntries,
  };
  try {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `latin-reader-export-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch (err) {
    console.warn('Failed to export data', err);
    alert('Sorry, exporting your data failed.');
  }
}

function importCreatorDataFromText(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    alert('Import failed: file is not valid JSON.');
    return;
  }

  const vocabRaw = Array.isArray(parsed?.vocab) ? parsed.vocab : Array.isArray(parsed?.userVocab) ? parsed.userVocab : [];
  const notesRaw = Array.isArray(parsed?.notes) ? parsed.notes : Array.isArray(parsed?.userNotes) ? parsed.userNotes : [];
  const nextVocab = normalizeCreatorVocabEntries(vocabRaw);
  const nextNotes = normalizeCreatorNotesEntries(notesRaw);

  if (!nextVocab.length && !nextNotes.length) {
    alert('Import file did not contain any vocab or notes.');
    return;
  }

  if ((userVocabEntries.length || userNotesEntries.length) && !confirm('Importing will replace your existing saved vocab and notes. Continue?')) {
    return;
  }

  userVocabEntries = nextVocab;
  userNotesEntries = nextNotes;
  persistUserVocab();
  persistUserNotes();
  rebuildCreatorCaches();
  renderYourVocabList();
  renderYourNotesList();
  rerenderLatinTextPreservingScroll();
  setActiveCreatorPane('your-notes-pane', 'notes');
  setActiveCreatorPane('your-vocab-pane', 'vocab');
  updateCreatorPaneVisibility();
  alert('Import complete.');
}

function initializeImportExportControls() {
  const importBtn = document.getElementById('import-data-btn');
  const exportBtn = document.getElementById('export-data-btn');
  const fileInput = document.getElementById('import-file-input');

  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      exportCreatorData();
    });
  }

  if (importBtn && fileInput) {
    importBtn.addEventListener('click', () => {
      if (!creatorModeEnabled) {
        alert('Enable Creator Mode to import your custom notes and vocab.');
        return;
      }
      fileInput.value = '';
      fileInput.click();
    });
    fileInput.addEventListener('change', (event) => {
      const [file] = event.target.files || [];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        importCreatorDataFromText(reader.result);
      };
      reader.onerror = () => {
        alert('Unable to read that file.');
      };
      reader.readAsText(file);
    });
  }
}

function applyTheme(theme, options = {}) {
  const body = document.body;
  if (!body) return THEME_DEFAULT;
  const normalized = theme === THEME_HIGH ? THEME_HIGH : THEME_DEFAULT;
  if (normalized === THEME_HIGH) {
    body.classList.add('high-contrast');
  } else {
    body.classList.remove('high-contrast');
  }

  document.querySelectorAll('.contrast-btn').forEach(btn => {
    const isActive = btn.dataset.theme === normalized;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });

  if (options.persist !== false) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, normalized);
    } catch (err) {
      if (!themeStorageWriteWarningShown) {
        console.warn('Unable to persist theme preference', err);
        themeStorageWriteWarningShown = true;
      }
    }
  }

  return normalized;
}

function resolvePreferredTheme() {
  let stored = null;
  try {
    stored = localStorage.getItem(THEME_STORAGE_KEY);
  } catch (err) {
    if (!themeStorageReadWarningShown) {
      console.warn('Unable to read stored theme preference', err);
      themeStorageReadWarningShown = true;
    }
  }

  if (stored === THEME_HIGH || stored === THEME_DEFAULT) {
    return { theme: stored, fromStorage: true };
  }

  const prefersHigh = window.matchMedia && window.matchMedia('(prefers-contrast: more)').matches;
  return { theme: prefersHigh ? THEME_HIGH : THEME_DEFAULT, fromStorage: false };
}

function initializeThemeControls() {
  const buttons = document.querySelectorAll('.contrast-btn');
  const { theme: preferredTheme, fromStorage } = resolvePreferredTheme();
  const initialTheme = applyTheme(preferredTheme, { persist: false });

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      applyTheme(btn.dataset.theme || THEME_DEFAULT);
    });
  });

  if (!fromStorage && window.matchMedia) {
    const media = window.matchMedia('(prefers-contrast: more)');
    const handleChange = (event) => {
      const stored = (() => {
        try {
          return localStorage.getItem(THEME_STORAGE_KEY);
        } catch (err) {
          if (!themeStorageReadWarningShown) {
            console.warn('Unable to read stored theme preference', err);
            themeStorageReadWarningShown = true;
          }
          return null;
        }
      })();
      if (stored === THEME_HIGH || stored === THEME_DEFAULT) {
        return;
      }
      applyTheme(event.matches ? THEME_HIGH : THEME_DEFAULT, { persist: false });
    };
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', handleChange);
    } else if (typeof media.addListener === 'function') {
      media.addListener(handleChange);
    }
  }

  return initialTheme;
}

function enableCreatorMode(enable) {
  creatorModeEnabled = !!enable;
  persistCreatorModeFlag(creatorModeEnabled);
  applyCreatorModeClass();
  // ensure default active panes set when enabling/disabling
  if (!creatorModeEnabled) {
    activeCreatorPanes = { ...CREATOR_PANE_DEFAULTS };
    document.querySelectorAll('.lookup-add-form').forEach((form) => {
      form.hidden = true;
      const header = form.previousElementSibling;
      if (header) {
        const btn = header.querySelector('.lookup-add-btn');
        if (btn) btn.setAttribute('aria-expanded', 'false');
      }
    });
  }
  updateCreatorPaneVisibility();
  // re-render lists so the creator panes are populated
  renderYourVocabList();
  renderYourNotesList();
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
  const idx = Math.max(0, Math.min(endpointIndex, WHITAKER_ENDPOINTS_COUNT - 1));
  try {
    return `${WHITAKER_PROXY_URL}?word=${encodeURIComponent(String(word || ''))}&endpoint=${idx}`;
  } catch (err) {
    console.warn('Failed to build Whitaker URL', err);
    return `${WHITAKER_PROXY_URL}?word=${encodeURIComponent(String(word || ''))}&endpoint=0`;
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
  const sameWord = (originalWord || '') === (lookedUpWord || '');
  const displayWord = originalWord || lookedUpWord || '';
  const title = document.createElement('div');
  title.className = 'lookup-title';
  const titleStrong = document.createElement('strong');
  titleStrong.textContent = 'Whitaker’s Words';
  const subtitle = document.createElement('span');
  subtitle.className = 'lookup-subtitle';
  subtitle.textContent = displayWord ? `for “${displayWord}”` : 'Whitaker’s Words result';
  if (!sameWord) {
    const note = document.createElement('span');
    note.className = 'lookup-note';
    const noteWord = lookedUpWord || displayWord;
    note.textContent = noteWord ? `(searched as “${noteWord}”)` : '(search adjusted)';
    subtitle.appendChild(document.createTextNode(' '));
    subtitle.appendChild(note);
  }
  title.appendChild(titleStrong);
  title.appendChild(subtitle);
  header.appendChild(title);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'creator-plus-btn lookup-add-btn creator-only';
  addBtn.setAttribute('aria-label', 'Add to your vocab list');
  addBtn.setAttribute('aria-expanded', 'false');
  addBtn.textContent = '＋';
  header.appendChild(addBtn);

  const pre = document.createElement('pre');
  pre.className = 'whitaker-output';
  pre.textContent = text;

  const footer = document.createElement('div');
  footer.className = 'lookup-actions';
  const link = document.createElement('a');
  const lookupTarget = lookedUpWord || displayWord;
  link.href = sourceUrl || buildWhitakerUrl(lookupTarget, 0);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'Open in new tab';
  footer.appendChild(link);

  vocabList.appendChild(header);
  const form = document.createElement('form');
  form.className = 'creator-inline-form lookup-add-form creator-only';
  form.hidden = true;
  form.setAttribute('aria-label', 'Add a custom vocab entry');

  const wordField = document.createElement('label');
  wordField.className = 'creator-field';
  wordField.innerHTML = '<span>Word</span>';
  const wordInput = document.createElement('input');
  wordInput.type = 'text';
  wordInput.required = true;
  wordInput.value = displayWord;
  wordField.appendChild(wordInput);

  const defField = document.createElement('label');
  defField.className = 'creator-field';
  defField.innerHTML = '<span>Your definition</span>';
  const defInput = document.createElement('textarea');
  defInput.rows = 3;
  defInput.required = true;
  defField.appendChild(defInput);

  const actions = document.createElement('div');
  actions.className = 'creator-form-actions';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'creator-primary';
  saveBtn.textContent = 'Save word';
  actions.appendChild(saveBtn);

  const status = document.createElement('p');
  status.className = 'creator-status';
  status.textContent = '';

  form.appendChild(wordField);
  form.appendChild(defField);
  form.appendChild(actions);
  form.appendChild(status);

  const toggleForm = (show) => {
    if (!creatorModeEnabled) return;
    form.hidden = !show;
    addBtn.setAttribute('aria-expanded', show ? 'true' : 'false');
    if (show) {
      status.textContent = '';
      if (!wordInput.value) {
        wordInput.value = displayWord;
      }
      wordInput.focus();
      wordInput.select();
    }
  };

  addBtn.addEventListener('click', () => {
    if (!creatorModeEnabled) return;
    toggleForm(form.hidden);
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!creatorModeEnabled) {
      alert('Enable Creator Mode to save vocab.');
      return;
    }
    const result = addOrUpdateUserVocab(wordInput.value, defInput.value);
    if (!result.success) {
      if (result.message) alert(result.message);
      return;
    }
    status.textContent = result.message;
    defInput.value = '';
    defInput.focus();
    setActiveCreatorPane('your-vocab-pane', 'vocab');
    setTimeout(() => {
      if (status.textContent === result.message) {
        status.textContent = '';
      }
    }, 3000);
  });

  vocabList.appendChild(form);
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
    for (let endpointIndex = 0; endpointIndex < WHITAKER_ENDPOINTS_COUNT; endpointIndex++) {
      const url = buildWhitakerUrl(candidate, endpointIndex);
      try {
        lastTried = candidate;
        lastEndpointIndex = endpointIndex;
        const resp = await fetch(url);
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
        // nothing available — show a friendly message. If the page
        // was opened via file://, the fetch() will fail due to browser
        // blocking; show a helpful hint.
        const latinContainer = document.getElementById("latin-text");
        if (latinContainer) {
          const isFile = window.location.protocol === 'file:';
          if (isFile) {
            latinContainer.innerHTML = `<p><em>Resources failed to load when opening the page directly. Try running a local server, e.g.</em> <code>python3 -m http.server 8000</code>.</p>`;
          } else {
            latinContainer.innerHTML = `<p><em>Sorry — text for chapter ${currentChapter} is not available.</em></p>`;
          }
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
  renderYourVocabList();
  renderYourNotesList();
  rerenderLatinTextPreservingScroll();
  // reload notes and text for the chapter, and reset the vocab pane
  (async () => {
    initializeVocabPane();
    await loadNotes();
    await loadChapter();
  })();
}

function renderLatinText(text) {
  currentLatinText = text;
  const latinContainer = document.getElementById("latin-text");
  latinContainer.innerHTML = "";

  const { tokens, wordEntries } = tokenizeText(text);
  const noteMatches = findNoteMatches(wordEntries);
  const userNoteMatches = creatorModeEnabled ? findUserNoteMatches(wordEntries) : new Map();

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

    const customMatch = creatorModeEnabled ? userNoteMatches.get(wordIndex) : null;
    if (customMatch) {
      const groupId = `creator-note-${customMatch.note.id}-${tokenIndex}`;
      let wordsCovered = 0;
      let j = tokenIndex;
      while (j < tokens.length && wordsCovered < customMatch.length) {
        const innerToken = tokens[j];
        if (innerToken.type === 'word') {
          const wordSpan = document.createElement('span');
          wordSpan.classList.add('word', 'creator-note');
          wordSpan.dataset.noteGroup = groupId;
          wordSpan.dataset.customNoteId = customMatch.note.id;
          wordSpan.dataset.raw = innerToken.raw;
          wordSpan.textContent = innerToken.raw;
          const tooltip = customMatch.note.note || resolveVocabTooltip(innerToken.clean);
          if (tooltip) wordSpan.title = customMatch.note.note || tooltip;
          wordSpan.addEventListener('click', (e) => {
            if (e.shiftKey) {
              e.preventDefault();
              e.stopPropagation();
              focusCustomNoteInPanel(customMatch.note.id);
            }
          });
          fragment.appendChild(wordSpan);
          wordsCovered++;
        } else {
          fragment.appendChild(document.createTextNode(innerToken.raw));
        }
        j++;
      }
      tokenIndex = j;
      wordIndex += customMatch.length;
      continue;
    }

    const span = document.createElement("span");
    span.className = "word";
    span.dataset.raw = token.raw;
    span.textContent = token.raw;

    const normalized = token.clean;
    if (creatorModeEnabled && normalized) {
      const vocabEntries = getCurrentChapterVocabEntries(normalized);
      if (vocabEntries.length) {
        span.classList.add('creator-vocab');
        const tooltips = vocabEntries.map(e => e.definition ? `${e.word} — ${e.definition}` : e.word);
        span.title = tooltips.join('\n');
      } else {
        const tooltip = resolveVocabTooltip(normalized);
        if (tooltip) span.title = tooltip;
      }
    } else {
      const tooltip = resolveVocabTooltip(normalized);
      if (tooltip) span.title = tooltip;
    }

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

function findUserNoteMatches(wordEntries) {
  if (!creatorModeEnabled || !userNotesEntries.length) {
    return new Map();
  }

  const matches = [];
  for (const entry of userNotesEntries) {
    if (!entry || !entry.tokens || !entry.tokens.length) continue;
    const entryChapter = Number(entry.chapter);
    if (entryChapter !== currentChapter) continue;
    for (let i = 0; i <= wordEntries.length - entry.tokens.length; i++) {
      let ok = true;
      for (let j = 0; j < entry.tokens.length; j++) {
        if (wordEntries[i + j].clean !== entry.tokens[j]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        matches.push({ start: i, length: entry.tokens.length, note: entry });
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
  applyCreatorModeClass();
  initializeCreatorPaneToggle();
  initializeCreatorNotesForm();
  initializeImportExportControls();
  renderYourVocabList();
  renderYourNotesList();
  if (!creatorModeEnabled) {
    activeCreatorPanes = { ...CREATOR_PANE_DEFAULTS };
  }
  updateCreatorPaneVisibility();

  // attach chapter button handlers
  document.querySelectorAll('.chapter-btn').forEach(b => {
    b.addEventListener('click', () => setChapter(+b.dataset.ch));
  });

  // theme toggles
  initializeThemeControls();
  // Creator mode is toggled via Ctrl+Alt+Shift+L shortcut (no button)

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
