import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

export const CodeBlock = ({
  code,
  language,
  maxHeight,
  className,
}: {
  code: string;
  language?: string;
  maxHeight?: number;
  className?: string;
}) => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied; the button simply stays idle.
    }
  };

  return (
    <div
      className={cn(
        "group/code relative overflow-hidden rounded-lg border border-border-subtle bg-inset",
        className,
      )}
    >
      {language && (
        <div className="flex items-center justify-between border-b border-border-subtle px-3 py-1.5 text-2xs text-fg-subtle">
          <span className="font-mono uppercase tracking-wide">{language}</span>
        </div>
      )}
      <button
        type="button"
        onClick={() => void copy()}
        aria-label="Copy code"
        className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-md text-fg-subtle opacity-0 transition-opacity hover:bg-panel hover:text-fg group-hover/code:opacity-100"
      >
        {copied ? (
          <Check className="size-3.5" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </button>
      <pre
        className="overflow-auto px-3 py-2.5 font-mono text-xs whitespace-pre-wrap break-words text-fg"
        style={maxHeight ? { maxHeight } : undefined}
      >
        {code}
      </pre>
    </div>
  );
};
