import type { Mat3, ReferenceImage } from './types';

export const REFERENCE_LIMITS = {
  count: 6,
  imageBytes: 12 * 1024 ** 2,
  batchBytes: 48 * 1024 ** 2,
  pixels: 40_000_000,
} as const;
const SUPPORTED = new Set(['image/png', 'image/jpeg', 'image/webp']);

function dimensions(width: number, height: number) {
  if (![width, height].every((v) => Number.isSafeInteger(v) && v > 0))
    throw new Error('INVALID_DIMENSIONS');
  if (width * height > REFERENCE_LIMITS.pixels)
    throw new Error('IMAGE_PIXEL_LIMIT');
}

export function validateReferenceSet(
  refs: ReferenceImage[],
  primaryId: string
): ReferenceImage[] {
  if (refs.length < 1 || refs.length > REFERENCE_LIMITS.count)
    throw new Error('REFERENCE_COUNT');
  const ids = new Set<string>();
  let total = 0;
  const primary = refs.find((r) => r.id === primaryId);
  if (!primary) throw new Error('PRIMARY_NOT_FOUND');
  if (primary.kind !== 'observed') throw new Error('PRIMARY_MUST_BE_OBSERVED');
  for (const ref of refs) {
    if (!ref.id || ids.has(ref.id)) throw new Error('DUPLICATE_REFERENCE_ID');
    ids.add(ref.id);
    if (ref.kind !== 'observed')
      throw new Error('GENERATED_REFERENCE_IS_AUXILIARY');
    if (!/^[a-f0-9]{64}$/.test(ref.sha256))
      throw new Error('INVALID_SOURCE_HASH');
    dimensions(ref.width, ref.height);
    dimensions(ref.sourceWidth, ref.sourceHeight);
    const m = ref.sourceToImage;
    if (
      !m ||
      m.length !== 9 ||
      !m.every(Number.isFinite) ||
      m[6] !== 0 ||
      m[7] !== 0 ||
      m[8] !== 1 ||
      Math.abs(m[0] * m[4] - m[1] * m[3]) < 1e-12
    )
      throw new Error('INVALID_TRANSFORM');
    if (!(ref.blob instanceof Blob) || !SUPPORTED.has(ref.blob.type))
      throw new Error('UNSUPPORTED_IMAGE');
    if (ref.blob.size === 0 || ref.blob.size > REFERENCE_LIMITS.imageBytes)
      throw new Error('IMAGE_BYTE_LIMIT');
    total += ref.blob.size;
  }
  if (total > REFERENCE_LIMITS.batchBytes) throw new Error('BATCH_BYTE_LIMIT');
  return [primary, ...refs.filter((r) => r !== primary)];
}

export function orientationTransform(orientation: number): Mat3 {
  switch (orientation) {
    case 1:
      return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    case 2:
      return [-1, 0, 1, 0, 1, 0, 0, 0, 1];
    case 3:
      return [-1, 0, 1, 0, -1, 1, 0, 0, 1];
    case 4:
      return [1, 0, 0, 0, -1, 1, 0, 0, 1];
    case 5:
      return [0, 1, 0, 1, 0, 0, 0, 0, 1];
    case 6:
      return [0, -1, 1, 1, 0, 0, 0, 0, 1];
    case 7:
      return [0, -1, 1, -1, 0, 1, 0, 0, 1];
    case 8:
      return [0, 1, 0, -1, 0, 1, 0, 0, 1];
    default:
      throw new Error('INVALID_ORIENTATION');
  }
}

function exifOrientation(bytes: Uint8Array): number {
  let start = 0;
  if (
    bytes[0] === 0x45 &&
    bytes[1] === 0x78 &&
    bytes[2] === 0x69 &&
    bytes[3] === 0x66
  )
    start = 6;
  if (bytes.length < start + 8) throw new Error('INVALID_EXIF');
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset + start,
    bytes.length - start
  );
  const byteOrder = view.getUint16(0);
  if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d)
    throw new Error('INVALID_EXIF');
  const le = byteOrder === 0x4949;
  if (view.getUint16(2, le) !== 42) throw new Error('INVALID_EXIF');
  const ifd = view.getUint32(4, le);
  if (ifd + 2 > view.byteLength) throw new Error('INVALID_EXIF');
  const count = view.getUint16(ifd, le);
  if (ifd + 2 + count * 12 > view.byteLength) throw new Error('INVALID_EXIF');
  for (let i = 0; i < count; i++) {
    const offset = ifd + 2 + i * 12;
    if (view.getUint16(offset, le) !== 0x0112) continue;
    if (
      view.getUint16(offset + 2, le) !== 3 ||
      view.getUint32(offset + 4, le) !== 1
    )
      throw new Error('INVALID_EXIF');
    const orientation = view.getUint16(offset + 8, le);
    orientationTransform(orientation);
    return orientation;
  }
  return 1;
}

