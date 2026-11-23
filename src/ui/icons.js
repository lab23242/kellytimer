// Small line icons, drawn on a 20x20 grid with a slightly uneven brush-like stroke.
const wrap = (body) =>
  `<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const icons = {
  play: wrap('<path d="M7 4.8 15 10 7 15.2Z" fill="currentColor" stroke-width="1"/>'),
  pause: wrap('<path d="M7.5 5v10M12.5 5v10" stroke-width="1.8"/>'),
  skip: wrap('<path d="M5.5 5 12 10 5.5 15Z" fill="currentColor" stroke-width="1"/><path d="M14.5 5v10" stroke-width="1.6"/>'),
  reset: wrap('<path d="M5.2 8.2A5.2 5.2 0 1 1 5 11.6"/><path d="M4.6 4.6v3.8h3.8"/>'),
  settings: wrap(
    '<circle cx="10" cy="10" r="2.3"/><path d="M10 3.2v2M10 14.8v2M3.2 10h2M14.8 10h2M5.2 5.2l1.4 1.4M13.4 13.4l1.4 1.4M5.2 14.8l1.4-1.4M13.4 6.6l1.4-1.4"/>',
  ),
  hide: wrap('<path d="M5 13.5h10"/>'),
  close: wrap('<path d="M6 6l8 8M14 6l-8 8"/>'),
};
