import { useEffect, useRef, useState, type ReactNode } from 'react';
import { closePdf, openPdf, renderPage, PAGE_WIDTH, type LoadedPdf } from '../lib/pdf';
import { errMsg } from '../lib/format';
import { ErrorNote, Loading } from './ui';

export interface PageBox { index: number; W: number; H: number; ptW: number; ptH: number }

/** Load a PDF from a Blob loader once. */
export function usePdf(load: (() => Promise<Blob>) | null, deps: unknown[]) {
  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!load) return;
    let off = false; let loaded: LoadedPdf | null = null;
    setPdf(null); setError('');
    load().then(b => openPdf(b)).then(p => { loaded = p; if (off) void closePdf(p.doc); else setPdf(p); }).catch(e => { if (!off) setError(errMsg(e)); });
    return () => { off = true; if (loaded) void closePdf(loaded.doc); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { pdf, error };
}

function PdfPage({ pdf, index, W, H, children }: { pdf: LoadedPdf; index: number; W: number; H: number; children?: ReactNode }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let task: { cancel: () => void } | null = null; let off = false;
    const c = ref.current; if (!c) return;
    renderPage(pdf.doc, index, c, W, () => off).then(t => { if (!t) return; if (off) { t.cancel(); return; } task = t; t.promise.catch(() => { /* cancelled */ }); }).catch(() => { });
    return () => { off = true; task?.cancel(); };
  }, [pdf, index, W]);
  return (
    <div className="page" data-p={index} style={{ width: W, height: H }}>
      <canvas key={W} ref={ref} />
      <div className="layer">{children}</div>
      <div className="pno">{index + 1}</div>
    </div>
  );
}

/** Renders every page at 816px * zoom with an overlay layer per page. */
export function PdfPages({ pdf, zoom, overlay }: { pdf: LoadedPdf; zoom: number; overlay?: (p: PageBox) => ReactNode }) {
  const W = PAGE_WIDTH * zoom;
  return <>
    {pdf.sizes.map((s, i) => {
      const H = W * s.h / s.w;
      return <PdfPage key={i} pdf={pdf} index={i} W={W} H={H}>{overlay?.({ index: i, W, H, ptW: s.w, ptH: s.h })}</PdfPage>;
    })}
  </>;
}

/** Simple read-only viewer used in modals. */
export function PdfViewer({ load, deps, zoom = 0.8 }: { load: () => Promise<Blob>; deps: unknown[]; zoom?: number }) {
  const { pdf, error } = usePdf(load, deps);
  const [z] = useState(() => Math.max(0.4, Math.min(zoom, (window.innerWidth - 140) / PAGE_WIDTH)));
  return (
    <div className="pdfview">
      {error ? <ErrorNote error={error} /> : !pdf ? <div className="pdfwait"><Loading text="Opening document…" /></div> : <PdfPages pdf={pdf} zoom={z} />}
    </div>
  );
}
