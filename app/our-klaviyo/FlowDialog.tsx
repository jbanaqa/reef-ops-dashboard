"use client";
import { useEffect, useRef } from "react";
export default function FlowDialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current!;
    const focus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    el.showModal();
    return () => {
      el.close();
      document.body.style.overflow = overflow;
      focus?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="mk-flow-dialog"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="mk-modal-header">
        <h3>{title}</h3>
        <button type="button" onClick={close}>
          Close
        </button>
      </div>
      {children}
    </dialog>
  );
}
