import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { LiveSignatureEvidence, SignatureDto } from '../api/types';
import { initials } from '../lib/format';
import { fontsReady, INK, SIG_FONTS, textSig, trimCanvas } from '../lib/signature';
import { Modal } from './Modal';
import { useUi } from './ui';

type Tab = 'type' | 'draw' | 'upload';

/**
 * Adopt Signature dialog: type (3 fonts) / draw / upload, plus initials.
 * `live` = face-to-face signing: the only option is drawing by hand, and the handwriting is summarised as evidence.
 */
export function AdoptSignature({ name, email, saved, onAdopt, onClose, adoptLabel = 'Adopt and Sign', live, purpose = 'signature' }: {
  name: string; email: string; saved?: SignatureDto | null; adoptLabel?: string; live?: boolean; purpose?: 'signature' | 'initial';
  onAdopt: (s: { signatureImage: string; initialImage: string; name: string; method: Tab | 'saved'; evidence?: LiveSignatureEvidence }) => void; onClose: () => void;
}) {
  const ui = useUi();
  const [tab, setTab] = useState<Tab>(live ? 'draw' : 'type');
  // handwriting evidence for the current drawing
  const ev = useRef({ strokes: 0, points: 0, start: 0, end: 0, types: new Set<string>() });
  const [font, setFont] = useState<string>(SIG_FONTS[0]);
  const [n, setN] = useState(name);
  const [ini, setIni] = useState(initials(name));
  const [upImg, setUpImg] = useState<string | null>(null);
  const [, setFontsLoaded] = useState(false);
  const pad = useRef<HTMLCanvasElement>(null);
  const drawn = useRef(false);

  useEffect(() => { void fontsReady().then(() => setFontsLoaded(true)); }, []);

  // size the drawing pad (when the Draw tab opens, and again on the first touch in case the dialog was still laying out)
  const sizePad = () => {
    const c = pad.current; if (!c || !c.clientWidth) return;
    if (c.width !== c.clientWidth * 2) {
      c.width = c.clientWidth * 2; c.height = c.clientHeight * 2 || 400;
      const ctx = c.getContext('2d')!;
      ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = INK;
      drawn.current = false;
    }
  };
  useEffect(() => { if (tab === 'draw') sizePad(); }, [tab]);

  const down = useRef(false), last = useRef<[number, number]>([0, 0]);
  const pt = (e: RPointerEvent<HTMLCanvasElement>): [number, number] => {
    const c = e.currentTarget, r = c.getBoundingClientRect();
    return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height];
  };
  const onDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (!drawn.current) sizePad();
    // record the evidence first: pointer capture can throw on some browsers/devices and must not lose the stroke
    const v = ev.current; v.strokes++; v.types.add(e.pointerType || 'mouse'); if (!v.start) v.start = performance.now();
    down.current = true; last.current = pt(e);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* drawing still works without capture */ }
  };
  const onMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (!down.current) return;
    const ctx = e.currentTarget.getContext('2d')!, p = pt(e), l = last.current;
    ctx.beginPath(); ctx.moveTo(l[0], l[1]);
    const m: [number, number] = [(l[0] + p[0]) / 2, (l[1] + p[1]) / 2];
    ctx.quadraticCurveTo(l[0], l[1], m[0], m[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
    last.current = p; drawn.current = true; ev.current.points++;
  };
  const onUp = () => { down.current = false; ev.current.end = performance.now(); };
  const clear = () => {
    const c = pad.current; if (c) c.getContext('2d')!.clearRect(0, 0, c.width, c.height); drawn.current = false;
    ev.current = { strokes: 0, points: 0, start: 0, end: 0, types: new Set() };
  };
  const evidence = (): LiveSignatureEvidence => {
    const v = ev.current, t = [...v.types];
    return { strokes: v.strokes, points: v.points, durationMs: v.start ? Math.round(Math.max(0, v.end - v.start)) : 0, pointerType: t.includes('pen') ? 'pen' : t.includes('touch') ? 'touch' : t[0] || 'mouse' };
  };

  const onFile = (f?: File) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) { ui.toast('Choose an image file.'); return; }
    const r = new FileReader(); r.onload = () => setUpImg(String(r.result)); r.readAsDataURL(f);
  };

  const adopt = () => {
    if (live) {
      // Face to face: the drawing itself is the signature (or initials) — nothing typed or uploaded.
      const e = evidence();
      if (!drawn.current || !pad.current || e.points < 15 || e.strokes < 1) { ui.toast('Draw your signature by hand on the pad.'); return; }
      const img = trimCanvas(pad.current);
      if (!img) { ui.toast('Draw your signature by hand on the pad.'); return; }
      onAdopt({ signatureImage: img, initialImage: img, name, method: 'draw', evidence: e });
      return;
    }
    const nn = n.trim(), ii = ini.trim();
    if (!nn || !ii) { ui.toast('Enter your name and initials.'); return; }
    let sig: string | null;
    if (tab === 'type') sig = textSig(nn, font);
    else if (tab === 'draw') { if (!drawn.current || !pad.current) { ui.toast('Draw your signature first.'); return; } sig = trimCanvas(pad.current); }
    else { if (!upImg) { ui.toast('Upload an image first.'); return; } sig = upImg; }
    if (!sig) { ui.toast('Draw your signature first.'); return; }
    onAdopt({ signatureImage: sig, initialImage: textSig(ii, tab === 'type' ? font : SIG_FONTS[0]), name: nn, method: tab });
  };

  if (live) return (
    <Modal onClose={onClose} title={purpose === 'initial' ? `${name}, draw your initials` : `${name}, sign here`}>
      <p className="hint" style={{ marginTop: -12 }}>Live signing: draw your {purpose === 'initial' ? 'initials' : 'signature'} by hand with your finger, a stylus or the mouse. Typed or uploaded signatures are not accepted.</p>
      <div className="padwrap live"><canvas ref={pad} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} aria-label="Signature pad" /><div className="line" /></div>
      <div style={{ textAlign: 'right', marginTop: 6 }}><button className="btn sm ghost" onClick={clear}>Clear</button></div>
      <p className="hint">By selecting {adoptLabel}, I agree that this handwritten signature is my electronic signature for this document and is legally binding. The time and the way it was drawn are recorded in the audit trail.</p>
      <div className="mfoot"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn blue" onClick={adopt}>{adoptLabel}</button></div>
    </Modal>
  );

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
        <div className="padwrap"><canvas ref={pad} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} /><div className="line" /></div>
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
