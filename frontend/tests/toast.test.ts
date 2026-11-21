import { describe, expect, test } from 'bun:test';
import { nextToast, TOAST_ACTION_MS, TOAST_MS } from '../src/toast';

describe('toast 队列', () => {
  test('首条 toast 默认 success 语气与常规停留时间', () => {
    const toast = nextToast(null, { message: '收藏成功' });
    expect(toast).toMatchObject({ id: 1, message: '收藏成功', tone: 'success', duration: TOAST_MS });
  });

  test('新的替换旧的：id 递增以重播进入动画，旧内容不保留', () => {
    const first = nextToast(null, { message: 'a', tone: 'info' });
    const second = nextToast(first, { message: 'b', tone: 'error' });
    expect(second.id).toBe(first.id + 1);
    expect(second).toMatchObject({ message: 'b', tone: 'error' });
    expect(second.action).toBeUndefined();
  });

  test('带操作按钮的 toast 停留约 4 秒', () => {
    const toast = nextToast(null, { message: '已取消收藏', action: { label: '撤销', run: () => {} } });
    expect(toast.duration).toBe(TOAST_ACTION_MS);
    expect(TOAST_ACTION_MS).toBeGreaterThan(TOAST_MS);
    expect(toast.action?.label).toBe('撤销');
  });
});
