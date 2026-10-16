"use client";

import {
  EXAMPLE_PROMPT,
  MAX_PROMPT_LENGTH,
  STYLE_PRESETS,
  type AspectRatio,
} from "@/lib/brand";
import { DESIGNS, type DesignId } from "@/lib/mapRender";
import { PRODUCTS, formatPrice, getProduct, getSize } from "@/lib/products";

const ASPECTS: { value: AspectRatio; label: string }[] = [
  { value: "square", label: "Square" },
  { value: "landscape", label: "Landscape" },
  { value: "portrait", label: "Portrait" },
];

export interface PromptValues {
  design: DesignId;
  place: string;
  /** Second place, for Spanning the Distance. */
  place2: string;
  /** Names or a short line for the title; optional. */
  title: string;
  /** Photo for Coordinates of Commitment, kept in the browser only. */
  photoUrl: string | null;
  productId: string;
  sizeId: string;
  /** Frame colour or base finish, for products that offer one. */
  finishId: string;
  landscape: boolean;
  prompt: string;
  aspect: AspectRatio;
}

interface PromptInputProps {
  values: PromptValues;
  onChange: (patch: Partial<PromptValues>) => void;
  onSubmit: () => void;
  loading: boolean;
}

const label = "text-xs font-bold uppercase tracking-widest text-ink/60";
const field =
  "w-full rounded-xl border border-tobacco/25 bg-parchment/50 px-4 py-3 text-base text-ink placeholder:text-ink/40 focus:border-terracotta focus:outline-none focus:ring-2 focus:ring-terracotta/25";

