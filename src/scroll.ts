// The page scrolls inside .scroll (not the window), so the position is kept here.
const el = () => document.querySelector('.scroll');
let saved = 0;
export const scrollToTop = () => { el()?.scrollTo(0, 0); };
// Remember where the list was before a card opens, and put it back when you come back.
export const rememberScroll = () => { saved = el()?.scrollTop ?? 0; };
export const restoreScroll = () => { const y = saved; requestAnimationFrame(() => requestAnimationFrame(() => el()?.scrollTo(0, y))); };
