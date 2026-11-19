import { useState } from 'react';
import { Icon } from '../lib/icons';
import { describePdf } from '../lib/pdf';
import { pickFiles } from '../lib/format';
import { useUi } from './ui';

export interface PdfItem { file: File; pages: number; thumb: string }

/** Read picked/dropped files, keeping only PDFs that pdf.js can open. */
export async function readPdfs(list: File[], toast: (m: string) => void, max = Infinity): Promise<PdfItem[]> {
  const out: PdfItem[] = [];
  for (const f of list) {
    if (out.length >= max) break;
    if (!/pdf$/i.test(f.type) && !/\.pdf$/i.test(f.name)) { toast(f.name + ' is not a PDF.'); continue; }
    try { out.push({ file: f, ...(await describePdf(f)) }); } catch { toast('Could not open ' + f.name + '.'); }
  }
  return out;
}

/** PDF dropzone with document cards (prototype uploadArea/wireUpload). */
export function UploadArea({ files, onChange, single }: { files: PdfItem[]; onChange: (f: PdfItem[]) => void; single?: boolean }) {
  const ui = useUi();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const add = async (list: File[]) => {
    if (!list.length) return;
    setBusy(true);
    try {
      const got = await readPdfs(list, ui.toast, single ? 1 : Infinity);
      if (got.length) onChange(single ? got.slice(0, 1) : [...files, ...got]);
    } finally { setBusy(false); }
  };
  return (
    <div className="up">
      {files.map((f, i) => (
        <div className="fcard" key={i + f.file.name}>
          <div className="th"><img src={f.thumb} alt="" /></div>
          <div className="meta"><div><b title={f.file.name}>{f.file.name}</b><small>{f.pages} page{f.pages > 1 ? 's' : ''}</small></div>
            <button className="icon-btn" aria-label={'Options for ' + f.file.name} onClick={e => ui.menu(e.currentTarget, [
              { label: 'Remove', icon: 'trash', bad: true, run: () => onChange(files.filter((_, k) => k !== i)) },
            ])}><Icon name="dots" /></button>
          </div>
        </div>
      ))}
      {!(single && files.length) && (
        <div className={'drop ' + (over ? 'over' : '')}
          onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); setOver(false); void add(Array.from(e.dataTransfer.files)); }}>
          <div className="ic"><Icon name="up" size={22} /></div>
          <p>{busy ? 'Reading document…' : single ? 'Drop your PDF file here or' : 'Drop your PDF files here or'}</p>
          <button className="btn blue" disabled={busy} onClick={() => pickFiles(fl => void add(fl), 'application/pdf,.pdf', !single)}>Upload <Icon name="chev" size={14} /></button>
        </div>
      )}
    </div>
  );
}
