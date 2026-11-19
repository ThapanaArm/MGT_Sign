import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../lib/icons';

// Stack of open modals so Escape closes only the top one.
const stack: number[] = [];
let seq = 0;

export function Modal({ onClose, size, children, title }: { onClose: () => void; size?: 'sm' | 'wide'; children: ReactNode; title?: ReactNode }) {
  const id = useRef(0);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    id.current = ++seq; stack.push(id.current);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stack[stack.length - 1] === id.current && !document.querySelector('.menu')) { e.stopPropagation(); closeRef.current(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); const i = stack.indexOf(id.current); if (i >= 0) stack.splice(i, 1); };
  }, []);
  return createPortal(
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'modal ' + (size || '')} role="dialog" aria-modal="true">
        <button className="icon-btn x" onClick={onClose} aria-label="Close"><Icon name="x" size={22} /></button>
        {title !== undefined && <h2>{title}</h2>}
        {children}
      </div>
    </div>,
    document.body,
  );
}
