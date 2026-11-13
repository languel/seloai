import { useCallback, useEffect, useRef, useState } from 'react';

interface AutoScrollOptions {
  /** Threshold in px from the bottom to keep auto-follow active. Default 40px. */
  bottomThresholdPx?: number;
  /** Reset auto-follow back to pinned when switching views/threads. */
  resetKey?: string | number;
}

/**
 * Keeps chronological feeds anchored to the latest entry at the bottom
 * unless the user scrolls upward to inspect earlier lines.
 */
export function useAutoScrollToBottom(
  contentTrigger: unknown,
  options: AutoScrollOptions = {},
) {
  const { bottomThresholdPx = 40, resetKey } = options;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const autoFollowRef = useRef(true);
  const [isFollowing, setIsFollowing] = useState(true);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom <= bottomThresholdPx;
    if (autoFollowRef.current !== nearBottom) {
      autoFollowRef.current = nearBottom;
      setIsFollowing(nearBottom);
    }
  }, [bottomThresholdPx]);

  const jumpToBottom = useCallback(() => {
    autoFollowRef.current = true;
    setIsFollowing(true);
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  useEffect(() => {
    autoFollowRef.current = true;
    setIsFollowing(true);
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [resetKey]);

  useEffect(() => {
    if (!autoFollowRef.current) return;
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [contentTrigger]);

  return {
    containerRef,
    isFollowing,
    handleScroll,
    jumpToBottom,
  };
}
