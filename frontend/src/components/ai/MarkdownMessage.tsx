import { Children, isValidElement, type ComponentProps } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./CodeBlock";

type MarkdownCodeProps = ComponentProps<"code"> & {
  inline?: boolean;
};

const MarkdownCode = ({
  children,
  className,
  inline = true,
}: MarkdownCodeProps) => {
  const code = String(children).replace(/\n$/, "");
  const language = /language-([\w-]+)/.exec(className ?? "")?.[1];

  if (!inline) return <CodeBlock code={code} language={language} />;

  return (
    <code
      className={cn(
        "rounded bg-inset px-1 py-0.5 font-mono text-[0.9em]",
        className,
      )}
    >
      {children}
    </code>
  );
};

const MarkdownPre = ({ children }: ComponentProps<"pre">) => {
  const child = Children.toArray(children)[0];
  if (isValidElement<MarkdownCodeProps>(child) && child.type === MarkdownCode) {
    return <MarkdownCode {...child.props} inline={false} />;
  }
  return <pre className="overflow-x-auto">{children}</pre>;
};

const markdownComponents: Components = {
  a: ({ children, href }) => {
    const external = /^(?:https?:)?\/\//i.test(href ?? "");
    return (
      <a
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noreferrer" : undefined}
        className="text-brand underline decoration-brand/50 underline-offset-2 hover:text-brand-strong"
      >
        {children}
      </a>
    );
  },
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-brand/50 pl-3 text-fg-muted">
      {children}
    </blockquote>
  ),
  code: MarkdownCode,
  del: ({ children }) => <del className="text-fg-muted">{children}</del>,
  h1: ({ children }) => (
    <h1 className="text-lg font-semibold text-fg">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-base font-semibold text-fg">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold text-fg">{children}</h3>
  ),
  li: ({ children }) => <li className="pl-1">{children}</li>,
  ol: ({ children }) => (
    <ol className="list-decimal space-y-1 pl-5">{children}</ol>
  ),
  p: ({ children }) => <p className="m-0">{children}</p>,
  pre: MarkdownPre,
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-left text-xs">
        {children}
      </table>
    </div>
  ),
  td: ({ children }) => (
    <td className="border border-border-subtle px-2 py-1.5">{children}</td>
  ),
  th: ({ children }) => (
    <th className="border border-border-subtle bg-inset px-2 py-1.5 font-semibold">
      {children}
    </th>
  ),
  ul: ({ children }) => (
    <ul className="list-disc space-y-1 pl-5">{children}</ul>
  ),
};

export const MarkdownMessage = ({
  text,
  streaming = false,
  className,
}: {
  text: string;
  streaming?: boolean;
  className?: string;
}) => (
  <div
    className={cn(
      "flex min-w-0 flex-col gap-3 text-sm break-words text-fg",
      className,
    )}
  >
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      components={markdownComponents}
    >
      {text}
    </ReactMarkdown>
    {streaming && (
      <span
        aria-hidden
        className="-mt-3 ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse rounded-[1px] bg-fg-subtle"
      />
    )}
  </div>
);
