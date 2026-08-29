import { cn } from "@/lib/utils";

/** Renders text with a trailing caret while a message is still streaming in. */
export const StreamingText = ({
  text,
  streaming = false,
  className,
}: {
  text: string;
  streaming?: boolean;
  className?: string;
}) => (
  <p
    className={cn(
      "m-0 text-sm whitespace-pre-wrap break-words text-fg",
      className,
    )}
  >
    {text}
    {streaming && (
      <span
        aria-hidden
        className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse rounded-[1px] bg-fg-subtle"
      />
    )}
  </p>
);
