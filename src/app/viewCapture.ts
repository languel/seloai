/**
 * The current view as a picture, for agents (the `look` tool). The village view registers
 * a capturer while it is shown; anything else gets null.
 */
type Capturer = () => Promise<string | null>;
let capturer: Capturer | null = null;

export function registerViewCapture(fn: Capturer | null): () => void {
  capturer = fn;
  return () => {
    if (capturer === fn) capturer = null;
  };
}

export async function captureView(): Promise<string | null> {
  return capturer ? capturer() : null;
}
