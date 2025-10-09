document.querySelectorAll('.word').forEach(word => {
  word.addEventListener('mouseenter', () => {
    const id = word.dataset.id;
    document.querySelectorAll('.vocab-entry').forEach(v => v.classList.remove('highlight'));
    const entry = document.querySelector(`#vocab-${id}`);
    if (entry) entry.classList.add('highlight');
  });

  word.addEventListener('dblclick', () => {
    const id = word.dataset.id;
    const entry = document.querySelector(`#vocab-${id}`);
    if (entry) {
      entry.scrollIntoView({ behavior: 'smooth', block: 'center' });
      entry.classList.add('highlight');
      setTimeout(() => entry.classList.remove('highlight'), 2000);
    }
  });
});
