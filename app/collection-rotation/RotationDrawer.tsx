"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

export default function RotationDrawer({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog?.open) dialog?.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="rotation-drawer"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="rotation-drawer-header">
        <div>
          <span>COLLECTION ROTATION</span>
          <h2 id={titleId}>{title}</h2>
        </div>
        <button
          type="button"
          className="button button-secondary"
          onClick={onClose}
        >
          Done
        </button>
      </header>
      <div className="rotation-drawer-body">{children}</div>
    </dialog>
  );
}
