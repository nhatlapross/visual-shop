import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { exportEyewearToGLB, downloadGLBBlob } from '@/lib/eyewear-3d/exporter';
import { resolvePartMaterialDescriptor } from '@/lib/eyewear-3d/reconstruction/materials';
import { readAssetMetadata } from '@/lib/eyewear-3d/reconstruction/asset';
import {
  inspectFrontFrames,
  inspectPartMaterials,
} from '@/lib/eyewear-3d/reconstruction/inspection';
import type {
  LensDescriptor,
  PartId,
  ReconstructionCandidate,
} from '@/lib/eyewear-3d/reconstruction/types';
import EyewearReferenceEditor from './eyewear-reference-editor';
import EyewearComparisonView, {
  type EyewearPreview,
} from './eyewear-comparison-view';
import { useEyewearReconstruction } from './use-eyewear-reconstruction';

const PART_LABELS: Record<PartId, string> = {
  LeftRim: 'Left rim',
  RightRim: 'Right rim',
  NoseBridge: 'Bridge',
  LeftHinge: 'Left hinge',
  RightHinge: 'Right hinge',
  LeftTemple: 'Left temple',
  RightTemple: 'Right temple',
  LeftTip: 'Left temple tip',
  RightTip: 'Right temple tip',
  NosePads: 'Nose pads',
  LeftLens: 'Left lens',
  RightLens: 'Right lens',
  LensMarkings: 'Lens text / stickers',
};

const STATUS_LABELS = {
  idle: 'Waiting for photos',
  loading: 'Reading photos',
  analyzing: 'Finding the frame outline',
  fitting: 'Fitting camera and geometry',
  draft: 'Draft ready — please review',
  dirty: 'Inputs changed — rebuild needed',
  cancelled: 'Cancelled',
  error: 'Error',
} as const;

/** Plain-English messages for the error codes thrown by the reconstruction library. */
const ERROR_MESSAGES: Record<string, string> = {
  REFERENCE_COUNT: 'Choose between 1 and 6 photos',
  BATCH_BYTE_LIMIT: 'the photos are too large together (48 MB max)',
  IMAGE_BYTE_LIMIT: 'each photo must be under 12 MB',
  IMAGE_PIXEL_LIMIT: 'a photo has too many pixels (40 MP max)',
  UNSUPPORTED_IMAGE: 'use PNG, JPEG or WebP photos',
  INVALID_IMAGE_HEADER: 'a photo file looks damaged',
  ANIMATED_IMAGE_UNSUPPORTED: 'animated images are not supported',
  INVALID_IMAGE: 'a photo could not be read',
  WORKER_UNAVAILABLE: 'the 3D engine could not start in this browser',
  IMAGE_CONTEXT_UNAVAILABLE: 'the browser could not decode the photo',
  RECONSTRUCTION_FAILED: 'the 3D reconstruction failed',
};

export interface EyewearDraft {
  blob: Blob;
  candidate: ReconstructionCandidate;
  /** Original bytes of the main (primary) reference photo the draft was fitted to. */
  photo: Blob;
}
interface EyewearLabProps {
  initialImageUrl?: string | null;
  onApplyDraft?: (draft: EyewearDraft, signal: AbortSignal) => Promise<void>;
}

