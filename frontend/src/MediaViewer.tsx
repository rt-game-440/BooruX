import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { originalMediaURL, postSource } from './feed';
import type { Post } from './feed';
import { useHistoryLayer } from './history-layer';
import { Icon } from './icons';
import { dismissAxis, dismissProgress, shouldDismiss } from './media-swipe';
import { boxInViewport, containedBox, flipTransform, usableBox, VIEWER_BG, VIEWER_BG_CLEAR } from './viewer-motion';
import type { Box } from './viewer-motion';

const DURATION = 280;
const EASING = 'cubic-bezier(0.23, 1, 0.32, 1)';
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const toBox = (rect: DOMRect): Box => ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });

// 缩略图元素在视口中真正显示图像的区域（考虑 object-fit: contain 的留白）。
function thumbBox(origin: HTMLElement | null | undefined): Box | null {
  if (!origin) return null;
  const box = toBox(origin.getBoundingClientRect());
  if (origin instanceof HTMLImageElement) return containedBox(box, origin.naturalWidth, origin.naturalHeight);
  return box;
}

// 全屏媒体查看器：原生 <dialog> 提供焦点限制、Esc 与焦点归还；挂到 body 以避开卡片的 content-visibility。
// 打开时压入一条历史记录（带 sessionId 以复用当前页面会话），后退手势只关闭查看器。
// 所有关闭路径（按钮/背景、Esc、系统返回、强制关闭）最终都汇入 finalClose：先播退出动画，再真正卸载。
export default function MediaViewer({ posts, start, onClose, getOrigin }: { posts: Post[]; start: number; onClose: () => void; getOrigin?: (index: number) => HTMLElement | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const pull = useRef<{ id: number; x: number; y: number; lastY: number; lastT: number; velocity: number; axis: 'x' | 'y' | null; img: HTMLImageElement } | null>(null);
  const zoomCenter = useRef<{ x: number; y: number } | null>(null);
  const [index, setIndex] = useState(start);
  const [zoomed, setZoomed] = useState(false);
  const current = posts[index];
  const src = current ? originalMediaURL(current) : '';

  const indexRef = useRef(index);
  indexRef.current = index;
  const getOriginRef = useRef(getOrigin);
  getOriginRef.current = getOrigin;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const animations = useRef<Animation[]>([]);
  const hiddenThumb = useRef<HTMLElement | null>(null);
  const exitPromise = useRef<Promise<void> | null>(null);
  const closed = useRef(false);

  const run = (target: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions = {}) => {
    const animation = target.animate(keyframes, { duration: DURATION, easing: EASING, ...options });
    animations.current.push(animation);
    return animation;
  };
  const chrome = () => Array.from(dialog.current?.querySelectorAll<HTMLElement>('.viewer-toolbar, .viewer-nav') ?? []);
  const restoreThumb = () => { if (hiddenThumb.current) hiddenThumb.current.style.visibility = ''; hiddenThumb.current = null; };

  // 打开：从被点击的缩略图原位放大（FLIP）。找不到可用的起点或开启减弱动态时只淡入。
  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    track.current!.scrollLeft = start * track.current!.clientWidth;
    closeButton.current?.focus();
    let cancelled = false;
    const slide = track.current!.children[start] as HTMLElement | undefined;
    const img = slide?.querySelector('img') ?? null;
    const origin = getOriginRef.current?.(start) ?? null;
    if (typeof element.animate !== 'function') {
      // 无 WAAPI 的环境直接显示。
    } else if (!img || !origin || reducedMotion()) {
      run(element, [{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
    } else {
      run(element, [{ backgroundColor: VIEWER_BG_CLEAR }, { backgroundColor: VIEWER_BG }], { fill: 'backwards' });
      chrome().forEach(item => run(item, [{ opacity: 0 }, { opacity: 1 }], { fill: 'backwards', delay: 80 }));
      img.style.visibility = 'hidden';
      origin.style.visibility = 'hidden';
      hiddenThumb.current = origin;
      void (async () => {
        if (!(img.complete && img.naturalWidth)) await Promise.race([img.decode().catch(() => {}), new Promise(resolve => setTimeout(resolve, 250))]);
        if (cancelled) return;
        const from = thumbBox(origin);
        const to = toBox(img.getBoundingClientRect());
        img.style.visibility = '';
        if (usableBox(from) && usableBox(to)) {
          const animation = run(img, [{ transform: flipTransform(from, to) }, { transform: 'none' }], { fill: 'backwards' });
          void animation.finished.catch(() => {}).then(restoreThumb);
        } else {
          run(img, [{ opacity: 0 }, { opacity: 1 }], { fill: 'backwards' });
          restoreThumb();
        }
      })();
    }
    return () => {
      cancelled = true;
      animations.current.forEach(animation => animation.cancel());
      animations.current = [];
      if (img) img.style.visibility = '';
      restoreThumb();
      element.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start]);

  // 收回：先把当前媒体飞回缩略图（不可见时淡出缩小），播完才卸载。强制关闭时 dialog 已离开 top layer，直接结束。
  const playExit = async () => {
    const element = dialog.current;
    if (!element || !element.open || typeof element.animate !== 'function') return;
    element.dataset.closing = '';
    const currentIndex = indexRef.current;
    const slide = track.current?.children[currentIndex] as HTMLElement | undefined;
    const img = slide?.querySelector('img') ?? null;
    const reduce = reducedMotion();
    const origin = reduce ? null : getOriginRef.current?.(currentIndex) ?? null;
    const target = thumbBox(origin);
    const flies = Boolean(img && origin && usableBox(target) && boxInViewport(target, innerWidth, innerHeight));
    const startBg = element.style.backgroundColor || VIEWER_BG;
    const pulled = img?.style.transform ?? '';
    const startChrome = chrome().map(item => item.style.opacity || '1');
    animations.current.forEach(animation => animation.cancel());
    animations.current = [];
    const duration = reduce ? 160 : DURATION;
    const options: KeyframeAnimationOptions = { duration, easing: reduce ? 'ease-out' : EASING, fill: 'forwards' };
    const all: Animation[] = [];
    if (reduce) {
      all.push(element.animate([{ opacity: 1 }, { opacity: 0 }], options));
    } else {
      all.push(element.animate([{ backgroundColor: startBg }, { backgroundColor: VIEWER_BG_CLEAR }], options));
      chrome().forEach((item, i) => all.push(item.animate([{ opacity: startChrome[i] }, { opacity: 0 }], { ...options, duration: duration * 0.6 })));
      if (flies && img && origin && target) {
        img.style.transform = '';
        const to = toBox(img.getBoundingClientRect());
        if (usableBox(to)) {
          origin.style.visibility = 'hidden';
          hiddenThumb.current = origin;
          all.push(img.animate([{ transform: pulled || 'none' }, { transform: flipTransform(target, to) }], options));
        } else {
          all.push(img.animate([{ transform: pulled || 'none', opacity: 1 }, { opacity: 0 }], options));
        }
      } else if (track.current) {
        all.push(track.current.animate([{ transform: 'none', opacity: 1 }, { transform: 'scale(0.94)', opacity: 0 }], options));
      }
    }
    animations.current.push(...all);
    await Promise.all(all.map(animation => animation.finished.catch(() => {})));
  };
  const playExitRef = useRef(playExit);
  playExitRef.current = playExit;

  const finalClose = useCallback(() => {
    exitPromise.current ??= playExitRef.current();
    void exitPromise.current.then(() => {
      if (closed.current) return;
      closed.current = true;
      onCloseRef.current();
    });
  }, []);
  const close = useHistoryLayer(finalClose);

  useEffect(() => {
    setZoomed(false);
    track.current?.querySelectorAll('video').forEach((video, i) => { if (i !== index) video.pause(); });
  }, [index]);

  // 预加载相邻两项：翻页时无需等待。
  const preloaded = useRef<HTMLImageElement[]>([]);
  useEffect(() => {
    preloaded.current = [index - 1, index + 1].flatMap(i => {
      const post = posts[i];
      const url = post && post.mediaType !== 'video' ? originalMediaURL(post) : '';
      if (!url) return [];
      const image = new Image();
      image.decoding = 'async';
      image.src = url;
      return [image];
    });
  }, [index, posts]);

  useLayoutEffect(() => {
    const slide = track.current?.children[index] as HTMLElement | undefined;
    const img = slide?.querySelector('img');
    const center = zoomCenter.current;
    if (!zoomed || !slide || !img || !center) return;
    zoomCenter.current = null;
    slide.scrollLeft = img.offsetLeft + center.x * img.offsetWidth - slide.clientWidth / 2;
    slide.scrollTop = img.offsetTop + center.y * img.offsetHeight - slide.clientHeight / 2;
  }, [zoomed, index]);

  const go = (target: number) => {
    const element = track.current;
    if (!element || target < 0 || target >= posts.length) return;
    element.scrollTo({ left: target * element.clientWidth, behavior: 'smooth' });
  };

  const toggleZoom = (event: ReactMouseEvent<HTMLImageElement>) => {
    if (drag.current?.moved) return;
    if (zoomed) { setZoomed(false); return; }
    const img = event.currentTarget;
    if (img.naturalWidth <= img.clientWidth && img.naturalHeight <= img.clientHeight) return;
    const rect = img.getBoundingClientRect();
    zoomCenter.current = { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
    setZoomed(true);
  };

  // 鼠标拖动平移原尺寸图片；触屏与触控板直接使用原生滚动。
  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (!zoomed || event.pointerType !== 'mouse' || event.button !== 0) return;
    const slide = event.currentTarget;
    drag.current = { x: event.clientX, y: event.clientY, left: slide.scrollLeft, top: slide.scrollTop, moved: false };
    slide.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (Math.hypot(dx, dy) > 5) state.moved = true;
    event.currentTarget.scrollLeft = state.left - dx;
    event.currentTarget.scrollTop = state.top - dy;
  };

  // 触屏下滑关闭：未缩放时按首次移动方向锁定。横向交给原生轨道滚动（touch-action: pan-x），纵向由这里跟手。
  const setPull = (img: HTMLImageElement, dy: number) => {
    const progress = dismissProgress(dy, innerHeight);
    img.style.transform = `translateY(${dy}px) scale(${1 - progress * 0.18})`;
    if (dialog.current) dialog.current.style.backgroundColor = `rgb(8 9 11 / ${(0.92 * (1 - progress)).toFixed(3)})`;
    chrome().forEach(item => { item.style.opacity = String(1 - Math.min(1, progress * 2.5)); });
  };
  const resetPull = (img: HTMLImageElement) => {
    const element = dialog.current;
    const from = img.style.transform || 'none';
    const startBg = element?.style.backgroundColor || VIEWER_BG;
    const startOpacity = chrome()[0]?.style.opacity || '1';
    img.style.transform = '';
    if (element) element.style.backgroundColor = '';
    chrome().forEach(item => { item.style.opacity = ''; });
    if (typeof img.animate !== 'function') return;
    run(img, [{ transform: from }, { transform: 'none' }], { duration: 220 });
    if (element) run(element, [{ backgroundColor: startBg }, { backgroundColor: VIEWER_BG }], { duration: 220 });
    chrome().forEach(item => run(item, [{ opacity: startOpacity }, { opacity: 1 }], { duration: 220 }));
  };
  const startPull = (event: ReactPointerEvent<HTMLDivElement>) => {
    pull.current = null;
    if (zoomed || event.pointerType === 'mouse' || !event.isPrimary) return;
    if (event.target instanceof Element && event.target.closest('video')) return;
    const img = event.currentTarget.querySelector('img');
    if (!img) return;
    pull.current = { id: event.pointerId, x: event.clientX, y: event.clientY, lastY: event.clientY, lastT: event.timeStamp, velocity: 0, axis: null, img };
  };
  const movePull = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = pull.current;
    if (!state || state.id !== event.pointerId || state.axis === 'x') return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (!state.axis) {
      state.axis = dismissAxis(dx, dy);
      if (state.axis !== 'y') return;
      event.currentTarget.setPointerCapture(event.pointerId);
      animations.current.forEach(animation => animation.cancel());
      animations.current = [];
    }
    const dt = event.timeStamp - state.lastT;
    if (dt > 0) state.velocity = (event.clientY - state.lastY) / dt;
    state.lastY = event.clientY;
    state.lastT = event.timeStamp;
    setPull(state.img, dy);
  };
  const endPull = (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const state = pull.current;
    if (!state || state.id !== event.pointerId) return;
    pull.current = null;
    if (state.axis !== 'y') return;
    const dy = event.clientY - state.y;
    if (!cancelled && shouldDismiss(dy, state.velocity, innerHeight)) close();
    else resetPull(state.img);
  };

  return createPortal(
    <dialog
      ref={dialog}
      className="media-viewer"
      data-zoomed={zoomed || undefined}
      aria-label="媒体查看器"
      onCancel={event => { event.preventDefault(); if (zoomed) setZoomed(false); else close(); }}
      // 仅响应浏览器强制关闭（如连续 Esc）；卸载与 StrictMode 重挂载时的 close 事件忽略。
      onClose={() => { if (dialog.current && !dialog.current.open) close(); }}
      // React 合成事件会穿过 portal 冒泡到卡片，阻止以免触发“进入详情”。
      onClick={event => event.stopPropagation()}
      onPointerDown={event => event.stopPropagation()}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'ArrowLeft') { event.preventDefault(); go(index - 1); }
        if (event.key === 'ArrowRight') { event.preventDefault(); go(index + 1); }
      }}
    >
      <div className="viewer-toolbar">
        {posts.length > 1 ? <span className="viewer-count" aria-live="polite"><span className="viewer-count-num" key={index}>{index + 1}</span> / {posts.length}</span> : <span />}
        <span className="viewer-actions">
          {src && <a className="viewer-button" href={src} target="_blank" rel="noreferrer noopener" aria-label="在新标签页打开原文件" title="打开原文件"><Icon name="open" /></a>}
          <button ref={closeButton} type="button" className="viewer-button" onClick={close} aria-label="关闭查看器" title="关闭（Esc）"><Icon name="close" /></button>
        </span>
      </div>
      <div ref={track} className="viewer-track" data-locked={zoomed || undefined}
        onScroll={event => setIndex(Math.min(posts.length - 1, Math.max(0, Math.round(event.currentTarget.scrollLeft / event.currentTarget.clientWidth))))}>
        {posts.map((post, i) => {
          const url = originalMediaURL(post);
          const label = postSource(post.id).label;
          return <div key={`${post.id}:${url}`} className="viewer-slide" data-zoomed={(zoomed && i === index) || undefined}
            onClick={event => { if (event.target === event.currentTarget && !drag.current?.moved) close(); }}
            onPointerDown={event => { startDrag(event); startPull(event); }}
            onPointerMove={event => { moveDrag(event); movePull(event); }}
            onPointerUp={event => endPull(event, false)} onPointerCancel={event => endPull(event, true)}>
            {!url ? <p className="viewer-message">未提供可访问的原始媒体</p>
              : post.mediaType === 'video' ? <video src={url} controls playsInline preload="metadata" aria-label={label} />
              : <img src={url} alt={label} decoding="async" draggable={false} onClick={toggleZoom} />}
          </div>;
        })}
      </div>
      {index > 0 && <button type="button" className="viewer-nav prev" onClick={() => go(index - 1)} aria-label="上一项" title="上一项（←）"><Icon name="prev" /></button>}
      {index < posts.length - 1 && <button type="button" className="viewer-nav next" onClick={() => go(index + 1)} aria-label="下一项" title="下一项（→）"><Icon name="next" /></button>}
    </dialog>,
    document.body,
  );
}
