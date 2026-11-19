import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { SignatureDto } from '../api/types';
import { initials } from '../lib/format';
import { fontsReady, INK, SIG_FONTS, textSig, trimCanvas } from '../lib/signature';
import { Modal } from './Modal';
import { useUi } from './ui';

type Tab = 'type' | 'draw' | 'upload';

/** Adopt Signature dialog: type (3 fonts) / draw / upload, plus initials. */
export function AdoptSignature({ name, email, saved, onAdopt, onClose, adoptLabel = 'Adopt and Sign' }: {
  name: string; email: string; saved?: SignatureDto | null; adoptLabel?: string;
  onAdopt: (s: { signatureImage: string; initialImage: string; name: string; method: Tab | 'saved' }) => void; onClose: () => void;
}) {
  const ui = useUi();
  const [tab, setTab] = useState<Tab>('type');
  const [font, setFont] = useState<string>(SIG_FONTS[0]);
  const [n, setN] = useState(name);
  const [ini, setIni] = useState(initials(name));
  const [upImg, setUpImg] = useState<string | null>(null);
  const [, setFontsLoaded] = useState(false);
  const pad = useRef<HTMLCanvasElement>(null);
  const drawn = useRef(false);

  useEffect(() => { void fontsReady().then(() => setFontsLoaded(true)); }, []);

  // size the drawing pad when the Draw tab opens
  useEffect(() => {
    if (tab !== 'draw') return;
    const c = pad.current; if (!c) return;
    if (c.width !== c.clientWidth * 2) {
      c.width = c.clientWidth * 2; c.height = 400;
      const ctx = c.getContext('2d')!;
      ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = INK;
      drawn.current = false;
    }
  }, [tab]);

  const down = useRef(false), last = useRef<[number, number]>([0, 0]);
  const pt = (e: RPointerEvent<HTMLCanvasElement>): [number, number] => {
    const c = e.currentTarget, r = c.getBoundingClientRect();
    return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height];
  };
  const onDown = (e: RPointerEvent<HTMLCanvasElement>) => { down.current = true; last.current = pt(e); e.currentTarget.setPointerCapture(e.pointerId); };
  const onMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (!down.current) return;
    const ctx = e.currentTarget.getContext('2d')!, p = pt(e), l = last.current;
    ctx.beginPath(); ctx.moveTo(l[0], l[1]);
    const m: [number, number] = [(l[0] + p[0]) / 2, (l[1] + p[1]) / 2];
    ctx.quadraticCurveTo(l[0], l[1], m[0], m[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
    last.current = p; drawn.current = true;
  };
  const clear = () => { const c = pad.current; if (c) c.getContext('2d')!.clearRect(0, 0, c.width, c.height); drawn.current = false; };

  const onFile = (f?: File) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) { ui.toast('Choose an image file.'); return; }
    const r = new FileReader(); r.onload = () => setUpImg(String(r.result)); r.readAsDataURL(f);
  };

  const adopt = () => {
    const nn = n.trim(), ii = ini.trim();
    if (!nn || !ii) { ui.toast('Enter your name and initials.'); return; }
    let sig: string | null;
    if (tab === 'type') sig = textSig(nn, font);
    else if (tab === 'draw') { if (!drawn.current || !pad.current) { ui.toast('Draw your signature first.'); return; } sig = trimCanvas(pad.current); }
    else { if (!upImg) { ui.toast('Upload an image first.'); return; } sig = upImg; }
    if (!sig) { ui.toast('Draw your signature first.'); return; }
    onAdopt({ signatureImage: sig, initialImage: textSig(ii, tab === 'type' ? font : SIG_FONTS[0]), name: nn, method: tab });
  };

  return (
    <Modal onClose={onClose} title="Adopt your signature">
      <p className="hint" style={{ marginTop: -12 }}>Confirm your name, initials and signature. This signature will be saved for {email}.</p>
      {saved?.signatureImage && (
        <div className="att-box" style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div className="sigbox" style={{ flex: 1, minWidth: 180 }}><img src={saved.signatureImage} alt="Saved signature" /></div>
          <button className="btn" onClick={() => onAdopt({ signatureImage: saved.signatureImage!, initialImage: saved.initialImage || textSig(initials(name), SIG_FONTS[0]), name, method: 'saved' })}>Use saved signature</button>
        </div>
      )}
      <div className="form-grid">
        <div><label className="l">Full name <span className="req">*</span></label><input className="inp" value={n} onChange={e => setN(e.target.value)} /></div>
        <div><label className="l">Initials <span className="req">*</span></label><input className="inp" value={ini} maxLength={5} onChange={e => setIni(e.target.value)} /></div>
      </div>
      <div className="tabs">
        {(['type', 'draw', 'upload'] as Tab[]).map(t => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}
      </div>
      {tab === 'type' && SIG_FONTS.map(f => (
        <div key={f} className={'fontopt ' + (f === font ? 'active' : '')} onClick={() => setFont(f)}>
          <input type="radio" readOnly checked={f === font} />
          <div className="sig" style={{ fontFamily: `'${f}'` }}>{n || ' '}</div>
          <div className="ini" style={{ fontFamily: `'${f}'` }}>{ini || ' '}</div>
        </div>
      ))}
      <div className={tab === 'draw' ? '' : 'hidden'}>
        <div className="padwrap"><canvas ref={pad} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => { down.current = false; }} /><div className="line" /></div>
        <div style={{ textAlign: 'right', marginTop: 6 }}><button className="btn sm ghost" onClick={clear}>Clear</button></div>
      </div>
      {tab === 'upload' && <>
        <div className="drop" style={{ padding: 22 }}><p>Upload an image of your signature (PNG with transparent background works best)</p>
          <input type="file" accept="image/*" onChange={e => onFile(e.target.files?.[0])} /></div>
        <div className="sigbox" style={{ marginTop: 10, height: 110 }}>{upImg ? <img src={upImg} alt="" /> : 'No image'}</div>
      </>}
      <p className="hint">By selecting {adoptLabel}, I agree that the signature and initials will be the electronic representation of my signature and initials for all purposes when I use them on documents, including legally binding contracts.</p>
      <div className="mfoot"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn blue" onClick={adopt}>{adoptLabel}</button></div>
    </Modal>
  );
}
