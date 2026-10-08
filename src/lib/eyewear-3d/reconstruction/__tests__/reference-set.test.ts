import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import {
  inspectReferenceBytes,
  orientationTransform,
  validateReferenceSet,
} from '../reference-set';
import type { ReferenceImage } from '../types';

const ref: ReferenceImage = {
  id: 'one',
  sha256: 'a'.repeat(64),
  kind: 'observed',
  width: 1536,
  height: 2048,
  sourceWidth: 1536,
  sourceHeight: 2048,
  sourceToImage: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  blob: new Blob(['fixture'], { type: 'image/png' }),
};

test('one observed image is sufficient and primary is ordered without mutating inputs', () => {
  expect(validateReferenceSet([ref], 'one')).toEqual([ref]);
  const refs = [ref, { ...ref, id: 'two' }];
  expect(validateReferenceSet(refs, 'two').map((r) => r.id)).toEqual([
    'two',
    'one',
  ]);
  expect(refs[0].id).toBe('one');
  expect(
    validateReferenceSet(
      Array.from({ length: 6 }, (_, i) => ({ ...ref, id: String(i) })),
      '0'
    )
  ).toHaveLength(6);
});

test.each([
  [[], 'one', 'REFERENCE_COUNT'],
  [
    Array.from({ length: 7 }, (_, i) => ({ ...ref, id: String(i) })),
    '0',
    'REFERENCE_COUNT',
  ],
  [[ref, ref], 'one', 'DUPLICATE_REFERENCE_ID'],
  [[ref], 'missing', 'PRIMARY_NOT_FOUND'],
  [[{ ...ref, kind: 'generated' }], 'one', 'PRIMARY_MUST_BE_OBSERVED'],
  [[{ ...ref, width: NaN }], 'one', 'INVALID_DIMENSIONS'],
  [[{ ...ref, width: 8000, height: 8000 }], 'one', 'IMAGE_PIXEL_LIMIT'],
  [
    [{ ...ref, sourceToImage: [0, 0, 0, 0, 0, 0, 0, 0, 0] }],
    'one',
    'INVALID_TRANSFORM',
  ],
  [
    [{ ...ref, blob: new Blob(['x'], { type: 'text/html' }) }],
    'one',
    'UNSUPPORTED_IMAGE',
  ],
  [
    [
      {
        ...ref,
        blob: new Blob([new Uint8Array(12 * 1024 * 1024 + 1)], {
          type: 'image/png',
        }),
      },
    ],
    'one',
    'IMAGE_BYTE_LIMIT',
  ],
] as const)('rejects invalid references (%s)', (refs, primary, reason) => {
  expect(() =>
    validateReferenceSet(refs as unknown as ReferenceImage[], primary)
  ).toThrow(reason);
});

test('batch byte limit includes all originals', () => {
  const blob = new Blob([new Uint8Array(10 * 1024 * 1024)], {
    type: 'image/png',
  });
  expect(() =>
    validateReferenceSet(
      Array.from({ length: 5 }, (_, i) => ({ ...ref, id: String(i), blob })),
      '0'
    )
  ).toThrow('BATCH_BYTE_LIMIT');
});

test('header inspection uses original bytes, not extension or claimed MIME', () => {
  const data = readFileSync('public/glasses/glasses-real.png');
  expect(inspectReferenceBytes(new Uint8Array(data))).toEqual({
    mime: 'image/png',
    width: 1536,
    height: 2048,
    orientation: 1,
  });
  expect(() =>
    inspectReferenceBytes(new TextEncoder().encode('<svg></svg>'))
  ).toThrow('UNSUPPORTED_IMAGE');
  expect(() => inspectReferenceBytes(data.subarray(0, 12))).toThrow();
});

test.each(['jpeg', 'png', 'webp'] as const)(
  'reads %s dimensions and EXIF orientation before decode',
  async (format) => {
    const bytes = await sharp({
      create: { width: 12, height: 8, channels: 3, background: '#114488' },
    })
      .toFormat(format)
      .withMetadata({ orientation: 6 })
      .toBuffer();
    expect(inspectReferenceBytes(bytes)).toEqual({
      mime: `image/${format}`,
      width: 12,
      height: 8,
      orientation: 6,
    });
  }
);

test.each([
  [1, [0.2, 0.3]],
  [2, [0.8, 0.3]],
  [3, [0.8, 0.7]],
  [4, [0.2, 0.7]],
  [5, [0.3, 0.2]],
  [6, [0.7, 0.2]],
  [7, [0.7, 0.8]],
  [8, [0.3, 0.8]],
] as const)(
  'EXIF orientation %i maps normalized raw coordinates correctly',
  (orientation, expected) => {
    const m = orientationTransform(orientation);
    expect(m[0] * 0.2 + m[1] * 0.3 + m[2]).toBeCloseTo(expected[0]);
    expect(m[3] * 0.2 + m[4] * 0.3 + m[5]).toBeCloseTo(expected[1]);
  }
);
