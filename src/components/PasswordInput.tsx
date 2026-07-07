"use client";

import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

type PasswordInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  id?: string;
  name?: string;
  /** Accessible label, when there is no visible <label> wired to this input. */
  ariaLabel?: string;
};

/**
 * A password input with a show/hide eye toggle so people can see what they are
 * typing. Controlled: pass value + onChange. The toggle is type="button" so it
 * never submits the surrounding form, and it stays keyboard reachable.
 */
export default function PasswordInput({
  value,
  onChange,
  placeholder,
  autoComplete = "current-password",
  required,
  id,
  name,
  ariaLabel,
}: PasswordInputProps) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: "relative", width: "100%" }}>
      <input
        id={id}
        name={name}
        type={show ? "text" : "password"}
        autoComplete={autoComplete}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        style={{
          padding: "0.6rem 2.5rem 0.6rem 0.75rem",
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--border-color)",
          backgroundColor: "var(--bg-primary)",
          color: "var(--text-primary)",
          fontFamily: "inherit",
          fontSize: "0.9rem",
          width: "100%",
        }}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        aria-pressed={show}
        title={show ? "Hide password" : "Show password"}
        style={{
          position: "absolute",
          right: "0.5rem",
          top: "50%",
          transform: "translateY(-50%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "none",
          border: "none",
          padding: "0.25rem",
          cursor: "pointer",
          color: "var(--text-secondary)",
        }}
      >
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}
