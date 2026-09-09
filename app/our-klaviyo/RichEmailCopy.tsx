"use client";
import { useEffect, useRef, useState } from "react";
import { sanitizeEmailHtml, safeUrl } from "@/lib/marketing/rules";

export default function RichEmailCopy({
  value,
  onChange,
}: {
  value: string;
  onChange: (html: string) => void;
}) {
  const editor = useRef<HTMLDivElement>(null);
  const emitted = useRef<string | null>(null);
  const selection = useRef<Range | null>(null);
  const [source, setSource] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState("https://");
  const [error, setError] = useState("");
  useEffect(() => {
    if (
      editor.current &&
      (emitted.current !== value || editor.current.innerHTML === "")
    ) {
      editor.current.innerHTML = sanitizeEmailHtml(value);
    }
  }, [value, source]);
  function publish() {
    if (!editor.current) return;
    emitted.current = editor.current.innerHTML;
    onChange(emitted.current);
  }
  function remember() {
    const current = window.getSelection();
    if (current?.rangeCount && editor.current?.contains(current.anchorNode))
      selection.current = current.getRangeAt(0).cloneRange();
  }
  function command(name: string, argument?: string) {
    editor.current?.focus();
    if (
      selection.current &&
      editor.current?.contains(selection.current.commonAncestorContainer)
    ) {
      const current = window.getSelection();
      current?.removeAllRanges();
      current?.addRange(selection.current);
    }
    // Native editing commands preserve the browser's undo history. Kept inside
    // this component so it can migrate when a supported replacement is available.
    document.execCommand(name, false, argument);
    remember();
    publish();
  }
  return (
    <div className="mk-copy-editor">
      <div className="mk-copy-heading">
        <label id="mk-copy-label">Message</label>
        <button
          type="button"
          aria-pressed={source}
          onClick={() => {
            setSource(!source);
            selection.current = null;
            emitted.current = null;
          }}
        >
          {source ? "Visual editor" : "Edit HTML"}
        </button>
      </div>
      {source ? (
        <label className="mk-source-label">
          Message HTML
          <textarea
            aria-label="Message HTML"
            rows={16}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
          />
        </label>
      ) : (
        <>
          <div
            className="mk-format-bar"
            role="toolbar"
            aria-label="Text formatting"
          >
            {[
              ["bold", "Bold", "B"],
              ["italic", "Italic", "I"],
              ["underline", "Underline", "U"],
              ["insertUnorderedList", "Bulleted list", "• List"],
              ["undo", "Undo", "↶"],
              ["redo", "Redo", "↷"],
            ].map(([action, label, text]) => (
              <button
                key={action}
                type="button"
                title={label}
                aria-label={label}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => command(action)}
              >
                {text}
              </button>
            ))}
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                remember();
                setLinkOpen(!linkOpen);
              }}
            >
              Link
            </button>
          </div>
          {linkOpen && (
            <div className="mk-link-entry">
              <label>
                Link URL
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  try {
                    const href = safeUrl(url);
                    command("createLink", href);
                    setLinkOpen(false);
                    setError("");
                  } catch {
                    setError("Enter a full HTTPS link.");
                  }
                }}
              >
                Apply link
              </button>
              <button
                type="button"
                onClick={() => {
                  command("unlink");
                  setLinkOpen(false);
                }}
              >
                Remove link
              </button>
              {error && <p role="alert">{error}</p>}
            </div>
          )}
          <div
            ref={editor}
            className="mk-rich-copy"
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-labelledby="mk-copy-label"
            aria-multiline="true"
            onInput={publish}
            onKeyUp={remember}
            onMouseUp={remember}
            onBlur={remember}
            onClick={(e) => {
              if ((e.target as Element).closest("a")) e.preventDefault();
            }}
            onPaste={(e) => {
              e.preventDefault();
              command("insertText", e.clipboardData.getData("text/plain"));
            }}
            onDrop={(e) => e.preventDefault()}
          />
        </>
      )}
      <small>
        Type directly and select text to format it. Existing custom HTML remains
        available.
      </small>
    </div>
  );
}
