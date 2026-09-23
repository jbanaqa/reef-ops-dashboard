"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import {
  Content,
  defaultCampaignContent,
  type EmailLayout,
  escapeHtml,
  imageSource,
  footerBackgroundColor,
  footerTitle,
  defaultFooterCopyright,
  defaultGeneratedEmailCopy,
} from "@/lib/marketing/rules";
import EmailPreview from "./EmailPreview";
import RichEmailCopy from "./RichEmailCopy";
import CampaignEmailFields from "./CampaignEmailFields";

const emailLayoutNames: Record<EmailLayout, string> = {
  standard: "Standard",
  "b2b-wholesale": "B2B wholesale",
  "cart-recovery": "Cart recovery",
  welcome: "Welcome offer",
  "welcome-social": "Welcome social",
  "campaign-sale": "Campaign sale",
};

function Artwork({
  label,
  value,
  scale,
  onChange,
  onScale,
  maxFileBytes = 3_700_000,
}: {
  label: string;
  value?: string;
  scale: number;
  onChange: (value: string | undefined) => void;
  onScale?: (value: number) => void;
  maxFileBytes?: number;
}) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const version = useRef(0);
  useEffect(
    () => () => {
      version.current++;
    },
    [],
  );
  return (
    <section className="mk-art-card">
      <h3>{label}</h3>
      <div className="mk-art-thumbnail">
        {value ? (
          <img src={value} alt={label + " artwork"} />
        ) : (
          <span>No image uploaded</span>
        )}
      </div>
      <label className="mk-upload-button">
        {loading ? "Uploading…" : value ? "Replace image" : "Upload image"}
        <input
          aria-label={label + " image"}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            const current = ++version.current;
            setError("");
            if (
              !/^image\/(png|jpeg|webp|gif)$/.test(file.type) ||
              file.size > maxFileBytes ||
              Math.ceil(file.size / 3) * 4 + 40 > 5000000
            ) {
              setError(
                `Use a PNG, JPEG, WebP, or GIF smaller than ${
                  maxFileBytes <= 500_000 ? "500 KB" : "3.7 MB"
                }.`,
              );
              return;
            }
            setLoading(true);
            try {
              const data = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = () =>
                  reject(new Error("Could not read this image."));
                reader.readAsDataURL(file);
              });
              if (current === version.current) onChange(imageSource(data));
            } catch {
              if (current === version.current)
                setError("Could not load this image. Please try another file.");
            } finally {
              if (current === version.current) setLoading(false);
            }
          }}
        />
      </label>
      {value && (
        <button
          type="button"
          className="mk-text-button"
          onClick={() => {
            version.current++;
            setLoading(false);
            onChange(undefined);
          }}
        >
          Remove {label.toLowerCase()}
        </button>
      )}
      {onScale && (
        <label className="mk-art-scale">
          Image size <span>{Math.round(scale * 100)}%</span>
          <input
            aria-label={label + " size"}
            type="range"
            min="0.25"
            max="2.5"
            step="0.05"
            value={scale}
            onChange={(e) => onScale(Number(e.target.value))}
          />
        </label>
      )}
      {error && (
        <p className="mk-editor-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export default function EmailDesigner({
  title,
  subject,
  content,
  html,
  previewError,
  busy,
  status,
  onSubject,
  onContent,
  onSave,
  onClose,
  onTest,
  organizationName,
  postalAddress,
  contentFields,
  previewSubject,
  previewCaption,
  recoveryLink,
  editProducts = false,
  subjectEditable = true,
  backLabel = "Back to flow",
  readOnly = false,
}: {
  backLabel?: string;
  readOnly?: boolean;
  editProducts?: boolean;
  subjectEditable?: boolean;
  recoveryLink?: boolean;
  contentFields?: React.ReactNode;
  previewSubject?: string;
  previewCaption?: string;
  organizationName: string;
  postalAddress: string;
  title: string;
  subject: string;
  content: Content;
  html: string;
  previewError: string;
  busy: boolean;
  status: string;
  onSubject: (value: string) => void;
  onContent: (key: keyof Content, value: Content[keyof Content]) => void;
  onSave?: () => Promise<boolean>;
  onClose: () => void;
  onTest?: (
    to: string,
    subject: string,
    content: Content,
  ) => void | Promise<unknown>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [panel, setPanel] = useState<
    "content" | "layout" | "artwork" | "footer" | "test"
  >("content");
  const visualLayout = content.layout || content.template || "standard";
  const [mobile, setMobile] = useState(false);
  const [mobileWidth, setMobileWidth] = useState(375);
  const [recipient, setRecipient] = useState("");
  const [work, setWork] = useState<"save" | "test" | null>(null);
  const working = work !== null;
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const node = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    node?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      node?.close();
      previous?.focus();
      document.body.style.overflow = overflow;
    };
  }, []);
  const copy =
    content.bodyHtml !== undefined
      ? content.bodyHtml
      : content.body
          .split("\n")
          .slice(content.template === "b2b-wholesale" ? 2 : 0)
          .map((line) => (line ? "<p>" + escapeHtml(line) + "</p>" : ""))
          .join("\n");
  const includesHeading =
    content.template === "b2b-wholesale" &&
    !!content.bodyHtml?.trim() &&
    (/<h1\b/i.test(content.bodyHtml) ||
      /first_name\s*\|\s*default/i.test(content.bodyHtml));
  function changeContent(key: keyof Content, value: Content[keyof Content]) {
    setNotice("");
    onContent(key, value);
  }
  async function save() {
    if (!onSave) return;
    setWork("save");
    setNotice("");
    try {
      setNotice(
        (await onSave())
          ? "Email saved"
          : "Save failed. Your draft is still here; check the settings and try again.",
      );
    } catch {
      setNotice("Save failed. Your draft is still here. Please try again.");
    } finally {
      setWork(null);
    }
  }
  return (
    <dialog
      ref={dialog}
      className={`mk-designer ${readOnly ? "is-read-only" : ""}`}
      aria-label="Email editor"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className="mk-designer-header">
        <button
          type="button"
          className="mk-back-button"
          onClick={onClose}
          aria-label={backLabel}
        >
          ← <span>{backLabel}</span>
        </button>
        <div className="mk-designer-title">
          <span>EMAIL EDITOR</span>
          <h2>{title}</h2>
        </div>
        <div className="mk-designer-header-actions">
          <span className="mk-draft-badge">
            {readOnly ? "Read-only email" : working || busy ? "Working…" : "Email draft"}
          </span>
          {!readOnly && (
            <button
              className="mk-primary"
              type="button"
              disabled={busy || working || !!previewError}
              onClick={save}
            >
              {work === "save" ? "Saving…" : "Save email"}
            </button>
          )}
        </div>
      </header>
      <div className="mk-designer-body">
        {!readOnly && <aside className="mk-designer-sidebar">
          <nav className="mk-designer-tabs" aria-label="Email editing sections">
            {(["content", "layout", "artwork", "footer", "test"] as const)
              .filter((tab) => tab !== "test" || !!onTest)
              .map((tab) => (
                <button
                  key={tab}
                  type="button"
                  aria-pressed={panel === tab}
                  onClick={() => setPanel(tab)}
                >
                   {tab === "content"
                      ? "Content"
                    : tab === "layout"
                      ? "Layout"
                    : tab === "artwork"
                      ? "Artwork"
                      : tab === "footer"
                        ? "Footer"
                        : "Send test"}
                </button>
              ))}
          </nav>
          <div className="mk-designer-fields">
            {panel === "content" &&
              (contentFields || (content.template === "campaign-sale" && visualLayout === "campaign-sale" ? (
                <section className="mk-editor-section">
                  <h3>Inbox details</h3>
                  <p>Edit the sale structure in Layout. These details appear in the inbox.</p>
                  <label>Subject<input value={subject} onChange={(event) => onSubject(event.target.value)} /></label>
                  <label>Preview text<input value={content.preview || ""} onChange={(event) => changeContent("preview", event.target.value)} /></label>
                </section>
              ) : (
                <>
                  <section className="mk-editor-section">
                    <h3>Inbox details</h3>
                    <p>The first thing your customer sees.</p>
                    <label>
                      {subjectEditable ? "Subject" : "Preview subject"}
                      <input
                        readOnly={!subjectEditable}
                        value={subject}
                        onChange={(e) => {
                          setNotice("");
                          onSubject(e.target.value);
                        }}
                      />
                    </label>
                    <label>
                      Preview text
                      <input
                        value={content.preview || ""}
                        placeholder="A short introduction beside the subject"
                        onChange={(e) =>
                          changeContent("preview", e.target.value)
                        }
                      />
                    </label>
                  </section>
                  <section className="mk-editor-section">
                    <h3>Email content</h3>
                    {!includesHeading ? (
                      <label>
                        Heading
                        <input
                          aria-label="Heading"
                          value={content.heading}
                          onChange={(e) =>
                            changeContent("heading", e.target.value)
                          }
                        />
                        <small>
                          Personalize with {`{{ first_name|default:"Aloha" }}`}.
                        </small>
                      </label>
                    ) : (
                      <p>Your heading is included in the message below.</p>
                    )}
                    {!includesHeading &&
                      (content.template === "b2b-wholesale" ||
                        visualLayout === "b2b-wholesale") && (
                      <label>
                        Intro line
                        <input
                          aria-label="Intro line"
                          value={
                            content.introText !== undefined
                              ? content.introText
                              : content.body.split("\n")[0] ||
                                defaultGeneratedEmailCopy.b2bIntro
                          }
                          onChange={(event) =>
                            changeContent("introText", event.target.value)
                          }
                        />
                        <small>
                          Appears between the heading and Message. Leave blank to
                          show no separate intro line.
                        </small>
                      </label>
                    )}
                    <RichEmailCopy
                      value={copy}
                      onChange={(value) => changeContent("bodyHtml", value)}
                    />
                  </section>
                  {(content.template?.startsWith("welcome") ||
                    content.template === "cart-recovery" ||
                    visualLayout === "welcome" ||
                    visualLayout === "welcome-social" ||
                    visualLayout === "cart-recovery" ||
                    content.couponCode) && (
                    <details className="mk-editor-section mk-editor-disclosure">
                      <summary>
                        <span>Automatic text</span>
                        <small>Coupon, greeting, and social wording</small>
                      </summary>
                      <div className="mk-editor-disclosure-body">
                        {(content.template?.startsWith("welcome") ||
                          content.template === "cart-recovery" ||
                          visualLayout === "welcome" ||
                          visualLayout === "cart-recovery" ||
                          content.couponCode) && (
                          <>
                            <label>
                              Coupon heading
                              <input
                                value={
                                  content.couponLabel ??
                                  (visualLayout === "cart-recovery"
                                    ? defaultGeneratedEmailCopy.cartCouponLabel
                                    : content.offerAboveBody
                                      ? defaultGeneratedEmailCopy.welcomeCouponLabelAbove
                                      : defaultGeneratedEmailCopy.welcomeCouponLabel)
                                }
                                onChange={(event) =>
                                  changeContent("couponLabel", event.target.value)
                                }
                              />
                            </label>
                            <label>
                              Coupon terms
                              <textarea
                                rows={3}
                                value={
                                  content.couponTerms ??
                                  (visualLayout === "cart-recovery"
                                    ? defaultGeneratedEmailCopy.cartCouponTerms
                                    : defaultGeneratedEmailCopy.welcomeCouponTerms)
                                }
                                onChange={(event) =>
                                  changeContent("couponTerms", event.target.value)
                                }
                              />
                            </label>
                            <label>
                              Expiration sentence
                              <input
                                value={
                                  content.couponExpiryText ??
                                  defaultGeneratedEmailCopy.couponExpiry
                                }
                                onChange={(event) =>
                                  changeContent(
                                    "couponExpiryText",
                                    event.target.value,
                                  )
                                }
                              />
                              <small>
                                Use {"{{ coupon_expires }}"} for the customer&apos;s
                                expiration date.
                              </small>
                            </label>
                            <label>
                              Expiration fallback
                              <input
                                value={
                                  content.couponExpiryFallbackText ??
                                  defaultGeneratedEmailCopy.couponExpiryFallback
                                }
                                onChange={(event) =>
                                  changeContent(
                                    "couponExpiryFallbackText",
                                    event.target.value,
                                  )
                                }
                              />
                              <small>
                                Used only in previews when no expiration date has
                                been assigned yet.
                              </small>
                            </label>
                          </>
                        )}
                        {visualLayout === "welcome" && (
                          <>
                            <label>
                              Welcome banner greeting
                              <input
                                value={
                                  content.welcomeHeroGreeting ??
                                  defaultGeneratedEmailCopy.welcomeHeroGreeting
                                }
                                onChange={(event) =>
                                  changeContent(
                                    "welcomeHeroGreeting",
                                    event.target.value,
                                  )
                                }
                              />
                            </label>
                            <label>
                              Welcome banner message
                              <textarea
                                rows={3}
                                value={
                                  content.welcomeHeroText ??
                                  (content.offerAboveBody
                                    ? defaultGeneratedEmailCopy.welcomeHeroAbove
                                    : defaultGeneratedEmailCopy.welcomeHeroBelow)
                                }
                                onChange={(event) =>
                                  changeContent(
                                    "welcomeHeroText",
                                    event.target.value,
                                  )
                                }
                              />
                            </label>
                          </>
                        )}
                        {visualLayout === "welcome-social" && (
                          <>
                            <label>
                              Social-card introduction
                              <input
                                value={
                                  content.socialFollowText ??
                                  defaultGeneratedEmailCopy.socialFollow
                                }
                                onChange={(event) =>
                                  changeContent("socialFollowText", event.target.value)
                                }
                              />
                            </label>
                            {(
                              [
                                ["Instagram", "instagramHeading", "instagramHandle", "instagramText"],
                                ["Facebook", "facebookHeading", "facebookHandle", "facebookText"],
                              ] as const
                            ).map(([name, heading, handle, text]) => (
                              <fieldset key={name}>
                                <legend>{name} card</legend>
                                <label>
                                  Heading
                                  <input
                                    value={
                                      content[heading] ??
                                      defaultGeneratedEmailCopy[heading]
                                    }
                                    onChange={(event) =>
                                      changeContent(heading, event.target.value)
                                    }
                                  />
                                </label>
                                <label>
                                  Handle
                                  <input
                                    value={
                                      content[handle] ??
                                      defaultGeneratedEmailCopy[handle]
                                    }
                                    onChange={(event) =>
                                      changeContent(handle, event.target.value)
                                    }
                                  />
                                </label>
                                <label>
                                  Message
                                  <textarea
                                    rows={3}
                                    value={
                                      content[text] ??
                                      defaultGeneratedEmailCopy[text]
                                    }
                                    onChange={(event) =>
                                      changeContent(text, event.target.value)
                                    }
                                  />
                                </label>
                              </fieldset>
                            ))}
                          </>
                        )}
                      </div>
                    </details>
                  )}
                  {content.template !== "b2b-wholesale" &&
                    !content.template?.startsWith("welcome") && (
                      <label>
                        Hero image URL
                        <input
                          type="url"
                          value={content.hero || ""}
                          onChange={(e) =>
                            changeContent("hero", e.target.value || undefined)
                          }
                        />
                      </label>
                    )}
                  <section className="mk-editor-section">
                    <h3>Call to action</h3>
                    <p>The button at the end of your message.</p>
                    <label>
                      Button text
                      <input
                        value={content.button}
                        onChange={(e) =>
                          changeContent("button", e.target.value)
                        }
                      />
                    </label>
                    <label>
                      {recoveryLink
                        ? "Customer checkout link"
                        : "Button destination"}
                      {recoveryLink && (
                        <small>
                          Filled automatically for each customer. This example
                          link is only used in previews and test emails.
                        </small>
                      )}
                      <input
                        readOnly={recoveryLink}
                        type="url"
                        value={content.url}
                        placeholder="https://"
                        onChange={(e) => changeContent("url", e.target.value)}
                      />
                    </label>
                  </section>
                  {editProducts && (
                    <section className="mk-editor-section">
                      {" "}
                      <h3>Product cards</h3>
                      {(content.products || []).map((p, i) => (
                        <fieldset key={i}>
                          <legend>Product {i + 1}</legend>
                          {(["title", "url", "image", "price"] as const).map(
                            (key) => (
                              <label key={key}>
                                {key}
                                <input
                                  value={p[key] || ""}
                                  onChange={(e) =>
                                    changeContent(
                                      "products",
                                      content.products!.map((v, n) =>
                                        n === i
                                          ? { ...v, [key]: e.target.value }
                                          : v,
                                      ),
                                    )
                                  }
                                />
                              </label>
                            ),
                          )}
                          <button
                            onClick={() =>
                              changeContent(
                                "products",
                                content.products!.filter((_, n) => n !== i),
                              )
                            }
                          >
                            Remove product
                          </button>
                        </fieldset>
                      ))}
                      <button
                        onClick={() =>
                          changeContent("products", [
                            ...(content.products || []),
                            {
                              title: "",
                              url: "https://coralsanonymous.com",
                              price: "",
                            },
                          ])
                        }
                      >
                        Add product
                      </button>
                    </section>
                  )}
                </>
              )))}
            {panel === "layout" && (
              <>
                <details className="mk-editor-section mk-editor-disclosure">
                  <summary><span>Email layout</span><small>{emailLayoutNames[visualLayout]}</small></summary>
                  <div className="mk-editor-disclosure-body">
                  <p>
                    Change the appearance without changing this email&apos;s trigger,
                    timing, audience, coupon, or dynamic customer data.
                  </p>
                  <label>
                    Visual preset
                    <select
                      aria-label="Visual preset"
                      value={visualLayout}
                      onChange={(event) => {
                        const layout = event.target.value as EmailLayout;
                        changeContent("layout", layout);
                        if (layout === "campaign-sale" && !content.campaignLayout) {
                          const campaignLayout = structuredClone(
                            defaultCampaignContent.campaignLayout!,
                          );
                          if (content.template !== "campaign-sale")
                            campaignLayout.sections = [];
                          changeContent("campaignLayout", campaignLayout);
                        }
                      }}
                    >
                      <option value="standard">Standard</option>
                      <option value="b2b-wholesale">B2B wholesale</option>
                      <option value="cart-recovery">Cart recovery</option>
                      <option value="welcome">Welcome offer</option>
                      <option value="welcome-social">Welcome social</option>
                      <option value="campaign-sale">Campaign sale</option>
                    </select>
                  </label>
                  {content.layout && (
                    <button type="button" onClick={() => changeContent("layout", undefined)}>
                      Restore this email&apos;s original layout
                    </button>
                  )}
                  </div>
                </details>
                {visualLayout === "campaign-sale" && content.campaignLayout && (
                  <CampaignEmailFields
                    content={content}
                    subject={subject}
                    onSubject={onSubject}
                    onChange={changeContent}
                    showInbox={false}
                  />
                )}
              </>
            )}
            {panel === "artwork" && (
              <>
                <div className="mk-editor-section">
                  <h3>Brand artwork</h3>
                  <p>
                    Upload once, then adjust the size. Images scale to fit on
                    mobile.
                  </p>
                </div>
                <Artwork
                  label="Hero"
                  value={content.hero}
                  scale={1}
                  onChange={(value) => changeContent("hero", value)}
                />
                <Artwork
                  label="Logo"
                  value={content.logo}
                  scale={
                    content.logoScale ??
                    (content.logoWidth ? content.logoWidth / 260 : 1)
                  }
                  onChange={(value) => changeContent("logo", value)}
                  onScale={(value) => changeContent("logoScale", value)}
                />
                <Artwork
                  label="Footer"
                  value={content.footerImage}
                  scale={
                    content.footerScale ??
                    (content.footerWidth ? content.footerWidth / 560 : 1)
                  }
                  onChange={(value) => changeContent("footerImage", value)}
                  onScale={(value) => changeContent("footerScale", value)}
                />
              </>
            )}
            {panel === "footer" && (
              <section className="mk-editor-section">
                <h3>Footer content</h3>
                <p>
                  Add a closing message, contact details, or a note for your
                  customers.
                </p>
                <label>
                  Footer background color
                  <input
                    aria-label="Footer background color"
                    type="color"
                    value={footerBackgroundColor(content)}
                    onChange={(event) =>
                      changeContent(
                        "footerBackgroundColor",
                        event.target.value,
                      )
                    }
                  />
                </label>
                <button
                  type="button"
                  disabled={content.footerBackgroundColor === undefined}
                  onClick={() =>
                    changeContent("footerBackgroundColor", undefined)
                  }
                >
                  Use this layout&apos;s default footer color
                </button>
                <label>
                  Footer heading
                  <input
                    maxLength={200}
                    value={footerTitle(content)}
                    onChange={(e) =>
                      changeContent("footerTitle", e.target.value)
                    }
                  />
                </label>
                <label>
                  Footer message
                  <textarea
                    aria-label="Footer message"
                    rows={5}
                    maxLength={2000}
                    value={content.footerText ?? ""}
                    onChange={(e) =>
                      changeContent("footerText", e.target.value)
                    }
                  />
                </label>
                <label
                  style={{ display: "flex", alignItems: "center", gap: 8 }}
                >
                  <input
                    style={{ width: "auto", margin: 0 }}
                    type="checkbox"
                    checked={content.showFooterCopyright !== false}
                    onChange={(e) =>
                      changeContent("showFooterCopyright", e.target.checked)
                    }
                  />{" "}
                  Show copyright line
                </label>
                <label>
                  Copyright line
                  <input
                    aria-label="Copyright line"
                    maxLength={300}
                    disabled={content.showFooterCopyright === false}
                    value={
                      content.footerCopyrightText ?? defaultFooterCopyright
                    }
                    onChange={(e) =>
                      changeContent("footerCopyrightText", e.target.value)
                    }
                  />
                  <small>
                    Use {"{{ year }}"} for the current year and{" "}
                    {"{{ organization }}"} for the sender name from Settings.
                  </small>
                </label>
                <label
                  style={{ display: "flex", alignItems: "center", gap: 8 }}
                >
                  <input
                    style={{ width: "auto", margin: 0 }}
                    type="checkbox"
                    checked={content.showFooterSocial !== false}
                    onChange={(event) =>
                      changeContent("showFooterSocial", event.target.checked)
                    }
                  />{" "}
                  Show social media in footer
                </label>
                {content.showFooterSocial !== false && (
                  <>
                    <label>
                      Social heading
                      <input
                        aria-label="Social heading"
                        maxLength={100}
                        value={
                          content.footerSocialHeading ??
                          (visualLayout === "campaign-sale"
                            ? ""
                            : defaultGeneratedEmailCopy.footerSocialHeading)
                        }
                        onChange={(event) =>
                          changeContent(
                            "footerSocialHeading",
                            event.target.value,
                          )
                        }
                      />
                      <small>
                        Appears above footer social icons. Leave blank to hide
                        it.
                      </small>
                    </label>
                  </>
                )}
                <label>
                  Unsubscribe introduction
                  <textarea
                    aria-label="Unsubscribe introduction"
                    rows={3}
                    maxLength={300}
                    value={
                      content.footerUnsubscribeText ??
                      defaultGeneratedEmailCopy.unsubscribeIntro
                    }
                    onChange={(e) =>
                      changeContent("footerUnsubscribeText", e.target.value)
                    }
                  />
                </label>
                <label>
                  Unsubscribe link text
                  <input
                    maxLength={100}
                    value={
                      content.footerUnsubscribeLinkText ??
                      defaultGeneratedEmailCopy.unsubscribeLink
                    }
                    onChange={(event) =>
                      changeContent(
                        "footerUnsubscribeLinkText",
                        event.target.value,
                      )
                    }
                  />
                </label>
                {content.showFooterSocial !== false && (
                  <>
                    <label>
                      Instagram link
                      <input
                        type="url"
                        placeholder="https://instagram.com/your-account"
                        value={
                          content.instagramUrl ??
                          (visualLayout === "welcome-social"
                            ? defaultGeneratedEmailCopy.instagramUrl
                            : "")
                        }
                        onChange={(e) =>
                          changeContent(
                            "instagramUrl",
                            e.target.value || undefined,
                          )
                        }
                      />
                    </label>
                    <Artwork
                      label="Instagram icon"
                      value={content.instagramIcon}
                      scale={1}
                      maxFileBytes={500_000}
                      onChange={(value) =>
                        changeContent("instagramIcon", value)
                      }
                    />
                    <label>
                      Facebook link
                      <input
                        type="url"
                        placeholder="https://facebook.com/your-page"
                        value={
                          content.facebookUrl ??
                          (visualLayout === "welcome-social"
                            ? defaultGeneratedEmailCopy.facebookUrl
                            : "")
                        }
                        onChange={(e) =>
                          changeContent(
                            "facebookUrl",
                            e.target.value || undefined,
                          )
                        }
                      />
                    </label>
                    <Artwork
                      label="Facebook icon"
                      value={content.facebookIcon}
                      scale={1}
                      maxFileBytes={500_000}
                      onChange={(value) =>
                        changeContent("facebookIcon", value)
                      }
                    />
                    <small>
                      Square icons work best. Custom icons appear at 32 pixels
                      in the email footer; the built-in symbols remain when no
                      icon is uploaded.
                    </small>
                  </>
                )}
                <small>
                  The logo, footer artwork, social links, and social icons saved
                  here become shared defaults for future emails. The
                  Unsubscribe link stays in every email.
                </small>
                <h3 style={{ marginTop: 24 }}>Sender details</h3>
                <label
                  style={{ display: "flex", alignItems: "center", gap: 8 }}
                >
                  <input
                    style={{ width: "auto", margin: 0 }}
                    type="checkbox"
                    checked={content.showPostalAddress === true}
                    onChange={(e) =>
                      changeContent("showPostalAddress", e.target.checked)
                    }
                  />{" "}
                  Show business address in this email
                </label>
                {!content.showPostalAddress && (
                  <small>
                    Turn this on before sending customer marketing emails. A
                    valid postal address is required.
                  </small>
                )}
                <p>
                  {organizationName}
                  <br />
                  {postalAddress ||
                    "Add your mailing address in Settings before sending."}
                </p>
                <a
                  href="/our-klaviyo/settings"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Edit sender details in Settings ↗
                </a>
              </section>
            )}
            {panel === "test" && (
              <section className="mk-editor-section">
                <h3>Check your inbox</h3>
                <p>
                  Send the current draft to an internal email address to check
                  it in your email app.
                </p>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!onTest) return;
                    setWork("test");
                    setNotice("");
                    try {
                      const result = await onTest(recipient, subject, content);
                      setNotice(
                        result
                          ? "Test email sent. Check your inbox."
                          : "Test could not be sent. Check your allowlist and sender settings.",
                      );
                    } catch {
                      setNotice(
                        "Test could not be sent. Check your allowlist and sender settings.",
                      );
                    } finally {
                      setWork(null);
                    }
                  }}
                >
                  <label>
                    Internal test recipient
                    <input
                      type="email"
                      required
                      value={recipient}
                      placeholder="you@company.com"
                      onChange={(e) => setRecipient(e.target.value)}
                    />
                  </label>
                  <button
                    type="submit"
                    className="mk-primary"
                    disabled={
                      !onTest || !recipient || busy || working || !!previewError
                    }
                  >
                    {work === "test" ? "Sending…" : "Send test email"}
                  </button>
                </form>
                <small>
                  Use an address in your test recipient allowlist. Sending a
                  test does not enable the flow. Preview sends do not test the
                  Shopify trigger or unsubscribe; those need a workflow email.
                </small>
              </section>
            )}
          </div>
          <footer className="mk-designer-draft">
            <span className="mk-draft-dot" />{" "}
            <span>{status.replaceAll("Save flow", "Save email")}</span>
          </footer>
        </aside>}
        <section className="mk-designer-canvas" aria-label="Live email preview">
          <div className="mk-preview-toolbar">
            <div
              className="mk-device-switch"
              role="group"
              aria-label="Preview device"
            >
              <button
                type="button"
                aria-pressed={!mobile}
                onClick={() => setMobile(false)}
              >
                Desktop
              </button>
              <button
                type="button"
                aria-pressed={mobile}
                onClick={() => setMobile(true)}
              >
                Mobile
              </button>
            </div>
            {mobile ? (
              <label className="mk-device-size">
                Width
                <select
                  aria-label="Mobile preview width"
                  value={mobileWidth}
                  onChange={(e) => setMobileWidth(Number(e.target.value))}
                >
                  <option value={320}>320 px · small</option>
                  <option value={375}>375 px · standard</option>
                  <option value={414}>414 px · large</option>
                </select>
              </label>
            ) : (
              <span>Desktop · up to 640 px</span>
            )}
          </div>
          {notice && (
            <p className="mk-designer-notice" role="status">
              {notice}
            </p>
          )}
          {previewError && (
            <p className="mk-editor-error mk-designer-notice" role="alert">
              {previewError}
            </p>
          )}
          <div className="mk-preview-scroll">
            <div
              className="mk-preview-envelope"
              style={{ width: mobile ? mobileWidth : 640 }}
            >
              <div className="mk-preview-inbox">
                <span>Subject</span>
                <strong>
                  {previewSubject ?? (subject || "No subject yet")}
                </strong>
                {content.preview && <p>{content.preview}</p>}
              </div>
              {html ? (
                <EmailPreview
                  html={html}
                  mobile={mobile}
                  mobileWidth={mobileWidth}
                />
              ) : (
                <div className="mk-preview-empty">
                  Fix the highlighted field to restore your preview.
                </div>
              )}
            </div>
            <p className="mk-preview-caption">
              {previewCaption ||
                "Responsive preview · Send a test to check your email app."}
            </p>
          </div>
        </section>
      </div>
    </dialog>
  );
}
