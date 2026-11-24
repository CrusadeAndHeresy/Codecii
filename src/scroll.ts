// The page scrolls inside .scroll (the tab bar stays put), not the window.
export const scrollToTop = () => { document.querySelector('.scroll')?.scrollTo(0, 0); };
