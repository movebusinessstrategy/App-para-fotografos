import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn } from "../../utils/cn";
import { normalizeText } from "../../utils/normalizeText";

interface Option {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  showSearchIcon?: boolean;
  highlighted?: boolean;
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Selecionar...",
  className,
  triggerClassName,
  searchPlaceholder = "Pesquisar...",
  emptyMessage = "Nenhuma opção",
  showSearchIcon = false,
  highlighted = false,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);
  const filtered = query.trim()
    ? options.filter((o) => normalizeText(o.label).includes(normalizeText(query)))
    : options;

  // Recalculate dropdown position whenever it opens or window scrolls/resizes
  function recalcPosition() {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const dropHeight = Math.min(filtered.length * 36 + 56, 260); // estimate
    const openUpward = spaceBelow < dropHeight && rect.top > dropHeight;

    setDropdownStyle({
      position: "fixed",
      left: rect.left,
      width: rect.width,
      zIndex: 9999,
      ...(openUpward
        ? { bottom: window.innerHeight - rect.top + 4 }
        : { top: rect.bottom + 4 }),
    });
  }

  useEffect(() => {
    if (open) {
      recalcPosition();
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      // Ignora cliques na scrollbar: o navegador joga target em HTML/BODY,
      // que tecnicamente está "fora" do dropdown mas é só scroll, não fechar.
      const target = e.target as Node;
      if (target === document.documentElement || target === document.body) return;
      if (
        triggerRef.current?.contains(target) ||
        dropdownRef.current?.contains(target)
      )
        return;
      setOpen(false);
      setQuery("");
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Reposition on scroll / resize
  useEffect(() => {
    if (!open) return;
    const handler = () => recalcPosition();
    window.addEventListener("scroll", handler, true);
    window.addEventListener("resize", handler);
    return () => {
      window.removeEventListener("scroll", handler, true);
      window.removeEventListener("resize", handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSelect = (opt: Option) => {
    onChange(opt.value);
    setOpen(false);
    setQuery("");
  };

  const hasValue = !!selected;

  return (
    <div className={cn("relative", className)}>
      {/* Trigger */}
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={selected?.label}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors outline-none",
          highlighted && hasValue
            ? "border-gold-500 bg-gold-50 dark:bg-gold-900/20 text-gold-700 dark:text-gold-300 font-semibold"
            : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600",
          triggerClassName
        )}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {showSearchIcon && (
            <Search size={15} className="flex-shrink-0 text-gray-400 dark:text-gray-500" />
          )}
          <span className="truncate">{selected ? selected.label : placeholder}</span>
        </span>
        <ChevronDown
          size={13}
          className={cn(
            "flex-shrink-0 text-gray-400 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {/* Dropdown - rendered in a portal to escape overflow:hidden containers */}
      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            style={dropdownStyle}
            className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl overflow-hidden"
          >
            {/* Search */}
            <div className="flex items-center gap-2 border-b border-gray-100 dark:border-gray-800 px-3 py-2">
              <Search size={13} className="flex-shrink-0 text-gray-400" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="flex-1 bg-transparent text-sm text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Options */}
            <div className="max-h-52 overflow-y-auto py-1" role="listbox">
              {filtered.length === 0 ? (
                <p className="px-3 py-3 text-center text-xs text-gray-400">
                  {emptyMessage}
                </p>
              ) : (
                filtered.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={opt.value === value}
                    onClick={() => handleSelect(opt)}
                    title={opt.label}
                    className={cn(
                      "flex w-full items-start justify-between gap-2 px-3 py-2 text-sm transition-colors text-left",
                      opt.value === value
                        ? "bg-gold-50 dark:bg-gold-900/30 text-gold-700 dark:text-gold-300 font-semibold"
                        : "text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
                    )}
                  >
                    <span className="flex-1 whitespace-normal break-words leading-snug">{opt.label}</span>
                    {opt.value === value && (
                      <Check
                        size={13}
                        className="flex-shrink-0 mt-0.5 text-gold-600 dark:text-gold-400"
                      />
                    )}
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
