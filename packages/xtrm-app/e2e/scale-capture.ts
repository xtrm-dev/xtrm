import { readFileSync, statSync } from "node:fs";
import { expect, type Page } from "@playwright/test";

/**
 * XTRM-907: a screenshot is evidence only if it is a real image. Size alone was too weak a gate —
 * the blank that reached the review of #454 was 1797 bytes, just over the old 1 kB line. So the
 * pixels are sampled too: real chrome has many colours, and no single colour covers almost the
 * whole image.
 */

/** A flat 264x900 PNG compresses to a few hundred bytes; a populated sidebar to tens of kB. */
export const BLANK_BYTES = 4096;
/** A capture with fewer colours than this has no text, no borders and no glyphs in it. */
export const MIN_COLOURS = 16;
/** Above this share one colour is the whole picture; chrome keeps a large background, not 98%. */
export const MAX_DOMINANT = 0.98;

export type Profile = { colours: number; dominant: number; width: number; height: number };

/** Decodes the PNG in the browser (the test runner has no image decoder) and counts its colours. */
export const profile = async (page: Page, dataUrl: string): Promise<Profile> =>
  page.evaluate(async (url) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const counts = new Map<number, number>();
    for (let i = 0; i < data.length; i += 4) {
      const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return {
      colours: counts.size,
      dominant: Math.max(...counts.values()) / (data.length / 4),
      width: canvas.width,
      height: canvas.height,
    };
  }, dataUrl);

export const profileOfFile = async (page: Page, path: string): Promise<Profile> =>
  profile(page, `data:image/png;base64,${readFileSync(path).toString("base64")}`);

/** Asserts that a written capture carries an image; throws (never returns a verdict) otherwise. */
export const capture = async (page: Page, path: string): Promise<void> => {
  expect(statSync(path).size, `${path} is a blank`).toBeGreaterThan(BLANK_BYTES);
  const { colours, dominant } = await profileOfFile(page, path);
  expect(colours, `${path} has too few colours`).toBeGreaterThan(MIN_COLOURS);
  expect(dominant, `${path} is one flat colour`).toBeLessThan(MAX_DOMINANT);
};
