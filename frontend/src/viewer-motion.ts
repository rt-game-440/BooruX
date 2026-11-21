// 看图器打开/收回动效的纯计算：FLIP 位移缩放、object-fit: contain 的可见区域。
export type Box = { left: number; top: number; width: number; height: number };

export const VIEWER_BG = 'rgb(8 9 11 / 0.92)';
export const VIEWER_BG_CLEAR = 'rgb(8 9 11 / 0)';

// 缩略图（object-fit: contain）在盒子里实际显示的图像区域。
export function containedBox(box: Box, naturalWidth: number, naturalHeight: number): Box {
  if (!naturalWidth || !naturalHeight || !box.width || !box.height) return box;
  const scale = Math.min(box.width / naturalWidth, box.height / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  return { left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width, height };
}

export function usableBox(box: Box | null | undefined): box is Box {
  return Boolean(box && box.width > 0 && box.height > 0);
}

// 是否与视口相交；不相交时收回动画退化为淡出。
export function boxInViewport(box: Box, viewportWidth: number, viewportHeight: number): boolean {
  return box.left + box.width > 0 && box.top + box.height > 0 && box.left < viewportWidth && box.top < viewportHeight;
}

// 让位于 `to` 的元素视觉上落在 `from`：以元素中心为变换原点。
export function flipTransform(from: Box, to: Box): string {
  const scale = from.width / to.width;
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  return `translate(${dx}px, ${dy}px) scale(${scale})`;
}
