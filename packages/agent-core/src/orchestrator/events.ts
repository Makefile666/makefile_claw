// 轻量异步队列：并行 Worker 把事件推入，主编排生成器按到达顺序取出 yield，
// 实现多 Worker 输出的实时交织（同时保证 SSE 顺序）。

export class AsyncQueue<T> {
  private items: T[] = [];
  private resolve?: (item: T) => void;
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = undefined;
      r(item);
    } else {
      this.items.push(item);
    }
  }

  async next(): Promise<T> {
    if (this.items.length > 0) {
      return this.items.shift() as T;
    }
    if (this.closed) {
      return Promise.reject(new Error('AsyncQueue closed'));
    }
    return new Promise<T>((resolve) => {
      this.resolve = resolve;
    });
  }

  close(): void {
    this.closed = true;
  }
}
