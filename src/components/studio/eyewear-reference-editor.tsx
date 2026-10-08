import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Button } from '@/components/ui/button';
import { validateContour } from '@/lib/eyewear-3d/reconstruction/observations';
import type {
  PartId,
  PartObservation,
  ReferenceImage,
  SurfaceRole,
  SurfaceLandmark,
  Vec2,
} from '@/lib/eyewear-3d/reconstruction/types';

const parts: Partial<Record<PartId, string>> = {
  LeftLens: 'Left lens (image left)',
  RightLens: 'Right lens (image right)',
  LeftRim: 'Left rim, outer edge (image left)',
  RightRim: 'Right rim, outer edge (image right)',
  NoseBridge: 'Bridge',
  LeftTemple: 'Left temple (image left)',
  RightTemple: 'Right temple (image right)',
  LeftTip: 'Left temple tip',
  RightTip: 'Right temple tip',
  LensMarkings: 'Lens text / stickers',
};
export function useReferenceUrl(reference?: ReferenceImage) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!reference) {
      setUrl('');
      return;
    }
    const next = URL.createObjectURL(reference.blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [reference]);
  return url;
}
export default function EyewearReferenceEditor({
  reference,
  observations,
  onChange,
  onUndo,
}: {
  reference: ReferenceImage;
  observations: PartObservation[];
  onChange: (part: PartObservation) => void;
  onUndo: () => void;
}) {
  const url = useReferenceUrl(reference),
    [selected, setSelected] = useState<PartId>('LeftLens');
  const [mode, setMode] = useState<
      'contour' | 'outer' | 'landmarks' | 'surface'
    >('contour'),
    [featureIndex, setFeatureIndex] = useState(0);
  const featureAnchor = useRef<Vec2 | null>(null);
  const [drag, setDrag] = useState<{ index: number; points: Vec2[] } | null>(
      null
    ),
    svg = useRef<SVGSVGElement>(null);
  const part = observations.find(
    (p) => p.referenceId === reference.id && p.part === selected
  );
  useEffect(() => {
    setDrag(null);
    setFeatureIndex(0);
    featureAnchor.current = null;
  }, [reference.id]);
  useEffect(() => {
    const anchor = featureAnchor.current;
    if (!anchor) return;
    const next =
      part?.surfaceLandmarks?.findIndex(
        (f) =>
          Math.hypot(f.position[0] - anchor[0], f.position[1] - anchor[1]) <
          1e-9
      ) ?? -1;
    if (next >= 0) setFeatureIndex(next);
  }, [part?.surfaceLandmarks]);
  const isOuter = mode === 'outer',
    isSurface = mode === 'surface';
  const isContour = isOuter || mode === 'contour';
  const pointsKey = isOuter
    ? 'outerContour'
    : isContour
      ? 'contour'
      : 'landmarks';
  const confirmedKey = isOuter
    ? 'confirmedOuterContourIndices'
    : isContour
      ? 'confirmedContourIndices'
      : 'confirmedLandmarkIndices';
  const points =
    drag?.points ??
    (isSurface
      ? part?.surfaceLandmarks?.map((f) => f.position)
      : part?.[pointsKey]) ??
    [];
  const feature = part?.surfaceLandmarks?.[featureIndex];
  const location = (event: PointerEvent): Vec2 => {
    const rect = svg.current!.getBoundingClientRect();
    return [
      Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    ];
  };
  const save = (next: Vec2[], index?: number) => {
    const existing = part ?? {
      referenceId: reference.id,
      part: selected,
      contour: [],
      landmarks: [],
      visibility: 'partial',
      source: 'prior-estimated',
      quality: 'needs-review',
      issues: [],
    };
    if (isSurface) {
      if (index !== undefined && next[index])
        featureAnchor.current = next[index];
      const surfaceLandmarks: SurfaceLandmark[] = next.map((position, i) => {
        const old = existing.surfaceLandmarks?.[i];
        return {
          ...(old ?? {
            role: 'unknown',
            quality: 'needs-review',
            source: 'prior-estimated',
          }),
          position,
          ...(i === index || !old ? { source: 'user-confirmed' as const } : {}),
        };
      });
      onChange({
        ...existing,
        surfaceLandmarks,
        quality: 'needs-review',
        issues: ['MANUAL_EDIT_NEEDS_REVIEW'],
      });
      return;
    }
    const key = confirmedKey;
    const confirmed =
      index === undefined
        ? next.map((_, i) => i)
        : Array.from(
            new Set([
              ...(existing[key] ?? []).filter((i) => i < next.length),
              index,
            ])
          );
    onChange({
      ...existing,
      [pointsKey]: next,
      [key]: confirmed,
      visibility: 'partial',
      quality: 'needs-review',
      issues: ['MANUAL_EDIT_NEEDS_REVIEW'],
    });
  };
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="eyewear-part" className="text-sm">
          Part
        </label>
        <select
          id="eyewear-part"
          className="rounded-md border border-neutral-300 bg-white p-2 text-sm"
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value as PartId);
            setMode(
              e.target.value.endsWith('Rim')
                ? 'outer'
                : e.target.value.endsWith('Lens') ||
                    e.target.value === 'LensMarkings'
                  ? 'contour'
                  : 'landmarks'
            );
            setFeatureIndex(0);
            featureAnchor.current = null;
            setDrag(null);
          }}
        >
          {Object.entries(parts).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="Edit mode"
          value={mode}
          className="rounded-md border border-neutral-300 bg-white p-2 text-sm"
          onChange={(e) => {
            setMode(e.target.value as typeof mode);
            setDrag(null);
            setFeatureIndex(0);
            featureAnchor.current = null;
          }}
        >
          <option value="contour">Inner outline / region</option>
          <option value="outer">Outer outline</option>
          <option value="landmarks">Path / anchor points</option>
          <option value="surface">Surface details</option>
        </select>
        <Button variant="outline" size="sm" onClick={onUndo}>
          Undo
        </Button>
      </div>
      {isSurface && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select
            aria-label="Surface detail"
            value={featureIndex}
            disabled={!points.length}
            onChange={(e) => {
              const index = Number(e.target.value);
              setFeatureIndex(index);
              featureAnchor.current =
                part?.surfaceLandmarks?.[index]?.position ?? null;
            }}
            className="rounded-md border border-neutral-300 bg-white p-2"
          >
            {points.map((_, i) => (
              <option key={i} value={i}>
                Detail {i + 1}
              </option>
            ))}
          </select>
          <select
            aria-label="Detail face"
            value={feature?.role ?? 'unknown'}
            disabled={!feature}
            className="rounded-md border border-neutral-300 bg-white p-2"
            onChange={(e) =>
              part &&
              onChange({
                ...part,
                surfaceLandmarks: part.surfaceLandmarks!.map((f, i) =>
                  i === featureIndex
                    ? {
                        ...f,
                        role: e.target.value as SurfaceRole | 'unknown',
                        source: 'user-confirmed',
                      }
                    : f
                ),
              })
            }
          >
            <option value="unknown">Face unknown</option>
            <option value="front-cap">Front face</option>
            <option value="back-cap">Back face</option>
            <option value="outer-wall">Outer wall</option>
            <option value="aperture-wall">Lens-opening wall</option>
            <option value="bevel">Bevel</option>
          </select>
          <select
            aria-label="Detail confidence"
            value={feature?.quality ?? 'needs-review'}
            disabled={!feature}
            className="rounded-md border border-neutral-300 bg-white p-2"
            onChange={(e) =>
              part &&
              onChange({
                ...part,
                surfaceLandmarks: part.surfaceLandmarks!.map((f, i) =>
                  i === featureIndex
                    ? {
                        ...f,
                        quality: e.target.value as SurfaceLandmark['quality'],
                        source: 'user-confirmed',
                      }
                    : f
                ),
              })
            }
          >
            <option value="needs-review">Needs review</option>
            <option value="usable">Confirmed</option>
          </select>
        </div>
      )}
      <div
        className="relative overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100"
        style={{ aspectRatio: `${reference.width}/${reference.height}` }}
      >
        <img
          src={url || undefined}
          alt="Original product photo for comparison"
          className="absolute inset-0 h-full w-full"
        />
        <svg
          ref={svg}
          data-testid="reference-overlay"
          className="absolute inset-0 h-full w-full touch-none"
          viewBox={`0 0 ${reference.width} ${reference.height}`}
          onPointerDown={(event) => {
            if (
              event.target === event.currentTarget &&
              part?.visibility === 'hidden'
            )
              save([location(event)]);
          }}
          onPointerMove={(event) => {
            if (!drag) return;
            const next = drag.points.map((p, i) =>
              i === drag.index ? location(event) : p
            );
            setDrag({ ...drag, points: next });
          }}
          onPointerUp={() => {
            if (drag) {
              save(drag.points, drag.index);
              setDrag(null);
            }
          }}
          onPointerCancel={() => setDrag(null)}
        >
          {observations
            .filter(
              (p) =>
                p.referenceId === reference.id &&
                p.contour.length >= 3 &&
                p.part.endsWith('Lens') &&
                p.part !== selected
            )
            .map((p) => (
              <polygon
                key={p.part}
                points={p.contour
                  .map(
                    ([x, y]) => `${x * reference.width},${y * reference.height}`
                  )
                  .join(' ')}
                fill="none"
                stroke="#f59e0b"
                strokeWidth={reference.width * 0.0015}
                pointerEvents="none"
              />
            ))}
          {!isSurface &&
            points.length > 1 &&
            (isContour ? (
              <polygon
                points={points
                  .map(
                    ([x, y]) => `${x * reference.width},${y * reference.height}`
                  )
                  .join(' ')}
                fill="#10b98118"
                stroke="#10b981"
                strokeWidth={reference.width * 0.002}
                pointerEvents="none"
              />
            ) : (
              <polyline
                points={points
                  .map(
                    ([x, y]) => `${x * reference.width},${y * reference.height}`
                  )
                  .join(' ')}
                fill="none"
                stroke="#10b981"
                strokeWidth={reference.width * 0.002}
                pointerEvents="none"
              />
            ))}
          {points.map(([x, y], i) => (
            <circle
              key={i}
              cx={x * reference.width}
              cy={y * reference.height}
              r={reference.width * 0.004}
              fill="white"
              stroke="#059669"
              strokeWidth={reference.width * 0.0015}
              onPointerDown={(event) => {
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
                setDrag({ index: i, points: points.map((p) => [...p]) });
                if (isSurface) {
                  setFeatureIndex(i);
                  featureAnchor.current = points[i];
                }
              }}
            />
          ))}
          {part?.visibility === 'hidden' && !isSurface && (
            <rect
              width={reference.width}
              height={reference.height}
              fill="transparent"
              onPointerDown={(event) => save([...points, location(event)])}
            />
          )}
        </svg>
      </div>
      <p className="text-xs text-neutral-500">
        Drag the points to fix the outline. For a part that was not detected,
        add points along its path. These points are not real-size measurements.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            save([...points, [0.5, 0.5]], points.length);
            if (isSurface) setFeatureIndex(points.length);
          }}
        >
          Add point
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            save(points.slice(0, -1), Math.max(0, points.length - 2));
            setFeatureIndex(Math.max(0, points.length - 2));
          }}
          disabled={!points.length}
        >
          Remove last point
        </Button>
        <Button
          size="sm"
          disabled={
            isSurface
              ? !feature || feature.role === 'unknown'
              : isContour
                ? !validateContour(points)
                : points.length < 2
          }
          onClick={() =>
            part &&
            onChange(
              isSurface
                ? {
                    ...part,
                    surfaceLandmarks: part.surfaceLandmarks!.map((f, i) =>
                      i === featureIndex
                        ? { ...f, source: 'user-confirmed', quality: 'usable' }
                        : f
                    ),
                  }
                : {
                    ...part,
                    [pointsKey]: points,
                    visibility: 'visible',
                    quality: 'usable',
                    issues: [],
                    [confirmedKey]: points.map((_, i) => i),
                  }
            )
          }
        >
          Confirm this region
        </Button>
      </div>
    </section>
  );
}
