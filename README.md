# Latin Reader

A lightweight reader for Cornelius Nepos' *Atticus* with inline notes and an on-demand vocabulary lookup powered by Whitaker's Words.

## Running locally

1. Start a static file server from the project root, for example:
   ```bash
   python3 -m http.server 8000
   ```
2. Open [http://localhost:8000/](http://localhost:8000/) in your browser.
3. Click the chapter buttons at the top-left to switch between the bundled texts.

## Vocabulary lookups

- Left-click any word in the Latin text to fetch its Whitaker's Words entry. The result is rendered in the vocabulary pane on the right.
- Shift-click is still reserved for showing notes.
- The app attempts several public Whitaker's Words endpoints. If they are unavailable or blocked by CORS, you can point the reader at your own proxy or local installation by defining `window.WHITAKERS_WORDS_ENDPOINTS` before `script.js` loads:
  ```html
  <script>
    window.WHITAKERS_WORDS_ENDPOINTS = [
      {
        label: 'local words',
        url: 'http://localhost:8080/words?word={word}'
      }
    ];
  </script>
  <script src="script.js" defer></script>
  ```
  Each entry can be a string template (with `{word}` placeholder), an object with `url`/`label`, or a function that receives the normalized word and returns the request URL.

When the lookup fails the pane shows a diagnostic summary of the attempted endpoints so it is easier to debug connectivity issues.

## Notes

Notes are preloaded for each chapter (when available) and can be viewed by hovering over highlighted text or shift-clicking a note phrase.
