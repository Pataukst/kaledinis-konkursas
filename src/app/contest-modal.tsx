"use client";
import { useEffect, useRef, type ReactNode } from "react";

export default function ContestModal({ title, children, onClose, busy = false, wide = false, closeOnBackdrop = false }: {
  title: string; children: ReactNode; onClose: () => void; busy?: boolean; wide?: boolean; closeOnBackdrop?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return <dialog ref={ref} className={`contest-modal ${wide ? "policy-modal" : ""}`}
    onClick={e => {
      if (!closeOnBackdrop || busy || e.target !== e.currentTarget) return;
      const bounds = e.currentTarget.getBoundingClientRect();
      if (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom) onClose();
    }}
    aria-label={title} onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <div className="modal-heading"><h2>{title}</h2>
      <button type="button" className="modal-close" aria-label={`Uždaryti: ${title}`} onClick={onClose} disabled={busy}>×</button>
    </div>
    <div className="modal-content">{children}</div>
  </dialog>;
}

