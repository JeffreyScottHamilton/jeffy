/** A single-consumer async queue of text pieces; `end()` finishes it, `fail()` makes the consumer throw. */
export class TextQueue implements AsyncIterable<string> {
  private items: string[] = [];
  private waiter: (() => void) | null = null;
  private closed = false;
  private error: unknown;

  push(s: string) {
    if (this.closed) return;
    this.items.push(s);
    this.wake();
  }
  end() {
    this.closed = true;
    this.wake();
  }
  fail(e: unknown) {
    this.error = e;
    this.end();
  }
  private wake() {
    const w = this.waiter;
    this.waiter = null;
    w?.();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<string> {
    for (;;) {
      const next = this.items.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      if (this.closed) {
        if (this.error) throw this.error;
        return;
      }
      await new Promise<void>((r) => (this.waiter = r));
    }
  }
}
