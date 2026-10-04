"use client";
import { useEffect, useRef } from "react";
export default function Confirmation({
  children,
  onClose,
  busy,
}: {
  children: React.ReactNode;
  onClose: () => void;
  busy: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="confirm"
      aria-labelledby="confirm-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      {children}
    </dialog>
  );
}
