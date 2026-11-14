import { describe, expect, test } from 'bun:test';

import { decode as reference, encode } from 'python-rencode';
import type { RencodableData } from 'python-rencode';

import { decode } from './decode.js';

/** Whatever `python-rencode` makes of the bytes is the answer to match. */
function expectSame(bytes: Uint8Array) {
  expect(decode(bytes)).toEqual(reference(Buffer.from(bytes)));
}

const roundTrip = (data: RencodableData, floatBits?: 32 | 64) =>
  expectSame(new Uint8Array(encode(data, floatBits)));

/** Deterministic, so a failure reproduces. */
function random(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

describe('decode', () => {
  test('matches python-rencode on a response shaped like get_torrents_status', () => {
    const next = random(1);
    const names = [
      'ubuntu-24.04-desktop-amd64.iso',
      'Zażółć gęślą jaźń',
      '日本語のファイル名',
      'emoji 🎬 name',
      'x'.repeat(200),
    ];
    const status: Record<string, RencodableData> = {};

    for (let i = 0; i < 1000; i++) {
      status[
        Math.floor(next() * 2 ** 52)
          .toString(16)
          .padStart(40, '0')
      ] = {
        name: `${names[i % names.length]} ${i}`,
        download_location: `/mnt/data/${i % 7 === 0 ? 'Seriale' : 'Filmy'}`,
        progress: i % 3 === 0 ? 100 : next() * 100,
        state: ['Seeding', 'Downloading', 'Paused', 'Error'][i % 4],
        time_added: 1_700_000_000 + i,
        total_size: Math.floor(next() * 2 ** 40),
        total_done: Math.floor(next() * 2 ** 33),
        eta: i % 5 === 0 ? -1 : Math.floor(next() * 100_000),
        download_payload_rate: Math.floor(next() * 50_000_000),
        upload_payload_rate: i % 2 ? 0 : Math.floor(next() * 300),
        ratio: next() * 5,
        time_since_transfer: i % 11 === 0 ? null : Math.floor(next() * 2 ** 20),
        num_files: i % 13,
        is_finished: i % 2 === 0,
      };
    }

    roundTrip(status);
  });

  test('matches python-rencode on every integer width', () => {
    roundTrip([
      0,
      43,
      44,
      -1,
      -32,
      -33,
      127,
      -128,
      128,
      -129,
      32767,
      -32768,
      32768,
      -32769,
      2 ** 31 - 1,
      -(2 ** 31),
      2 ** 31,
      2 ** 47 - 1,
      2 ** 47,
      -(2 ** 47) - 1,
      Number.MAX_SAFE_INTEGER,
    ]);
  });

  test('reads a negative 64-bit integer the way Deluge writes it', () => {
    // Two's complement, as aresch/rencode packs it. python-rencode's encoder
    // pads with zero bytes instead, and its decoder throws on these.
    const int8 = (n: bigint) => {
      const bytes = new Uint8Array(9);
      bytes[0] = 65;
      new DataView(bytes.buffer).setBigInt64(1, n);
      return bytes;
    };

    expect(decode(int8(-(2n ** 31n) - 1n))).toBe(-(2 ** 31) - 1);
    expect(decode(int8(-(2n ** 47n)))).toBe(-(2 ** 47));
    expect(decode(int8(2n ** 40n))).toBe(2 ** 40);
    expect(() => decode(int8(2n ** 60n))).toThrow(/range/);
  });

  test('matches python-rencode on floats of both widths', () => {
    const floats = [0.5, -0.25, 1e300, -1e-300, 3.141592653589793];

    roundTrip(floats);
    roundTrip(floats, 32);
  });

  test('matches python-rencode on strings of every form', () => {
    roundTrip([
      '',
      'a',
      'a'.repeat(63),
      'a'.repeat(64),
      'a'.repeat(5000),
      'ą',
      'ą'.repeat(40),
      '日本語',
      '🎬',
      `${'a'.repeat(70)}ż`,
    ]);
  });

  test('matches python-rencode on containers of every form', () => {
    const list = (n: number) => Array.from({ length: n }, (_, i) => i);
    const dict = (n: number) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, i]));

    roundTrip([
      [],
      list(63),
      list(64),
      list(1000),
      {},
      dict(24),
      dict(25),
      dict(300),
      { nested: [{ deeper: [[], {}, null] }] },
      null,
      true,
      false,
    ]);
  });

  test('keeps a number as a dictionary key, as Deluge can send one', () => {
    // { 1: 'a' }: a one-entry dict, a fixed int, a one-byte string.
    expectSame(new Uint8Array([103, 1, 129, 97]));
  });

  test('throws on truncated data instead of making something up', () => {
    const bytes = new Uint8Array(encode({ name: 'ubuntu.iso', size: 2 ** 40 }));

    for (let end = 0; end < bytes.length; end++) {
      expect(() => decode(bytes.subarray(0, end))).toThrow();
    }
  });

  test('throws on a typecode rencode does not have', () => {
    expect(() => decode(new Uint8Array([127]))).toThrow(/typecode/);
  });
});
