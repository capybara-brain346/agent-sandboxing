import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUp, GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";

const MAX_ROWS = 10;

export const PromptBar = ({
  disabled,
  disabledReason,
  contextLabel,
  onSend,
}: {
  disabled: boolean;
  disabledReason: string | null;
  contextLabel?: string | null;
  onSend: (content: string) => void;
}) => {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = Number.parseFloat(
      getComputedStyle(el).lineHeight || "20",
    );
    const maxHeight = lineHeight * MAX_ROWS;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, [value]);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-2 rounded-lg border border-border-default bg-raised p-2"
    >
      {contextLabel && (
        <span className="flex w-fit items-center gap-1.5 rounded-md bg-inset px-2 py-1 font-mono text-2xs text-fg-subtle">
          <GitBranch className="size-3" />
          {contextLabel}
        </span>
      )}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit();
          }
        }}
        placeholder="Describe what you want the agent to do…"
        rows={1}
        disabled={disabled}
        className="max-h-64 min-h-6 resize-none border-none bg-transparent px-1 py-0.5 text-sm text-fg outline-none placeholder:text-fg-subtle disabled:opacity-60"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-2xs text-fg-subtle">
          {disabled && disabledReason ? disabledReason : "⌘+Enter to send"}
        </span>
        <button
          type="submit"
          aria-label="Send message"
          disabled={disabled || value.trim() === ""}
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md bg-brand text-fg-on-brand transition-opacity",
            "disabled:cursor-not-allowed disabled:opacity-40",
          )}
        >
          <ArrowUp className="size-3.5" />
        </button>
      </div>
    </form>
  );
};
