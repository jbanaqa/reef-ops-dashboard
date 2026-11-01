"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { imageSource } from "@/lib/marketing/rules";

export default function Artwork({
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
