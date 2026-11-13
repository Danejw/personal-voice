/** All bounds are physical virtual-desktop pixels, including negative origins and gaps. */
export interface MonitorRect {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

export function viewSection(monitors: readonly MonitorRect[], index: number) {
  if (!monitors.length || monitors.some(m =>
    ![m.x, m.y, m.width, m.height, m.scale].every(Number.isFinite)
    || m.width <= 0 || m.height <= 0 || m.scale <= 0)) {
    throw new Error("Invalid physical monitor layout");
  }
  const monitor = monitors[index];
  if (!monitor) throw new Error("Monitor is missing");
  const left = Math.min(...monitors.map(m => m.x));
  const top = Math.min(...monitors.map(m => m.y));
  return {
    fullWidth: Math.max(...monitors.map(m => m.x + m.width)) - left,
    fullHeight: Math.max(...monitors.map(m => m.y + m.height)) - top,
    x: monitor.x - left,
    y: monitor.y - top,
    width: monitor.width,
    height: monitor.height,
  };
}
