"use client";

import { useState } from "react";

type RowAction = (formData: FormData) => Promise<void>;

type RestockWaitlistRowActionsProps = {
  entryId: string;
  status: string;
  sendAction: RowAction;
  deleteAction: RowAction;
};

export function RestockWaitlistRowActions({
  entryId,
  status,
  sendAction,
  deleteAction,
}: RestockWaitlistRowActionsProps) {
  const [isSending, setIsSending] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const canSend = status === "Waiting";

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "8px",
      }}
    >
      <form
        action={sendAction}
        onSubmit={() => setIsSending(true)}
      >
        <input
          type="hidden"
          name="entryId"
          value={entryId}
        />
        <button
          type="submit"
          className="button button-primary"
          disabled={!canSend || isSending || isDeleting}
        >
          {canSend
            ? isSending
              ? "Sending..."
              : "Send email"
            : "Email sent"}
        </button>
      </form>

      <form
        action={deleteAction}
        onSubmit={(event) => {
          const confirmed = window.confirm(
            "Delete this waitlist signup permanently?"
          );

          if (!confirmed) {
            event.preventDefault();
            return;
          }

          setIsDeleting(true);
        }}
      >
        <input
          type="hidden"
          name="entryId"
          value={entryId}
        />
        <button
          type="submit"
          className="button button-secondary"
          disabled={isSending || isDeleting}
        >
          {isDeleting ? "Deleting..." : "Delete"}
        </button>
      </form>
    </div>
  );
}
