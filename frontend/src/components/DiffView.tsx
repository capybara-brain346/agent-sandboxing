const classifyLine = (line: string): string => {
  if (line.startsWith("+++") || line.startsWith("---"))
    return "diff__line--file";
  if (line.startsWith("diff --git") || line.startsWith("index "))
    return "diff__line--file";
  if (line.startsWith("@@")) return "diff__line--hunk";
  if (line.startsWith("+")) return "diff__line--add";
  if (line.startsWith("-")) return "diff__line--remove";
  return "";
};

export const DiffView = ({ diff }: { diff: string }) => {
  if (diff.trim() === "") {
    return <p className="diff__empty">No changes.</p>;
  }

  const lines = diff.split("\n");

  return (
    <div className="diff">
      {lines.map((line, index) => (
        <div key={index} className={`diff__line ${classifyLine(line)}`}>
          {line.length > 0 ? line : " "}
        </div>
      ))}
    </div>
  );
};