export function Segmented<T extends string>({
  name,
  options,
  value,
  onChange,
}: {
  name: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={name}
      className="inline-flex flex-wrap rounded-xl border border-tobacco/25 bg-parchment p-1"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`rounded-lg px-3 py-1.5 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta/40 ${
              selected ? "bg-ink text-offwhite" : "text-ink/70 hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export default function PromptInput({
  values,
  onChange,
  onSubmit,
  loading,
}: PromptInputProps) {
  const product = getProduct(values.productId) ?? PRODUCTS[0];
  const size = getSize(product, values.sizeId);
  const needsScene = product.physical;
  const design = DESIGNS.find((item) => item.id === values.design) ?? DESIGNS[0];
  const canSubmit =
    !loading &&
    values.place.trim().length > 0 &&
    (design.id !== "spanning" || values.place2.trim().length > 0) &&
    (!needsScene || values.prompt.trim().length > 0);

  function appendPreset(text: string) {
    const current = values.prompt.trim();
    if (current.toLowerCase().includes(text.toLowerCase())) return;
    const next = current ? `${current.replace(/[,.]$/, "")}, ${text}` : text;
    onChange({ prompt: next.slice(0, MAX_PROMPT_LENGTH) });
  }

  return (
    <form
      className="rounded-xl border border-tobacco/20 bg-offwhite p-5 shadow-soft sm:p-7"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onSubmit();
      }}
    >
      <h2 className="font-serif text-xl font-bold text-ink">
        Create your moment
      </h2>
      <p className="mt-1 text-sm text-ink/70">
        Pick the place and the product. The map is the real one, drawn from
        live map data.
      </p>

      <div className="mt-5">
        <label htmlFor="design" className={label}>
          Design
        </label>
        <select
          id="design"
          value={design.id}
          onChange={(event) => onChange({ design: event.target.value as DesignId })}
          className={`mt-2 ${field} pr-8`}
        >
          {DESIGNS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-sm text-ink/70">{design.description}</p>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className={design.id === "spanning" ? "" : "sm:col-span-2"}>
          <label htmlFor="place" className={label}>
            {design.id === "spanning" ? "First place" : "Place"}
          </label>
          <input
            id="place"
            type="text"
            value={values.place}
            maxLength={200}
            onChange={(event) => onChange({ place: event.target.value })}
            placeholder="Paris, France"
            className={`mt-2 ${field}`}
          />
        </div>
        {design.id === "spanning" && (
          <div>
            <label htmlFor="place2" className={label}>
              Second place
            </label>
            <input
              id="place2"
              type="text"
              value={values.place2}
              maxLength={200}
              onChange={(event) => onChange({ place2: event.target.value })}
              placeholder="New York, USA"
              className={`mt-2 ${field}`}
            />
          </div>
        )}
      </div>

      {design.id !== "urban" && (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className={design.id === "commitment" ? "" : "sm:col-span-2"}>
            <label htmlFor="title" className={label}>
              Names or title (optional)
            </label>
            <input
              id="title"
              type="text"
              value={values.title}
              maxLength={60}
              onChange={(event) => onChange({ title: event.target.value })}
              placeholder="Abby & Mike"
              className={`mt-2 ${field}`}
            />
          </div>
          {design.id === "commitment" && (
            <div>
              <label htmlFor="photo" className={label}>
                Photo (optional)
              </label>
              <input
                id="photo"
                type="file"
                accept="image/*"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (values.photoUrl) URL.revokeObjectURL(values.photoUrl);
                  onChange({ photoUrl: file ? URL.createObjectURL(file) : null });
                }}
                className="mt-2 block w-full text-sm text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-ink file:px-3 file:py-2 file:text-sm file:text-offwhite"
              />
              <p className="mt-1 text-xs text-ink/60">
                Stays on this device; it is not uploaded.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="mt-5">
        <p className={label}>Product</p>
        <div className="mt-2">
          <Segmented
            name="Product"
            options={PRODUCTS.map((item) => ({ value: item.id, label: item.name }))}
            value={product.id}
            onChange={(productId) => {
              const next = getProduct(productId) ?? PRODUCTS[0];
              onChange({
                productId,
                sizeId: next.sizes[0].id,
                finishId: next.finishes?.[0].id ?? "",
              });
            }}
          />
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="size" className={label}>
            Size
          </label>
          <select
            id="size"
            value={size.id}
            onChange={(event) => onChange({ sizeId: event.target.value })}
            className={`mt-2 ${field} pr-8`}
          >
            {product.sizes.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        {product.finishes && (
          <div>
            <label htmlFor="finish" className={label}>
              {product.id === "framed-print" ? "Frame" : "Finish"}
            </label>
            <select
              id="finish"
              value={values.finishId || product.finishes[0].id}
              onChange={(event) => onChange({ finishId: event.target.value })}
              className={`mt-2 ${field} pr-8`}
            >
              {product.finishes.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <p className={label}>Price</p>
          <p className="mt-2 rounded-xl border border-tobacco/25 bg-parchment px-4 py-3 text-base font-bold text-ink">
            {formatPrice(size.priceUsd)}
          </p>
        </div>
        {product.canRotate && size.width !== size.height && (
          <div>
            <p className={label}>Print</p>
            <div className="mt-2">
              <Segmented
                name="Print orientation"
                options={[
                  { value: "portrait", label: "Portrait" },
                  { value: "landscape", label: "Landscape" },
                ]}
                value={values.landscape ? "landscape" : "portrait"}
                onChange={(value) => onChange({ landscape: value === "landscape" })}
              />
            </div>
          </div>
        )}
      </div>

      {needsScene ? (
        <>
          <div className="mt-5">
            <label htmlFor="prompt" className={label}>
              Scene
            </label>
            <textarea
              id="prompt"
              rows={4}
              value={values.prompt}
              maxLength={MAX_PROMPT_LENGTH}
              onChange={(event) => onChange({ prompt: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  if (canSubmit) onSubmit();
                }
              }}
              placeholder={EXAMPLE_PROMPT}
              className={`mt-2 resize-y leading-relaxed ${field}`}
            />
            <div className="mt-1 flex items-center justify-between text-xs text-ink/60">
              {values.prompt ? (
                <span />
              ) : (
                <button
                  type="button"
                  onClick={() => onChange({ prompt: EXAMPLE_PROMPT })}
                  className="text-terracotta underline-offset-2 hover:underline"
                >
                  Use the example
                </button>
              )}
              <span>
                {values.prompt.length} / {MAX_PROMPT_LENGTH}
              </span>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {STYLE_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => appendPreset(preset.text)}
                className="rounded-full border border-tobacco/30 bg-parchment px-3.5 py-1.5 text-sm text-ink transition hover:border-terracotta hover:text-terracotta focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta/40"
              >
                + {preset.label}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="mt-5 rounded-xl bg-parchment px-4 py-3 text-sm text-ink/70">
          A digital download is the map file itself, so there is no scene to
          photograph. You will see the map artwork straight away.
        </p>
      )}

      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        {needsScene ? (
          <div>
            <p className={label}>Photo shape</p>
            <div className="mt-2">
              <Segmented
                name="Photo shape"
                options={ASPECTS}
                value={values.aspect}
                onChange={(aspect) => onChange({ aspect })}
              />
            </div>
          </div>
        ) : (
          <span />
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-xl bg-terracotta px-6 py-3 text-base font-bold text-white transition hover:bg-terracotta-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta focus-visible:ring-offset-2 focus-visible:ring-offset-offwhite disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Crafting…" : "Generate Brand Image"}
        </button>
      </div>
    </form>
  );
}
