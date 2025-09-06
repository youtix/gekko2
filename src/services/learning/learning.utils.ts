let return_v = false;
let v_val = 0.0;

export const gaussRandom = function (): number {
  if (return_v) {
    return_v = false;
    return v_val;
  }
  const u = 2 * Math.random() - 1;
  const v = 2 * Math.random() - 1;
  const r = u * u + v * v;
  if (r == 0 || r > 1) return gaussRandom();
  const c = Math.sqrt((-2 * Math.log(r)) / r);
  v_val = v * c; // cache this
  return_v = true;
  return u * c;
};

export const randf = function (a: number, b: number): number {
  return Math.random() * (b - a) + a;
};

export const randi = function (a: number, b: number): number {
  return Math.floor(Math.random() * (b - a) + a);
};

export const randn = function (mu: number, std: number): number {
  return mu + gaussRandom() * std;
};

export const zeros = function (n?: number): number[] | Float64Array {
  if (typeof n === 'undefined' || isNaN(n)) {
    return [];
  }
  if (typeof ArrayBuffer === 'undefined') {
    // lacking browser support
    const arr: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      arr[i] = 0;
    }
    return arr;
  } else {
    return new Float64Array(n);
  }
};

export const arrContains = function <T>(arr: T[], elt: T): boolean {
  for (let i = 0, n = arr.length; i < n; i++) {
    if (arr[i] === elt) return true;
  }
  return false;
};

export const arrUnique = function <T>(arr: T[]): T[] {
  const b: T[] = [];
  for (let i = 0, n = arr.length; i < n; i++) {
    if (!arrContains(b, arr[i])) {
      b.push(arr[i]);
    }
  }
  return b;
};

// return max and min of a given non-empty array.
export type MaxMin = { maxi: number; maxv: number; mini: number; minv: number; dv: number };
export const maxmin = function (w: number[] | Float64Array): MaxMin {
  if (w.length === 0) {
    return { maxi: 0, maxv: 0, mini: 0, minv: 0, dv: 0 };
  }
  let maxv = w[0];
  let minv = w[0];
  let maxi = 0;
  let mini = 0;
  const n = w.length;
  for (let i = 1; i < n; i++) {
    if (w[i] > maxv) {
      maxv = w[i];
      maxi = i;
    }
    if (w[i] < minv) {
      minv = w[i];
      mini = i;
    }
  }
  return { maxi: maxi, maxv: maxv, mini: mini, minv: minv, dv: maxv - minv };
};

// create random permutation of numbers, in range [0...n-1]
export const randperm = function (n: number): number[] {
  let i = n,
    j = 0,
    temp: number;
  const array: number[] = [];
  for (let q = 0; q < n; q++) array[q] = q;
  while (i--) {
    j = Math.floor(Math.random() * (i + 1));
    temp = array[i];
    array[i] = array[j];
    array[j] = temp;
  }
  return array;
};

// sample from list lst according to probabilities in list probs
// the two lists are of same size, and probs adds up to 1
export const weightedSample = function <T>(lst: T[], probs: number[]): T {
  const p = randf(0, 1.0);
  let cumprob = 0.0;
  for (let k = 0, n = lst.length; k < n; k++) {
    cumprob += probs[k];
    if (p < cumprob) {
      return lst[k];
    }
  }
  // Fallback in case of numerical issues; ensures a value is always returned
  return lst[lst.length - 1];
};

// syntactic sugar function for getting default parameter values
export const getopt = function <T extends string, K>(opt: Record<T, K>, field_name: T, default_value: K) {
  return typeof opt[field_name] !== 'undefined' ? opt[field_name] : default_value;
};