/** Bounded header inspection before image decoding/allocation. The decoder still validates pixel data. */
export function inspectReferenceBytes(bytes: Uint8Array): {
  mime: string;
  width: number;
  height: number;
  orientation: number;
} {
  if (!bytes.length || bytes.length > REFERENCE_LIMITS.imageBytes)
    throw new Error('IMAGE_BYTE_LIMIT');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at: number, length: number) =>
    String.fromCharCode(...bytes.subarray(at, at + length));
  let mime: string,
    width = 0,
    height = 0,
    orientation = 1;
  if (
    bytes.length >= 24 &&
    v.getUint32(0) === 0x89504e47 &&
    v.getUint32(4) === 0x0d0a1a0a
  ) {
    mime = 'image/png';
    if (ascii(12, 4) !== 'IHDR' || v.getUint32(8) !== 13)
      throw new Error('INVALID_IMAGE_HEADER');
    width = v.getUint32(16);
    height = v.getUint32(20);
    for (let p = 8; p + 12 <= bytes.length; ) {
      const length = v.getUint32(p),
        end = p + 12 + length;
      if (end > bytes.length) throw new Error('INVALID_IMAGE_HEADER');
      if (ascii(p + 4, 4) === 'eXIf')
        orientation = exifOrientation(bytes.subarray(p + 8, p + 8 + length));
      p = end;
    }
  } else if (bytes.length >= 4 && v.getUint16(0) === 0xffd8) {
    mime = 'image/jpeg';
    for (let p = 2; p + 4 <= bytes.length; ) {
      if (bytes[p++] !== 0xff) throw new Error('INVALID_IMAGE_HEADER');
      while (bytes[p] === 0xff) p++;
      const marker = bytes[p++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const length = v.getUint16(p);
      if (length < 2 || p + length > bytes.length)
        throw new Error('INVALID_IMAGE_HEADER');
      if (marker === 0xe1 && ascii(p + 2, 6) === 'Exif\0\0')
        orientation = exifOrientation(bytes.subarray(p + 2, p + length));
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker)
      ) {
        if (length < 8) throw new Error('INVALID_IMAGE_HEADER');
        height = v.getUint16(p + 3);
        width = v.getUint16(p + 5);
      }
      p += length;
    }
  } else if (
    bytes.length >= 20 &&
    ascii(0, 4) === 'RIFF' &&
    ascii(8, 4) === 'WEBP'
  ) {
    mime = 'image/webp';
    if (v.getUint32(4, true) + 8 !== bytes.length)
      throw new Error('INVALID_IMAGE_HEADER');
    for (let p = 12; p + 8 <= bytes.length; ) {
      const type = ascii(p, 4),
        length = v.getUint32(p + 4, true),
        data = p + 8;
      if (data + length > bytes.length) throw new Error('INVALID_IMAGE_HEADER');
      if (type === 'VP8X' && length >= 10) {
        if (bytes[data] & 2) throw new Error('ANIMATED_IMAGE_UNSUPPORTED');
        width =
          1 +
          bytes[data + 4] +
          (bytes[data + 5] << 8) +
          (bytes[data + 6] << 16);
        height =
          1 +
          bytes[data + 7] +
          (bytes[data + 8] << 8) +
          (bytes[data + 9] << 16);
      } else if (type === 'VP8 ' && !width && length >= 10) {
        if (ascii(data + 3, 3) !== '\x9d\x01\x2a')
          throw new Error('INVALID_IMAGE_HEADER');
        width = v.getUint16(data + 6, true) & 0x3fff;
        height = v.getUint16(data + 8, true) & 0x3fff;
      } else if (type === 'VP8L' && !width && length >= 5) {
        if (bytes[data] !== 0x2f) throw new Error('INVALID_IMAGE_HEADER');
        const bits = v.getUint32(data + 1, true);
        width = (bits & 0x3fff) + 1;
        height = ((bits >>> 14) & 0x3fff) + 1;
      } else if (type === 'EXIF')
        orientation = exifOrientation(bytes.subarray(data, data + length));
      p = data + length + (length % 2);
    }
  } else throw new Error('UNSUPPORTED_IMAGE');
  dimensions(width, height);
  return { mime, width, height, orientation };
}

export async function decodeReference(
  file: File,
  id: string,
  signal?: AbortSignal
): Promise<ReferenceImage> {
  signal?.throwIfAborted();
  if (!id) throw new Error('INVALID_REFERENCE_ID');
  if (!file.size || file.size > REFERENCE_LIMITS.imageBytes)
    throw new Error('IMAGE_BYTE_LIMIT');
  const bytes = await file.arrayBuffer();
  signal?.throwIfAborted();
  const header = inspectReferenceBytes(new Uint8Array(bytes));
  // MIME comes from bytes, not a filename or supplied Content-Type. Bytes are unchanged.
  const blob = new Blob([bytes], { type: header.mime });
  const bitmap = await createImageBitmap(blob, {
    imageOrientation: 'from-image',
  });
  try {
    signal?.throwIfAborted();
    const rotated = header.orientation >= 5;
    const width = rotated ? header.height : header.width,
      height = rotated ? header.width : header.height;
    if (bitmap.width !== width || bitmap.height !== height)
      throw new Error('IMAGE_ORIENTATION_MISMATCH');
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    signal?.throwIfAborted();
    return {
      id,
      sha256: Array.from(new Uint8Array(digest), (b) =>
        b.toString(16).padStart(2, '0')
      ).join(''),
      kind: 'observed',
      width,
      height,
      sourceWidth: header.width,
      sourceHeight: header.height,
      sourceToImage: orientationTransform(header.orientation),
      blob,
    };
  } finally {
    bitmap.close();
  }
}
