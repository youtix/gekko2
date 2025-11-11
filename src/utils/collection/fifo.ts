type Node<T> = {
  value: T;
  next: Node<T> | null;
};

export class Fifo<T> {
  private head: Node<T> | null = null;
  private tail: Node<T> | null = null;
  private length = 0;

  constructor(initial?: Iterable<T>) {
    if (initial) {
      for (const value of initial) this.push(value);
    }
  }

  push(value: T): number {
    const node: Node<T> = { value, next: null };
    if (!this.head) {
      this.head = node;
      this.tail = node;
    } else if (this.tail) {
      this.tail.next = node;
      this.tail = node;
    }
    return ++this.length;
  }

  shift(): T | undefined {
    if (!this.head) return undefined;
    const { value } = this.head;
    this.head = this.head.next;
    if (!this.head) this.tail = null;
    this.length--;
    return value;
  }

  peek(): T | undefined {
    return this.head ? this.head.value : undefined;
  }

  size(): number {
    return this.length;
  }

  isEmpty(): boolean {
    return this.length === 0;
  }

  clear(): void {
    this.head = null;
    this.tail = null;
    this.length = 0;
  }

  toArray(): T[] {
    const arr: T[] = new Array(this.length);
    let current = this.head;
    let i = 0;
    while (current) {
      arr[i++] = current.value;
      current = current.next;
    }
    return arr;
  }
}
