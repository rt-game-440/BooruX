import { describe, expect, test } from 'bun:test';
import { dismissAxis, dismissProgress, shouldDismiss, swipeAxis, swipeTarget } from '../src/media-swipe';

describe('swipeAxis', () => {
  test('位移不足时暂不判定', () => {
    expect(swipeAxis(4, 3)).toBeNull();
  });

  test('明显横向才算横滑，斜向与纵向交给页面', () => {
    expect(swipeAxis(-20, 5)).toBe('x');
    expect(swipeAxis(12, -11)).toBe('y');
    expect(swipeAxis(3, -20)).toBe('y');
  });
});

describe('swipeTarget', () => {
  test('位移不足且速度慢时回到当前项', () => {
    expect(swipeTarget(1, 3, -30, -0.1, 300)).toBe(1);
  });

  test('向左划过阈值翻到下一项，向右翻到上一项', () => {
    expect(swipeTarget(1, 3, -80, 0, 300)).toBe(2);
    expect(swipeTarget(1, 3, 80, 0, 300)).toBe(0);
  });

  test('快速轻扫即使位移短也翻页', () => {
    expect(swipeTarget(0, 3, -20, -0.6, 300)).toBe(1);
  });

  test('首尾不越界', () => {
    expect(swipeTarget(0, 3, 200, 1, 300)).toBe(0);
    expect(swipeTarget(2, 3, -200, -1, 300)).toBe(2);
  });
});

describe('下滑关闭（看图器）', () => {
  test('dismissAxis：位移不足暂不判定，纵向占优锁定 y，其余视为 x', () => {
    expect(dismissAxis(3, 4)).toBeNull();
    expect(dismissAxis(4, 24)).toBe('y');
    expect(dismissAxis(-30, 12)).toBe('x');
  });

  test('shouldDismiss：超过视口高度 22% 或顺向快速甩动才关闭', () => {
    expect(shouldDismiss(60, 0.1, 800)).toBe(false);
    expect(shouldDismiss(200, 0.1, 800)).toBe(true);
    expect(shouldDismiss(-200, 0, 800)).toBe(true);
    expect(shouldDismiss(40, 0.8, 800)).toBe(true);
    // 速度方向与位移相反（拖下去又往回甩）不关闭
    expect(shouldDismiss(40, -0.8, 800)).toBe(false);
  });

  test('dismissProgress：与位移方向无关，限制在 0..1', () => {
    expect(dismissProgress(0, 800)).toBe(0);
    expect(dismissProgress(200, 800)).toBeCloseTo(0.5);
    expect(dismissProgress(-900, 800)).toBe(1);
    expect(dismissProgress(10, 0)).toBe(0);
  });
});
