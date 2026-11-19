import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfDoc = PDFDocumentProxy;
/** Page size in PDF points (scale 1). */
export interface PageSize { w: number; h: number }
export interface LoadedPdf { doc: PdfDoc; sizes: PageSize[] }

/** Base display width of a page at zoom 1 (same as the prototype). */
export const PAGE_WIDTH = 816;

export async function openPdf(data: Blob | ArrayBuffer): Promise<LoadedPdf> {
  const buf = data instanceof Blob ? await data.arrayBuffer() : data;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const sizes: PageSize[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const v = p.getViewport({ scale: 1 });
    sizes.push({ w: v.width, h: v.height });
  }
  return { doc, sizes };
}

/** Release a document (worker + memory). */
export const closePdf = (doc: PdfDoc) => doc.loadingTask.destroy().catch(() => { });

/** Render one page into a canvas at a CSS width, honouring devicePixelRatio. Returns the render task (cancel on unmount). */
export async function renderPage(doc: PdfDoc, pageIndex: number, canvas: HTMLCanvasElement, cssWidth: number, cancelled?: () => boolean): Promise<RenderTask | null> {
  const p = await doc.getPage(pageIndex + 1);
  if (cancelled?.()) return null;
  const base = p.getViewport({ scale: 1 });
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const vp = p.getViewport({ scale: (cssWidth / base.width) * dpr });
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  return p.render({ canvas, viewport: vp });
}

/** Page count + first-page thumbnail (data URL) for the upload cards. */
export async function describePdf(file: File): Promise<{ pages: number; thumb: string }> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const p = await doc.getPage(1);
    const vp = p.getViewport({ scale: 0.35 });
    const c = document.createElement('canvas');
    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    await p.render({ canvas: c, viewport: vp }).promise;
    return { pages: doc.numPages, thumb: c.toDataURL('image/jpeg', 0.8) };
  } finally {
    void closePdf(doc);
  }
}
