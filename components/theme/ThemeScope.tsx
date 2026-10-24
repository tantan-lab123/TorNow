"use client";

import React, { useEffect, useMemo } from "react";
import { themeCssVars } from "@/lib/theme";

/**
 * Wears a business's colour theme (lib/theme.ts) on a public page.
 *
 * The variables are set on a wrapper while the page is rendered on the server, so there is no flash of
 * the default colour. They are also set on the document root while the page is shown, so the dialogs
 * (drawn outside the page) match, and removed again when the page goes away. The wrapper has no box of
 * its own (display: contents): the layout is exactly the same as without it.
 */
export function ThemeScope({ themeId, children }: { themeId?: string | null; children: React.ReactNode }) {
  const vars = useMemo(() => themeCssVars(themeId), [themeId]);

  useEffect(() => {
    const root = document.documentElement;
    for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
    return () => {
      for (const name of Object.keys(vars)) root.style.removeProperty(name);
    };
  }, [vars]);

  return (
    <div className="contents" style={vars as React.CSSProperties}>
      {children}
    </div>
  );
}
