"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Extension, type JSONContent } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyleKit } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import { newsletterFonts, newsletterPlainText, newsletterTextDocument, normalizeNewsletterText, richNewsletterLink, type NewsletterTextNode } from "@/lib/marketing/newsletter-rich-text";

const Indentation = Extension.create({
  name: "newsletterIndentation",
  addGlobalAttributes() {
    return [{ types: ["paragraph"], attributes: { indent: {
      default: 0,
      parseHTML: element => Math.min(4, Math.max(0, Math.round(parseInt(element.style.marginLeft || "0") / 20))),
      renderHTML: attributes => attributes.indent ? { style: `margin-left:${attributes.indent * 20}px` } : {},
    } } }];
  },
});

export default function NewsletterRichText({ label, text, value, onChange, compact = false, allowLinks = true }: {
  label: string; text: string; value?: NewsletterTextNode; compact?: boolean; allowLinks?: boolean;
  onChange: (doc: NewsletterTextNode, plain: string) => void;
}) {
  const labelId = useId();
  const callback = useRef(onChange);
  const published = useRef(new Set<string>());
  useEffect(() => { callback.current = onChange; }, [onChange]);
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const document = value && newsletterPlainText(value) === text ? value : newsletterTextDocument(text);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({ heading: false, code: false, codeBlock: false, blockquote: false, horizontalRule: false, trailingNode: false,
      link: allowLinks ? { openOnClick: false, autolink: false, linkOnPaste: false, isAllowedUri: uri => { try { richNewsletterLink(uri); return true; } catch { return false; } } } : false,
    }), TextStyleKit, TextAlign.configure({ types: ["paragraph"], defaultAlignment: null }), Indentation],
    content: document as JSONContent,
    editorProps: { attributes: { class: "nl-rich-input", role: "textbox", "aria-label": label, "aria-labelledby": labelId, "aria-multiline": "true" } },
    onUpdate({ editor }) {
      try {
        const doc = normalizeNewsletterText(editor.getJSON());
        published.current.add(JSON.stringify(doc));
        if (published.current.size > 24) published.current.delete(published.current.values().next().value!);
        callback.current(doc, newsletterPlainText(doc));
        setError("");
      } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not format this text."); }
    },
  });
  const state = useEditorState({ editor, selector: ({ editor }) => editor ? {
    bold: editor.isActive("bold"), italic: editor.isActive("italic"), underline: editor.isActive("underline"), strike: editor.isActive("strike"),
    bullets: editor.isActive("bulletList"), numbered: editor.isActive("orderedList"),
    align: editor.getAttributes("paragraph").textAlign || "",
    fontFamily: editor.getAttributes("textStyle").fontFamily || "",
    fontSize: editor.getAttributes("textStyle").fontSize || "",
    lineHeight: editor.getAttributes("textStyle").lineHeight || "",
    color: editor.getAttributes("textStyle").color || "",
    backgroundColor: editor.getAttributes("textStyle").backgroundColor || "",
    undo: editor.can().undo(), redo: editor.can().redo(),
  } : null });
  useEffect(() => {
    if (published.current.has(JSON.stringify(document))) return;
    if (editor && JSON.stringify(editor.getJSON()) !== JSON.stringify(document)) {
      // Compare normalized documents: editor defaults must not reset the cursor/history on each keystroke.
      if (JSON.stringify(normalizeNewsletterText(editor.getJSON())) !== JSON.stringify(document))
        editor.commands.setContent(document as JSONContent, { emitUpdate: false });
    }
  }, [editor, document]);
  function indent(direction: number) {
    if (!editor) return;
    if (editor.isActive("listItem")) {
      if (direction > 0) editor.chain().focus().sinkListItem("listItem").run();
      else editor.chain().focus().liftListItem("listItem").run();
      return;
    }
    editor.chain().focus().command(({ tr, state }) => {
      state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
        if (node.type.name === "paragraph") tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: Math.min(4, Math.max(0, Number(node.attrs.indent || 0) + direction)) });
      });
      return true;
    }).run();
  }
  const button = (name: string, display: string, action: () => void, pressed?: boolean, disabled = false) => <button type="button" title={name} aria-label={name} aria-pressed={pressed} disabled={!editor || disabled} onMouseDown={event => event.preventDefault()} onClick={action}>{display}</button>;
  return <div className={`nl-rich-field${compact ? " nl-rich-compact" : ""}`}>
    <span id={labelId} className="nl-rich-label">{label}</span>
    <div className="nl-rich-box">
      <div className="nl-rich-toolbar" role="toolbar" aria-label={`${label} formatting`}>
        <div className="nl-rich-tools">
          {button("Bold", "B", () => editor?.chain().focus().toggleBold().run(), state?.bold)}
          {button("Italic", "I", () => editor?.chain().focus().toggleItalic().run(), state?.italic)}
          {button("Underline", "U", () => editor?.chain().focus().toggleUnderline().run(), state?.underline)}
          {button("Strikethrough", "S̶", () => editor?.chain().focus().toggleStrike().run(), state?.strike)}
          {button("Bulleted list", "• List", () => editor?.chain().focus().toggleBulletList().run(), state?.bullets)}
          {button("Numbered list", "1. List", () => editor?.chain().focus().toggleOrderedList().run(), state?.numbered)}
          {button("Decrease indent", "← Indent", () => indent(-1))}
          {button("Increase indent", "Indent →", () => indent(1))}
          {allowLinks && button("Add or edit link", "Link", () => { setUrl(editor?.getAttributes("link").href || "https://www.macroalgaefarms.com/"); setLinkOpen(!linkOpen); })}
          {button("Undo", "↶", () => editor?.chain().focus().undo().run(), undefined, !state?.undo)}
          {button("Redo", "↷", () => editor?.chain().focus().redo().run(), undefined, !state?.redo)}
          {button("Clear formatting", "Clear", () => editor?.chain().focus().unsetAllMarks().clearNodes().updateAttributes("paragraph", { indent: 0, textAlign: null }).run())}
        </div>
        <div className="nl-rich-selects">
          <select aria-label="Font family" title="Font family" value={state?.fontFamily || ""} onChange={event => event.target.value ? editor?.chain().focus().setFontFamily(event.target.value).run() : editor?.chain().focus().unsetFontFamily().run()}><option value="">Template font</option>{newsletterFonts.map(font => <option key={font}>{font}</option>)}</select>
          <select aria-label="Font size" title="Font size" value={state?.fontSize || ""} onChange={event => event.target.value ? editor?.chain().focus().setFontSize(event.target.value).run() : editor?.chain().focus().unsetFontSize().run()}><option value="">Size</option>{[10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48].map(size => <option key={size} value={`${size}px`}>{size}</option>)}</select>
          <select aria-label="Text alignment" title="Text alignment" value={state?.align || ""} onChange={event => event.target.value ? editor?.chain().focus().setTextAlign(event.target.value).run() : editor?.chain().focus().unsetTextAlign().run()}><option value="">Align</option><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option><option value="justify">Justify</option></select>
          <select aria-label="Line spacing" title="Line spacing" value={state?.lineHeight || ""} onChange={event => event.target.value ? editor?.chain().focus().setLineHeight(event.target.value).run() : editor?.chain().focus().unsetLineHeight().run()}><option value="">Spacing</option>{[1, 1.25, 1.5, 1.75, 2, 2.5].map(size => <option key={size}>{size}</option>)}</select>
          <label className="nl-rich-color" title="Text color">Color<input type="color" aria-label="Text color" value={state?.color || "#102641"} onChange={event => editor?.chain().focus().setColor(event.target.value).run()} /></label>
          <label className="nl-rich-color" title="Highlight color">Highlight<input type="color" aria-label="Highlight color" value={state?.backgroundColor || "#e8e3d0"} onChange={event => editor?.chain().focus().setBackgroundColor(event.target.value).run()} /></label>
        </div>
      </div>
      {linkOpen && <div className="nl-rich-link">
        <label>Link to Macroalgae Farms<input aria-label={`${label} link URL`} type="url" value={url} onChange={event => setUrl(event.target.value)} onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} /></label>
        <button type="button" onClick={() => { try { const href = richNewsletterLink(url.trim()); editor?.chain().focus().extendMarkRange("link").setLink({ href }).run(); setLinkOpen(false); setError(""); } catch (failure) { setError((failure as Error).message); } }}>Apply link</button>
        <button type="button" onClick={() => { editor?.chain().focus().unsetLink().run(); setLinkOpen(false); setError(""); }}>Remove link</button>
        <button type="button" onClick={() => { setLinkOpen(false); setError(""); }}>Cancel</button>
      </div>}
      <EditorContent editor={editor} />
    </div>
    {error && <p role="alert" className="mk-editor-error">{error}</p>}
  </div>;
}
