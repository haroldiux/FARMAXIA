export const THEME_STORAGE_KEY = "farmaxia-theme";

/**
 * Script que corre antes de pintar la página (va en el <head> del layout): aplica el
 * tema guardado o, si no hay, el del sistema operativo. Así no hay parpadeo al cargar.
 */
export const themeBootScript = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="light"}})();`;
