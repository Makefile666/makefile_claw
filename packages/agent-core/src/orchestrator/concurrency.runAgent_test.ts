import { Semaphore, ConcurrencyController } from './concurrency';

describe('Semaphore（并发限流）', () => {
  it('TR-8.1 限制同时持有许可的数量', async () => {
    const sem = new Semaphore(2);
    let active = 0;
    let peak = 0;
    const task = async () => {
      const ok = await sem.acquire();
      if (!ok) return;
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 15));
      active--;
      sem.release();
    };
    await Promise.all([task(), task(), task(), task()]);
    expect(peak).toBe(2);
  });

  it('TR-8.2 超时获取失败返回 false，不占槽', async () => {
    const sem = new Semaphore(1);
    const got1 = await sem.acquire();
    expect(got1).toBe(true);
    const got2 = await sem.acquire(30);
    expect(got2).toBe(false);
    sem.release();
    // 释放后可再次获取
    expect(await sem.acquire()).toBe(true);
    sem.release();
  });
});

describe('ConcurrencyController', () => {
  it('TR-8.3 全局并行上限生效（maxParallelWorkers）', async () => {
    const cc = new ConcurrencyController(2);
    let active = 0;
    let peak = 0;
    const run = async () => {
      const slot = await cc.acquireSlots('any-agent', 1000);
      if (!slot) return;
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 15));
      active--;
      slot.release();
    };
    await Promise.all([run(), run(), run(), run()]);
    expect(peak).toBe(2);
    expect(cc.currentConcurrency).toBe(0);
  });
});