export default function EyewearLab({
  initialImageUrl,
  onApplyDraft,
}: EyewearLabProps = {}) {
  const state = useEyewearReconstruction(),
    [referenceId, setReferenceId] = useState(''),
    [mode, setMode] = useState<
      'match' | 'overlay' | 'orbit' | 'front' | 'left' | 'right'
    >('match');
  const [importedFile, setImportedFile] = useState<File | null>(null),
    [exportError, setExportError] = useState(''),
    [ready, setReady] = useState<EyewearPreview | null>(null),
    [applying, setApplying] = useState(false),
    [loadingInitial, setLoadingInitial] = useState(false),
    [part, setPart] = useState<PartId>('LeftRim');
  const preview = useRef<EyewearPreview | null>(null),
    onReady = useCallback((value: EyewearPreview | null) => {
      preview.current = value;
      // A new camera can finish in the same React batch as the old preview's
      // cleanup. Keep its identity so a ready-to-ready change still rerenders.
      setReady(value);
    }, []);
  const reference =
      state.references.find((r) => r.id === referenceId) ?? state.references[0],
    candidate = state.candidate;
  const selectedMaterial = candidate
    ? resolvePartMaterialDescriptor(candidate, part)
    : null;
  const busy = ['loading', 'analyzing', 'fitting'].includes(state.status);
  const mounted = useRef(true);
  const pendingApply = useRef<AbortController | null>(null);
  const pendingInitial = useRef<AbortController | null>(null);
  // Fit automatically once the outline analysis of a fresh photo set finishes,
  // so a seller only has to pick photos. Later edits still need "Rebuild".
  const autoFit = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pendingApply.current?.abort();
      pendingInitial.current?.abort();
    };
  }, []);
  const { status, reconstruct } = state;
  useEffect(() => {
    if (status === 'error' || status === 'cancelled') autoFit.current = false;
    if (status !== 'dirty' || !autoFit.current) return;
    autoFit.current = false;
    reconstruct();
  }, [status, reconstruct]);
  useEffect(() => {
    pendingApply.current?.abort();
  }, [state.revision, reference?.id, mode, importedFile]);
  const currentRevision = useRef(state.revision);
  currentRevision.current = state.revision;
  const previewCurrent =
    !!ready &&
    preview.current?.inputRevision === candidate?.inputRevision &&
    preview.current?.referenceId === reference?.id &&
    preview.current?.mode === mode &&
    preview.current?.importedFile === importedFile &&
    state.status === 'draft';
  const exportModel = async () => {
    try {
      if (!preview.current || !previewCurrent) return;
      const activePreview = preview.current,
        revision = state.revision;
      setExportError('');
      const blob = await exportEyewearToGLB(preview.current.model);
      if (
        !mounted.current ||
        preview.current !== activePreview ||
        currentRevision.current !== revision
      )
        return;
      downloadGLBBlob(
        blob,
        `eyewear-${candidate!.inputRevision.slice(0, 12)}.glb`
      );
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'EXPORT_FAILED');
    }
  };
  const applyDraft = async () => {
    const photo = state.references[0]?.blob;
    if (
      !onApplyDraft ||
      !candidate ||
      !photo ||
      !preview.current ||
      !previewCurrent ||
      importedFile ||
      applying
    )
      return;
    const activePreview = preview.current;
    const revision = state.revision;
    const controller = new AbortController();
    pendingApply.current?.abort();
    pendingApply.current = controller;
    setApplying(true);
    setExportError('');
    try {
      const blob = await exportEyewearToGLB(activePreview.model);
      if (
        !mounted.current ||
        controller.signal.aborted ||
        preview.current !== activePreview ||
        currentRevision.current !== revision
      )
        return;
      await onApplyDraft({ blob, candidate, photo }, controller.signal);
    } catch (err) {
      if (mounted.current && !controller.signal.aborted)
        setExportError(
          err instanceof Error ? err.message : 'Could not save the model.'
        );
    } finally {
      if (pendingApply.current === controller) {
        pendingApply.current = null;
        if (mounted.current) setApplying(false);
      }
    }
  };
  const loadInitial = async () => {
    if (!initialImageUrl) return;
    const controller = new AbortController();
    pendingInitial.current?.abort();
    pendingInitial.current = controller;
    setLoadingInitial(true);
    setExportError('');
    try {
      const url = new URL(initialImageUrl, window.location.href);
      if (!['https:', 'http:', 'blob:'].includes(url.protocol))
        throw new Error('This image URL is not supported.');
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok)
        throw new Error(
          'Could not load the current photo. Choose one from your device.'
        );
      const blob = await response.blob();
      if (!mounted.current || controller.signal.aborted) return;
      setImportedFile(null);
      autoFit.current = true;
      await state.setReferences([
        new File([blob], 'product-reference', { type: blob.type }),
      ]);
    } catch (err) {
      if (mounted.current && !controller.signal.aborted)
        setExportError(
          err instanceof Error ? err.message : 'Could not read the photo.'
        );
    } finally {
      if (mounted.current && pendingInitial.current === controller)
        setLoadingInitial(false);
    }
  };
  const capture = () => {
    if (!preview.current || !previewCurrent) return;
    const link = document.createElement('a');
    link.href = preview.current.capture();
    link.download = `eyewear-${mode}.png`;
    link.click();
  };
  const report = async () => {
    if (!candidate || !preview.current || !previewCurrent) return;
    const activePreview = preview.current,
      revision = state.revision;
    let glbBytes: number;
    try {
      glbBytes = (await exportEyewearToGLB(activePreview.model)).size;
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : 'Could not create the GLB report.'
      );
      return;
    }
    if (
      !mounted.current ||
      preview.current !== activePreview ||
      currentRevision.current !== revision
    )
      return;
    const model = preview.current.model,
      parts = inspectPartMaterials(model),
      physicalNodes: object[] = [];
    model.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        physicalNodes.push({
          name: o.name,
          vertices: o.geometry.getAttribute('position').count,
          triangles:
            (o.geometry.index?.count ??
              o.geometry.getAttribute('position').count) / 3,
        });
      }
    });
    downloadGLBBlob(
      new Blob(
        [
          JSON.stringify(
            {
              candidate,
              observations: state.observations,
              silhouette: preview.current.captureSilhouette(),
              metadata: readAssetMetadata(model),
              parts,
              physicalNodes,
              frontFrames: inspectFrontFrames(model),
              metrics: {
                fit: candidate.metrics ?? null,
                atlas: model.userData.atlasMetrics ?? null,
                renderer: activePreview.metrics(),
                glbBytes,
              },
              verification: {
                realMultiView: 'unverified',
                visualApproval: 'unverified',
                customerReady: false,
                reason:
                  'Missing a real multi-angle photo set of the same SKU, a product review and an AR device measurement.',
              },
              dimensions: new THREE.Box3()
                .setFromObject(model)
                .getSize(new THREE.Vector3())
                .toArray(),
              automatic: state.observations.every(
                (p) =>
                  p.source !== 'user-confirmed' &&
                  !p.confirmedContourIndices?.length &&
                  !p.confirmedOuterContourIndices?.length &&
                  !p.confirmedLandmarkIndices?.length &&
                  !p.surfaceLandmarks?.some(
                    (f) => f.source === 'user-confirmed'
                  )
              ),
              references: state.references.map(({ blob, ...r }) => ({
                ...r,
                bytes: blob.size,
              })),
              validation: 'draft; not visually approved',
            },
            null,
            2
          ),
        ],
        { type: 'application/json' }
      ),
      'eyewear-report.json'
    );
  };
  const field =
    'rounded-md border border-neutral-300 bg-white p-2 text-sm disabled:opacity-50';
  return (
    <fieldset disabled={applying} className="min-w-0 space-y-5">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">
          Build a 3D model from your photos
        </h2>
        <p className="text-sm text-neutral-500">
          One photo is enough. We keep the visible shape, color and pattern,
          and infer the hidden parts from how frames are built. With several
          photos, make the straight-on front view the main photo and add side
          views of the same model and color. Review the draft before you list
          it.
        </p>
      </header>
      <section className="flex flex-wrap items-end gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
        <label className="min-w-52 flex-1 space-y-2 text-sm">
          <span className="block font-medium">
            Product photos (PNG, JPEG, WebP · up to 6)
          </span>
          <input
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp"
            data-testid="reference-input"
            className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-neutral-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-neutral-800"
            disabled={loadingInitial}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              setImportedFile(null);
              autoFit.current = files.length > 0;
              void state.setReferences(files);
            }}
          />
        </label>
        {initialImageUrl && !state.references.length && (
          <Button
            variant="outline"
            disabled={busy || loadingInitial}
            onClick={() => void loadInitial()}
          >
            {loadingInitial ? 'Loading photo…' : 'Use the current product photo'}
          </Button>
        )}
        <label className="space-y-1 text-sm">
          <span className="block">Real frame width (mm), if known</span>
          <input
            type="number"
            min={60}
            max={250}
            placeholder="Unknown — estimate it"
            className={`w-52 ${field}`}
            value={state.measurements.frameWidth?.mm ?? ''}
            onChange={(e) =>
              state.setMeasurement(
                'frameWidth',
                e.target.value ? Number(e.target.value) : null
              )
            }
          />
        </label>
        <Button
          data-testid="reconstruct"
          disabled={!state.references.length || busy || loadingInitial}
          onClick={() => {
            setImportedFile(null);
            state.reconstruct();
          }}
        >
          {busy ? 'Working…' : candidate ? 'Rebuild 3D draft' : 'Build 3D draft'}
        </Button>
        {busy && (
          <Button variant="outline" onClick={state.cancel}>
            Cancel
          </Button>
        )}
      </section>
      {exportError && (
        <p role="alert" className="text-sm text-red-600">
          {exportError}
        </p>
      )}
      {state.error && (
        <p
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700"
        >
          Could not process the photos:{' '}
          {ERROR_MESSAGES[state.error] ?? state.error}. Your original photos
          were not changed.
        </p>
      )}
      <div
        data-testid="quality-state"
        data-revision-state={state.status === 'draft' ? 'draft' : state.status}
        className="flex flex-wrap items-center gap-2 text-sm"
      >
        {busy && <Loader2 className="size-4 animate-spin text-neutral-500" />}
        <span>
          <span className="text-neutral-500">Status:</span>{' '}
          <span className="font-medium">{STATUS_LABELS[state.status]}</span>
        </span>
        {candidate && (
          <span className="text-neutral-500">
            · {candidate.measurements.frameWidth.mm.toFixed(1)} mm wide (
            {candidate.measurements.frameWidth.source === 'user-confirmed'
              ? 'provided by you'
              : 'estimated'}
            )
          </span>
        )}
      </div>
      {state.references.length === 1 && (
        <p className="text-sm text-neutral-500">
          Built from 1 photo: hidden parts, thickness and temple length are
          estimates. You can adjust the outline or add a measurement for a
          closer match.
        </p>
      )}
      {state.references.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {state.references.map((r, i) => (
            <div key={r.id} className="flex items-center gap-1">
              <Button
                size="sm"
                variant={r.id === reference?.id ? 'default' : 'outline'}
                onClick={() => setReferenceId(r.id)}
              >
                Photo {i + 1}
                {i === 0 ? ' · Main' : ''}
              </Button>
              {i > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => state.setPrimary(r.id)}
                >
                  Make main
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="grid items-start gap-5 lg:grid-cols-2">
        {reference && (
          <div className="space-y-3">
            <h3 className="font-medium">Photo &amp; outline</h3>
            <EyewearReferenceEditor
              reference={reference}
              observations={state.observations}
              onChange={state.updateObservation}
              onUndo={state.undo}
            />
          </div>
        )}
        <div className="space-y-3">
          {candidate && reference ? (
            <>
              <h3 className="font-medium">3D model</h3>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm">View</span>
                <select
                  aria-label="Model view angle"
                  className={field}
                  value={mode}
                  onChange={(e) => setMode(e.target.value as typeof mode)}
                >
                  <option value="match">Same angle as the photo</option>
                  <option value="overlay">Overlay on the photo</option>
                  <option value="orbit">Free orbit</option>
                  <option value="front">Front</option>
                  <option value="left">Left side</option>
                  <option value="right">Right side</option>
                </select>
              </div>
              <EyewearComparisonView
                candidate={candidate}
                references={state.references}
                observations={state.observations}
                referenceId={reference.id}
                mode={mode}
                onReady={onReady}
                importedFile={importedFile}
              />
              <div className="flex flex-wrap gap-2">
                {onApplyDraft && (
                  <Button
                    data-testid="apply-reference-model"
                    disabled={!previewCurrent || !!importedFile || applying}
                    onClick={() => void applyDraft()}
                  >
                    {applying ? 'Saving model…' : 'Use this model'}
                  </Button>
                )}
                <Button
                  data-testid="export-glb"
                  variant={onApplyDraft ? 'outline' : 'default'}
                  disabled={!previewCurrent}
                  onClick={() => void exportModel()}
                >
                  Download draft GLB
                </Button>
                <Button
                  variant="outline"
                  disabled={!previewCurrent}
                  onClick={capture}
                >
                  Save render
                </Button>
              </div>
              <details className="text-sm">
                <summary className="cursor-pointer text-neutral-500">
                  Advanced tools
                </summary>
                <div className="space-y-3 pt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!previewCurrent}
                    onClick={() => void report()}
                  >
                    JSON report
                  </Button>
                  <label className="block">
                    Import a GLB to check the round-trip
                    <input
                      data-testid="import-glb"
                      type="file"
                      accept=".glb"
                      className="mt-2 block text-sm"
                      onChange={(e) =>
                        setImportedFile(e.target.files?.[0] ?? null)
                      }
                    />
                  </label>
                </div>
              </details>
            </>
          ) : (
            <div className="flex min-h-64 items-center justify-center rounded-xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
              {busy
                ? 'Building your 3D draft…'
                : 'Upload a photo and we will build a 3D draft you can compare at the same camera angle.'}
            </div>
          )}
        </div>
      </div>
      {candidate && selectedMaterial && (
        <div className="grid gap-4 md:grid-cols-2">
          <section className="space-y-3 rounded-xl border border-neutral-200 p-4">
            <h3 className="font-medium">Materials per part — please confirm</h3>
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Material part"
                className={field}
                value={part}
                onChange={(e) => setPart(e.target.value as PartId)}
              >
                {(
                  [
                    'LeftRim',
                    'RightRim',
                    'NoseBridge',
                    'LeftTemple',
                    'RightTemple',
                    'LeftTip',
                    'RightTip',
                  ] as PartId[]
                ).map((p) => (
                  <option key={p} value={p}>
                    {PART_LABELS[p]}
                  </option>
                ))}
              </select>
              <input
                aria-label="Part color"
                type="color"
                disabled={
                  (selectedMaterial.colorMode ?? 'observed') !== 'override'
                }
                value={selectedMaterial.color}
                onChange={(e) =>
                  state.updateMaterial(part, {
                    ...selectedMaterial,
                    color: e.target.value,
                    source: 'user-confirmed',
                    colorMode: 'override',
                  })
                }
              />
              <select
                aria-label="Color source"
                className={field}
                value={selectedMaterial.colorMode ?? 'observed'}
                onChange={(e) =>
                  state.updateMaterial(part, {
                    ...selectedMaterial,
                    colorMode: e.target.value as 'observed' | 'override',
                    source: 'user-confirmed',
                  })
                }
              >
                <option value="observed">Color from photo</option>
                <option value="override">Custom color</option>
              </select>
              <select
                aria-label="Surface type"
                className={field}
                value={selectedMaterial.metalness > 0.5 ? 'metal' : 'plastic'}
                onChange={(e) =>
                  state.updateMaterial(part, {
                    ...selectedMaterial,
                    colorMode: selectedMaterial.colorMode ?? 'observed',
                    metalness: e.target.value === 'metal' ? 0.95 : 0,
                    roughness: e.target.value === 'metal' ? 0.2 : 0.35,
                    source: 'user-confirmed',
                  })
                }
              >
                <option value="plastic">Plastic / unknown</option>
                <option value="metal">Metal</option>
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  ['roughness', 'Surface roughness', 0.3],
                  ['clearcoat', 'Clear coat', 0],
                ] as const
              ).map(([key, label, fallback]) => (
                <label key={key} className="space-y-1 text-sm">
                  <span className="block">{label} (0–1)</span>
                  <input
                    aria-label={label}
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    className={`w-full ${field}`}
                    value={selectedMaterial[key] ?? fallback}
                    onChange={(event) => {
                      const value = event.target.valueAsNumber;
                      if (!Number.isFinite(value)) return;
                      state.updateMaterial(part, {
                        ...selectedMaterial,
                        colorMode: selectedMaterial.colorMode ?? 'observed',
                        [key]: Math.max(0, Math.min(1, value)),
                        source: 'user-confirmed',
                      });
                    }}
                  />
                </label>
              ))}
            </div>
            <p className="text-xs text-neutral-500">
              Colors are estimated under the photo&apos;s lighting. This is not
              a color measurement or an alloy identification.
            </p>
          </section>
          <section className="space-y-3 rounded-xl border border-neutral-200 p-4">
            <h3 className="font-medium">
              Lenses — the photo background is not used as texture
            </h3>
            <div className="flex flex-wrap gap-2">
              <select
                aria-label="Lens type"
                className={field}
                value={candidate.lens.mode}
                onChange={(e) =>
                  state.updateLens({
                    ...candidate.lens,
                    mode: e.target.value as LensDescriptor['mode'],
                    source: 'user-confirmed',
                  })
                }
              >
                <option value="clear">Clear</option>
                <option value="tinted">Tinted</option>
                <option value="gradient">Gradient</option>
                <option value="mirror">Mirrored</option>
              </select>
              <input
                aria-label="Lens top color"
                type="color"
                value={candidate.lens.colorTop}
                onChange={(e) =>
                  state.updateLens({
                    ...candidate.lens,
                    colorTop: e.target.value,
                    source: 'user-confirmed',
                  })
                }
              />
              {candidate.lens.mode === 'gradient' && (
                <input
                  aria-label="Lens bottom color"
                  type="color"
                  value={candidate.lens.colorBottom}
                  onChange={(e) =>
                    state.updateLens({
                      ...candidate.lens,
                      colorBottom: e.target.value,
                      source: 'user-confirmed',
                    })
                  }
                />
              )}
            </div>
            <p className="text-xs text-neutral-500">
              Prescription lenses are not simulated. Text or stickers that
              could not be separated cleanly stay in the photo and are not
              rebuilt on the lens.
            </p>
          </section>
          <section className="space-y-2 rounded-xl border border-neutral-200 p-4 md:col-span-2">
            <h3 className="font-medium">Comparison with the photo</h3>
            {candidate.reports.map((r, i) => (
              <div key={r.referenceId} className="space-y-2 text-sm">
                <p>
                  Photo {i + 1} — detected 2D outline error:{' '}
                  {r.contourError === null
                    ? 'not enough data'
                    : r.contourError.toFixed(4)}
                </p>
                <dl
                  className="grid gap-x-6 gap-y-1 sm:grid-cols-2"
                  data-testid="comparison-coverage"
                >
                  {Object.entries(r.partErrors ?? {}).map(([name, error]) => (
                    <div key={name} className="flex justify-between gap-2">
                      <dt>{PART_LABELS[name as PartId]}</dt>
                      <dd
                        className={
                          error.missing ? 'text-red-600' : 'text-neutral-500'
                        }
                      >
                        {error.missing
                          ? 'Not fully compared'
                          : [
                              error.contour !== null
                                ? `outline ${error.contour.toFixed(4)}`
                                : null,
                              error.landmarks !== null
                                ? `points ${error.landmarks.toFixed(4)}`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                      </dd>
                    </div>
                  ))}
                </dl>
                <details className="text-xs text-neutral-500">
                  <summary className="cursor-pointer">Limits / warnings</summary>
                  <p className="pt-1">{r.issues.join(', ')}</p>
                </details>
              </div>
            ))}
            <p className="text-xs text-neutral-500">
              Errors are in normalized image coordinates, not the real scale of
              the frame. A matching lens outline does not prove that the frame,
              temples, color or hidden parts are right. Depth and any size you
              did not enter are still estimates.
            </p>
          </section>
        </div>
      )}
    </fieldset>
  );
}
