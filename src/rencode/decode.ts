import type { RencodableData } from 'python-rencode';

// Typecodes, as in https://github.com/aresch/rencode.
const INT_POS_FIXED_COUNT = 44;
const CHR_FLOAT64 = 44;
const CHR_LIST = 59;
const CHR_DICT = 60;
const CHR_INT = 61;
const CHR_INT1 = 62;
const CHR_INT2 = 63;
const CHR_INT4 = 64;
const CHR_INT8 = 65;
const CHR_FLOAT32 = 66;
const CHR_TRUE = 67;
const CHR_FALSE = 68;
const CHR_NONE = 69;
const INT_NEG_FIXED_START = 70;
const DICT_FIXED_START = 102;
const CHR_TERM = 127;
const STR_FIXED_START = 128;
const LIST_FIXED_START = 192;
const COLON = 58;

const CHUNK = 8192;

const utf8 = new TextDecoder();

/**
 * Decodes one rencoded value, as `python-rencode`'s `decode` does, several
 * times faster on Hermes.
 *
 * Nearly all of the time goes on strings. Every string with only ASCII bytes
 * is cut out of one Latin-1 string of the whole body, built once; the rest go
 * through `TextDecoder`.
 */
export function decode(bytes: Uint8Array): RencodableData {
  const length = bytes.length;
  const view = new DataView(bytes.buffer, bytes.byteOffset, length);

  const parts: string[] = [];
  for (let i = 0; i < length; i += CHUNK) {
    parts.push(
      String.fromCharCode.apply(
        null,
        bytes.subarray(i, i + CHUNK) as unknown as number[],
      ),
    );
  }
  const latin1 = parts.join('');

  let pos = 0;

  const need = (end: number) => {
    if (end > length) {
      throw new Error(
        `Malformed rencoded data: needs ${end} bytes, has ${length}`,
      );
    }
  };

  const string = (start: number, size: number): string => {
    need(start + size);
    for (let i = start; i < start + size; i++) {
      if (bytes[i] >= 0x80)
        return utf8.decode(bytes.subarray(start, start + size));
    }
    return latin1.substring(start, start + size);
  };

  const entry = (dict: Record<string, RencodableData>) => {
    const key = value();
    if (typeof key !== 'string' && typeof key !== 'number') {
      throw new TypeError(`Received invalid value for dictionary key: ${key}`);
    }
    dict[key] = value();
  };

  const value = (): RencodableData => {
    if (pos >= length) {
      throw new Error(
        `Malformed rencoded data: data.length: ${length} pos: ${pos}`,
      );
    }
    const t = bytes[pos];

    if (t < INT_POS_FIXED_COUNT) {
      pos++;
      return t;
    }
    if (t >= STR_FIXED_START && t < LIST_FIXED_START) {
      const size = t - STR_FIXED_START;
      const s = string(pos + 1, size);
      pos += 1 + size;
      return s;
    }
    if (t >= LIST_FIXED_START) {
      const size = t - LIST_FIXED_START;
      pos++;
      const list: RencodableData[] = new Array(size);
      for (let i = 0; i < size; i++) list[i] = value();
      return list;
    }
    if (t >= DICT_FIXED_START && t < CHR_TERM) {
      let size = t - DICT_FIXED_START;
      pos++;
      const dict: Record<string, RencodableData> = {};
      while (size--) entry(dict);
      return dict;
    }
    if (t >= INT_NEG_FIXED_START && t < DICT_FIXED_START) {
      pos++;
      return INT_NEG_FIXED_START - 1 - t;
    }
    // A length in ASCII digits, then ':', then the string.
    if (t >= 49 && t <= 57) {
      let size = 0;
      while (bytes[pos] !== COLON) {
        if (pos >= length) need(pos + 1);
        size = size * 10 + (bytes[pos++] - 48);
      }
      pos++;
      const s = string(pos, size);
      pos += size;
      return s;
    }

    switch (t) {
      case CHR_INT1:
        need(pos + 2);
        pos += 2;
        return view.getInt8(pos - 1);
      case CHR_INT2:
        need(pos + 3);
        pos += 3;
        return view.getInt16(pos - 2);
      case CHR_INT4:
        need(pos + 5);
        pos += 5;
        return view.getInt32(pos - 4);
      case CHR_INT8: {
        need(pos + 9);
        const big = view.getBigInt64(pos + 1);
        if (
          big > BigInt(Number.MAX_SAFE_INTEGER) ||
          big < BigInt(Number.MIN_SAFE_INTEGER)
        ) {
          throw new Error('Encoded value outside of decodable range.');
        }
        pos += 9;
        return Number(big);
      }
      case CHR_INT: {
        let end = pos + 1;
        while (bytes[end] !== CHR_TERM) {
          if (end >= length) need(end + 1);
          end++;
        }
        const n = Number(latin1.substring(pos + 1, end));
        pos = end + 1;
        return n;
      }
      case CHR_FLOAT32:
        need(pos + 5);
        pos += 5;
        return view.getFloat32(pos - 4);
      case CHR_FLOAT64:
        need(pos + 9);
        pos += 9;
        return view.getFloat64(pos - 8);
      case CHR_TRUE:
        pos++;
        return true;
      case CHR_FALSE:
        pos++;
        return false;
      case CHR_NONE:
        pos++;
        return null;
      case CHR_LIST: {
        pos++;
        const list: RencodableData[] = [];
        while (bytes[pos] !== CHR_TERM) list.push(value());
        pos++;
        return list;
      }
      case CHR_DICT: {
        pos++;
        const dict: Record<string, RencodableData> = {};
        while (bytes[pos] !== CHR_TERM) entry(dict);
        pos++;
        return dict;
      }
    }

    throw new Error(`Unexpected typecode received (${t}) at position ${pos}`);
  };

  return value();
}
