import { describe, expect, test } from 'bun:test';
import { boxInViewport, containedBox, flipTransform, usableBox } from '../src/viewer-motion';

describe('看图器 FLIP 计算', () => {
  test('containedBox：按 object-fit: contain 居中缩放', () => {
    expect(containedBox({ left: 0, top: 0, width: 400, height: 400 }, 200, 100)).toEqual({ left: 0, top: 100, width: 400, height: 200 });
    // 图片尺寸未知时原样返回盒子
    const box = { left: 1, top: 2, width: 30, height: 40 };
    expect(containedBox(box, 0, 0)).toBe(box);
  });

  test('flipTransform：中心位移加等比缩放', () => {
    const from = { left: 10, top: 20, width: 100, height: 50 };
    const to = { left: 0, top: 0, width: 400, height: 200 };
    expect(flipTransform(from, to)).toBe('translate(-140px, -55px) scale(0.25)');
  });

  test('usableBox / boxInViewport：零尺寸与视口外的目标不可用', () => {
    expect(usableBox({ left: 0, top: 0, width: 0, height: 10 })).toBe(false);
    expect(usableBox(null)).toBe(false);
    expect(boxInViewport({ left: 10, top: 10, width: 50, height: 50 }, 375, 800)).toBe(true);
    expect(boxInViewport({ left: 10, top: -80, width: 50, height: 50 }, 375, 800)).toBe(false);
    expect(boxInViewport({ left: 10, top: 900, width: 50, height: 50 }, 375, 800)).toBe(false);
  });
});
