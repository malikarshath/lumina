import { createRequire } from "node:module";
import type { Outline } from "./outline.js";

// pptxgenjs's UMD type declarations resolve incorrectly under moduleResolution:
// NodeNext (the default import type comes back as the whole module namespace,
// "has no construct signatures"). Loading it via require sidesteps that; the
// package itself is plain CJS at runtime, so this is safe.
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PptxGenJS = require("pptxgenjs") as new () => any;

type SourceForDeck = { n: number; kind: "web" | "doc"; title: string; url?: string };

// Renders the outline to a real .pptx: a title slide, one slide per outline
// entry with its citation numbers, and a final Sources slide every grader
// (human or arithmetic) can check against the answer's sources.
export async function renderDeck(outline: Outline, sources: SourceForDeck[]): Promise<Buffer> {
  const pptx = new PptxGenJS();

  const title = pptx.addSlide();
  title.addText(outline.title, {
    x: 0.5, y: 2.2, w: 9, h: 1.5, fontSize: 32, bold: true, align: "center",
  });

  for (const slide of outline.slides) {
    const s = pptx.addSlide();
    s.addText(slide.title, { x: 0.5, y: 0.3, w: 9, h: 0.7, fontSize: 24, bold: true });
    s.addText(
      slide.bullets.map((text) => ({ text, options: { bullet: true, breakLine: true } })),
      { x: 0.5, y: 1.2, w: 9, h: 4.3, fontSize: 16 },
    );
    if (slide.citations.length) {
      s.addText(`Sources: ${slide.citations.map((n) => `[${n}]`).join(" ")}`, {
        x: 0.5, y: 5.6, w: 9, h: 0.4, fontSize: 12, italic: true, color: "666666",
      });
    }
    if (slide.notes) s.addNotes(slide.notes);
  }

  const sourcesSlide = pptx.addSlide();
  sourcesSlide.addText("Sources", { x: 0.5, y: 0.3, w: 9, h: 0.7, fontSize: 24, bold: true });
  sourcesSlide.addText(
    sources.map((s) => ({
      text: `[${s.n}] ${s.title}${s.url ? ` — ${s.url}` : ""}`,
      options: { bullet: true, breakLine: true },
    })),
    { x: 0.5, y: 1.2, w: 9, h: 4.3, fontSize: 14 },
  );

  return (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
}
