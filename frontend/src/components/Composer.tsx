import { useState, type FormEvent } from "react";

export const Composer = ({
  disabled,
  disabledReason,
  onSend,
}: {
  disabled: boolean;
  disabledReason: string | null;
  onSend: (content: string) => void;
}) => {
  const [value, setValue] = useState("");

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
    <form className="composer" onSubmit={onSubmit}>
      {disabled && disabledReason && (
        <p className="composer__hint">{disabledReason}</p>
      )}
      <div className="composer__row">
        <textarea
          className="composer__input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="Describe what you want the agent to do…"
          rows={3}
          disabled={disabled}
        />
        <button
          type="submit"
          className="button"
          disabled={disabled || value.trim() === ""}
        >
          Send
        </button>
      </div>
    </form>
  );
};
