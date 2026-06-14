import { useEffect, useRef } from "react";

/**
 * Auto-scrolls the element with data-span-id matching selectedSpanId into view.
 * Attach the returned ref to the scrollable container.
 *
 * Usage:
 *   <div ref={scrollContainerRef}>
 *     {spans.map(span => (
 *       <div data-span-id={span.id} key={span.id}>...</div>
 *     ))}
 *   </div>
 */
export function useSpanAutoScroll(selectedSpanId: string | null) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedSpanId || !containerRef.current) return;

    const target = containerRef.current.querySelector(
      `[data-span-id="${selectedSpanId}"]`,
    );
    if (target) {
      target.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedSpanId]);

  return containerRef;
}
