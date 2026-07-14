// Headless asset-import stub (registerHooks, in-process). Stubs Vite asset extensions so a
// harness importing the demo game runs under tsx (no GL/DOM). Presentation-only assets never
// enter the sim, so the stubbed value is irrelevant to any determinism/marshal check.
import { registerHooks } from "node:module";
registerHooks({
  load(url, context, nextLoad) {
    if (/\.(mp3|ogg|wav|flac|m4a|aac|png|jpe?g|gif|svg|webp|avif)(\?.*)?$/i.test(url)) {
      return { format: "module", source: 'export default "";', shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
