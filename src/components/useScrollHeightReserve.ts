import { useEffect, useRef, useState } from "react";

export function useScrollHeightReserve<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [minimumHeight, setMinimumHeight] = useState(0);

  const preserveHeight = () => {
    if (!ref.current || window.scrollY < 80) return;
    const bounds = ref.current.getBoundingClientRect();
    setMinimumHeight(Math.ceil(Math.max(bounds.height, window.innerHeight - bounds.top + 2)));
  };

  useEffect(() => {
    if (!minimumHeight) return;
    const releaseAtTop = () => {
      if (window.scrollY < 80) setMinimumHeight(0);
    };
    window.addEventListener("scroll", releaseAtTop, { passive: true });
    return () => window.removeEventListener("scroll", releaseAtTop);
  }, [minimumHeight]);

  return { ref, minimumHeight, preserveHeight };
}
