"use client";
import { useEffect, useRef, useState } from "react";

export default function EmailPreview({
  html,
  mobile,
}: {
  html: string;
  mobile: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const [height, setHeight] = useState(760);
  useEffect(() => () => observer.current?.disconnect(), []);
  function measure() {
    observer.current?.disconnect();
    const body = frame.current?.contentDocument?.body;
    if (!body) return;
    const resize = () =>
      setHeight(
        Math.max(200, Math.ceil(body.getBoundingClientRect().height) + 24),
      );
    resize();
    if (typeof ResizeObserver !== "undefined") {
      observer.current = new ResizeObserver(resize);
      observer.current.observe(body);
    }
  }
  return (
    <iframe
      ref={frame}
      title="Email preview"
      sandbox="allow-same-origin"
      onLoad={measure}
      srcDoc={html}
      style={{ width: mobile ? 320 : "100%", maxWidth: "100%", height }}
    />
  );
}
