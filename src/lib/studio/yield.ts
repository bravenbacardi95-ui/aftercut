let hot = false;
let hearing = false;

export function setTransportHot(on: boolean) {
  hot = on;
}

export function setHearing(on: boolean) {
  hearing = on;
}

export function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      window.setTimeout(resolve, 0);
    });
  });
}

export function armLoop(tick: (now: number) => void) {
  let alive = true;
  let raf = 0;
  let timer = 0;
  const step = (now?: number) => {
    if (!alive) return;
    tick(typeof now === "number" ? now : performance.now());
    if (hot && !hearing) raf = requestAnimationFrame(step);
    else timer = window.setTimeout(step, 320);
  };
  raf = requestAnimationFrame(step);
  return () => {
    alive = false;
    cancelAnimationFrame(raf);
    window.clearTimeout(timer);
  };
}
