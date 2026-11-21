import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Icon } from './icons';

export type ToastTone = 'success' | 'error' | 'info';
export type ToastInput = { message: string; tone?: ToastTone; action?: { label: string; run: () => void } };
export type ToastItem = Required<Pick<ToastInput, 'message' | 'tone'>> & { id: number; action?: ToastInput['action']; duration: number };

export const TOAST_MS = 2400;
// 带操作按钮的 toast 给用户留出点击时间。
export const TOAST_ACTION_MS = 4000;

// 同一时间只显示一条：新的 toast 直接替换旧的，id 递增以便重播进入动画。
export function nextToast(current: ToastItem | null, input: ToastInput): ToastItem {
  return {
    id: (current?.id ?? 0) + 1,
    message: input.message,
    tone: input.tone ?? 'success',
    action: input.action,
    duration: input.action ? TOAST_ACTION_MS : TOAST_MS,
  };
}

type ToastApi = { show: (input: ToastInput) => void; dismiss: () => void };

// 未包裹 ToastProvider（例如单元测试）时退化为空操作。
const ToastContext = createContext<ToastApi>({ show: () => {}, dismiss: () => {} });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const show = useCallback((input: ToastInput) => setToast(current => nextToast(current, input)), []);
  const dismiss = useCallback(() => setToast(null), []);
  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(current => (current?.id === toast.id ? null : current)), toast.duration);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return <ToastContext.Provider value={api}>
    {children}
    <div className="toast-region" role="status" aria-live="polite">
      {toast && <div className="toast" key={toast.id} data-tone={toast.tone} data-actionable={toast.action ? '' : undefined}
        style={{ '--toast-ms': `${toast.duration}ms` } as CSSProperties}>
        {toast.tone !== 'info' && <Icon name={toast.tone === 'error' ? 'alert' : 'check'} />}
        <span>{toast.message}</span>
        {toast.action && <button type="button" className="toast-action" onClick={() => { toast.action!.run(); dismiss(); }}>{toast.action.label}</button>}
      </div>}
    </div>
  </ToastContext.Provider>;
}
