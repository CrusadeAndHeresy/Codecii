// Reads an army list from a PDF, one or more screenshots, a text file or pasted text. All on this device:
// no AI, no network except loading the reader files from this app (cached after the first use, like Creatio).
import { ListReader } from './listReader';
import type { Reading } from './army';

/* eslint-disable @typescript-eslint/no-explicit-any */
const base = () => `${import.meta.env.BASE_URL}vendor/`;

const loaded = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  let p = loaded.get(src);
  if (!p) {
    p = new Promise<void>((ok, no) => {
      const s = document.createElement('script');
      s.src = src; s.onload = () => ok();
      s.onerror = () => { loaded.delete(src); no(new Error('The list reader could not be loaded. Check the connection and try again.')); };
      document.head.appendChild(s);
    });
    loaded.set(src, p);
  }
  return p;
}

const isImage = (f: File) => /^image\//.test(f.type) || /\.(png|jpe?g|heic|heif|webp|gif|bmp)$/i.test(f.name);
const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
const stripExt = (n: string) => n.replace(/\.[^.]+$/, '');

async function pdfDoc(f: File) {
  await loadScript(base() + 'pdf-3.11.174.min.js');
  const lib = (window as any).pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = base() + 'pdf-3.11.174.worker.min.js';
  return lib.getDocument({ data: await f.arrayBuffer(), isEvalSupported: false }).promise;
}

// Several screenshots of one list are joined, dropping the lines repeated where one overlaps the next.
async function ocrImages(files: File[], say: (m: string) => void): Promise<string> {
  await loadScript(base() + 'tesseract-7.0.0/tesseract.min.js');
  const T = (window as any).Tesseract;
  const root = new URL('vendor/tesseract-7.0.0/', new URL(import.meta.env.BASE_URL, location.href)).href;
  say('Preparing the image reader…');
  const w = await T.createWorker('eng', 1, { workerPath: root + 'worker.min.js', corePath: root + 'core', langPath: root + 'lang', workerBlobURL: false, gzip: true });
  const parts: string[][] = [];
  try {
    for (let i = 0; i < files.length; i++) {
      say(files.length > 1 ? `Reading screenshot ${i + 1} of ${files.length}…` : 'Reading the screenshot…');
      const { data } = await w.recognize(files[i]);
      parts.push(String(data.text).split('\n'));
    }
  } finally { await w.terminate(); }
  return joinOverlap(parts).join('\n');
}

export function joinOverlap(parts: string[][]): string[] {
  let out = parts[0] ?? [];
  for (const p of parts.slice(1)) {
    const a = out.map((x) => x.trim()).filter(Boolean), b = p.map((x) => x.trim()).filter(Boolean);
    let k = 0;
    for (let n = Math.min(a.length, b.length); n >= 2; n--) if (a.slice(-n).join('\n') === b.slice(0, n).join('\n')) { k = n; break; }
    out = [...out, ...b.slice(k)];
  }
  return out;
}

export function readArmyText(text: string, fallbackName = 'Imported list', ocr = false): Reading {
  return ListReader.readText(text, { fallbackName, ocr }) as Reading;
}

export async function readArmyFiles(files: File[], say: (m: string) => void): Promise<Reading> {
  const f = files[0];
  if (files.length > 1 || isImage(f)) {
    if (!files.every(isImage)) throw new Error('Choose either one list file or one or more screenshots.');
    return readArmyText(await ocrImages(files, say), 'Imported list', true);
  }
  if (isPdf(f)) {
    say('Reading the PDF…');
    const doc = await pdfDoc(f);
    return ListReader.read(await ListReader.pdfLines(doc), { fallbackName: stripExt(f.name) }) as Reading;
  }
  return readArmyText(await f.text(), stripExt(f.name));
}
