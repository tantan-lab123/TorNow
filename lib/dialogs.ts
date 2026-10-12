// Promise-based replacements for window.confirm / window.alert, drawn by <DialogHost />.
// The browser's own dialogs are blocked or auto-dismissed in embedded browsers and in some
// mobile in-app browsers, which made "cancel appointment" silently do nothing.

export interface DialogRequest {
  kind: "confirm" | "alert";
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  resolve: (value: boolean) => void;
}

type Listener = (request: DialogRequest) => void;

let listener: Listener | null = null;

/** Called by <DialogHost /> on mount; returns the unsubscribe function. */
export function registerDialogHost(next: Listener): () => void {
  listener = next;
  return () => {
    if (listener === next) listener = null;
  };
}

interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

/** Resolves true when the user confirms, false when they cancel or dismiss. */
export function confirmDialog(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  if (!listener) {
    return Promise.resolve(typeof window !== "undefined" ? window.confirm(message) : false);
  }
  return new Promise<boolean>((resolve) => {
    listener!({ kind: "confirm", message, ...options, resolve });
  });
}

/** Shows a message with a single OK button. */
export function alertDialog(message: string, title?: string): Promise<void> {
  if (!listener) {
    if (typeof window !== "undefined") window.alert(message);
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    listener!({ kind: "alert", message, title, resolve: () => resolve() });
  });
}
