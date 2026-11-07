const STAND_INS = { herdr: "./herdr.js", "gpui-kit": "./gpui.js", "gpui-base": "./gpui.js" };

export async function resolve(specifier, context, next) {
  if (STAND_INS[specifier]) return { url: new URL(STAND_INS[specifier], import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
