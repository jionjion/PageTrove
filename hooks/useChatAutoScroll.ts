import { useCallback, useEffect, useRef } from 'react';

const BOTTOM_THRESHOLD = 64;

/**
 * Keeps streaming replies pinned only while the reader is already near the end.
 * Once the reader scrolls upward, new content no longer steals their position.
 */
export function useChatAutoScroll() {
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number>();
  const followingRef = useRef(true);

  const cancelScheduledScroll = useCallback(() => {
    if (frameRef.current === undefined) return;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = undefined;
  }, []);

  const scrollToLatest = useCallback(
    (behavior: ScrollBehavior, force: boolean) => {
      if (!force && !followingRef.current) return;

      cancelScheduledScroll();
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = undefined;
        if (!force && !followingRef.current) return;

        const container = containerRef.current;
        if (!container) return;
        container.scrollTo({ top: container.scrollHeight, behavior });

        if (force) {
          followingRef.current = true;
        }
      });
    },
    [cancelScheduledScroll],
  );

  const followLatest = useCallback(
    () => scrollToLatest('auto', false),
    [scrollToLatest],
  );

  const resumeLatest = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      followingRef.current = true;
      scrollToLatest(behavior, true);
    },
    [scrollToLatest],
  );

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const distanceToBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const isNearBottom = distanceToBottom <= BOTTOM_THRESHOLD;
    followingRef.current = isNearBottom;
  }, []);

  useEffect(() => cancelScheduledScroll, [cancelScheduledScroll]);

  return {
    containerRef,
    handleScroll,
    followLatest,
    resumeLatest,
  };
}
