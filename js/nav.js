// Tiny bridge so views can ask the router to re-render without circular imports.
let renderer = () => {};
export const setRenderer = (fn) => { renderer = fn; };
export const rerender = () => renderer();
export const go = (hash) => {
  if (location.hash === hash) renderer();
  else location.hash = hash;
};
