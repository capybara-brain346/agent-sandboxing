import { useState } from "react";
import { Collapsible } from "radix-ui";
import { ChevronRight, FileDiff } from "lucide-react";
import { cn } from "@/lib/utils";

type DiffLineKind = "add" | "remove" | "context";

type DiffLine = {
  kind: DiffLineKind;
  content: string;
  oldLine: number | null;
  newLine: number | null;
};

type DiffHunk = {
  header: string;
  lines: DiffLine[];
};

type DiffFile = {
  path: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
};

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

const filePathFromHeader = (block: string[]): string => {
  const plusLine = block.find((line) => line.startsWith("+++ "));
  if (plusLine) {
    const path = plusLine.slice(4).replace(/^b\//, "").trim();
    if (path !== "/dev/null") return path;
  }
  const diffLine = block.find((line) => line.startsWith("diff --git "));
  const match = diffLine ? /^diff --git a\/(.+) b\/.+$/.exec(diffLine) : null;
  return match ? match[1] : "unknown file";
};

const parseDiff = (diff: string): DiffFile[] => {
  const lines = diff.split("\n");
  const fileBlocks: string[][] = [];
  for (const line of lines) {
    if (line.startsWith("diff --git ")) fileBlocks.push([]);
    if (fileBlocks.length === 0) continue;
    fileBlocks.at(-1)!.push(line);
  }

  return fileBlocks.map((block) => {
    const path = filePathFromHeader(block);
    const hunks: DiffHunk[] = [];
    let additions = 0;
    let deletions = 0;
    let oldLine = 0;
    let newLine = 0;

    for (const line of block) {
      const hunkMatch = HUNK_HEADER_RE.exec(line);
      if (hunkMatch) {
        oldLine = Number(hunkMatch[1]);
        newLine = Number(hunkMatch[2]);
        hunks.push({ header: line, lines: [] });
        continue;
      }
      const currentHunk = hunks.at(-1);
      if (!currentHunk) continue;

      if (line.startsWith("+") && !line.startsWith("+++")) {
        currentHunk.lines.push({
          kind: "add",
          content: line.slice(1),
          oldLine: null,
          newLine,
        });
        newLine += 1;
        additions += 1;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        currentHunk.lines.push({
          kind: "remove",
          content: line.slice(1),
          oldLine,
          newLine: null,
        });
        oldLine += 1;
        deletions += 1;
      } else if (!line.startsWith("\\")) {
        currentHunk.lines.push({
          kind: "context",
          content: line.startsWith(" ") ? line.slice(1) : line,
          oldLine,
          newLine,
        });
        oldLine += 1;
        newLine += 1;
      }
    }

    return { path, hunks, additions, deletions };
  });
};

const LINE_BG: Record<DiffLineKind, string> = {
  add: "bg-diff-add-bg",
  remove: "bg-diff-remove-bg",
  context: "",
};

const LINE_FG: Record<DiffLineKind, string> = {
  add: "text-diff-add",
  remove: "text-diff-remove",
  context: "text-fg",
};

const LINE_PREFIX: Record<DiffLineKind, string> = {
  add: "+",
  remove: "-",
  context: " ",
};

const DiffFileSection = ({ file }: { file: DiffFile }) => {
  const [open, setOpen] = useState(true);

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <Collapsible.Trigger className="sticky top-0 z-10 flex w-full items-center gap-2 border-b border-border-subtle bg-panel px-3 py-2 text-left">
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-fg-subtle transition-transform",
            open && "rotate-90",
          )}
        />
        <FileDiff className="size-3.5 shrink-0 text-fg-subtle" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg">
          {file.path}
        </span>
        <span className="shrink-0 font-mono text-2xs tabular-nums">
          <span className="text-diff-add">+{file.additions}</span>{" "}
          <span className="text-diff-remove">-{file.deletions}</span>
        </span>
      </Collapsible.Trigger>
      <Collapsible.Content>
        {file.hunks.map((hunk, hunkIndex) => (
          <div key={hunkIndex} className="font-mono text-xs">
            <div className="bg-panel/60 px-3 py-1 text-diff-hunk">
              {hunk.header}
            </div>
            {hunk.lines.map((line, lineIndex) => (
              <div key={lineIndex} className={cn("flex", LINE_BG[line.kind])}>
                <span className="w-10 shrink-0 select-none px-1 text-right text-fg-subtle tabular-nums">
                  {line.oldLine ?? ""}
                </span>
                <span className="w-10 shrink-0 select-none px-1 text-right text-fg-subtle tabular-nums">
                  {line.newLine ?? ""}
                </span>
                <span
                  className={cn(
                    "flex-1 min-w-0 py-px pr-3 whitespace-pre",
                    LINE_FG[line.kind],
                  )}
                >
                  {LINE_PREFIX[line.kind]}
                  {line.content}
                </span>
              </div>
            ))}
          </div>
        ))}
      </Collapsible.Content>
    </Collapsible.Root>
  );
};

export const DiffTable = ({ diff }: { diff: string }) => {
  if (diff.trim() === "") {
    return (
      <p className="px-3 py-6 text-center text-xs text-fg-subtle">
        No changes.
      </p>
    );
  }

  const files = parseDiff(diff);

  return (
    <div className="flex flex-col divide-y divide-border-subtle overflow-x-auto">
      {files.map((file) => (
        <DiffFileSection key={file.path} file={file} />
      ))}
    </div>
  );
};
