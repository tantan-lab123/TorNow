"use client";

import React from "react";
import { cn, triggerHaptic } from "@/lib/utils";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "destructive" | "success";
  size?: "sm" | "md" | "lg" | "icon";
  isLoading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      isLoading = false,
      disabled,
      children,
      onClick,
      ...props
    },
    ref
  ) => {
    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      triggerHaptic(15);
      if (onClick) onClick(e);
    };

    // Primary actions are "keys": a hard edge underneath that the button sinks into.
    const baseStyles =
      "inline-flex items-center justify-center font-semibold rounded-lg disabled:opacity-50 disabled:pointer-events-none select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-paper";

    const variantStyles = {
      primary: "m-key bg-brand-600 text-white hover:bg-brand-700",
      secondary: "m-key2 border border-ink-200 bg-white text-ink-900",
      outline: "m-key2 border border-ink-200 bg-white text-ink-900",
      ghost: "m-press text-ink-700 hover:bg-ink-100 active:bg-ink-200",
      destructive: "m-key bg-danger-600 text-white hover:bg-danger-700",
      success: "m-key bg-lime text-lime-ink",
    };

    const sizeStyles = {
      sm: "text-xs px-3 h-11 gap-1.5",
      md: "text-sm px-4 h-11 gap-2",
      lg: "text-base px-6 h-[52px] gap-2.5",
      icon: "h-11 w-11 p-0",
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        onClick={handleClick}
        aria-busy={isLoading || undefined}
        className={cn(
          baseStyles,
          variantStyles[variant],
          sizeStyles[size],
          className
        )}
        {...props}
      >
        {isLoading ? (
          <span
            aria-hidden="true"
            className={cn("m-spin", variant !== "primary" && "m-spin-dark")}
          />
        ) : null}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
