'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
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
  LeftRim: 'Biên trong gọng trái',
  RightRim: 'Biên trong gọng phải',
  NoseBridge: 'Cầu kính',
  LeftHinge: 'Bản lề trái',
  RightHinge: 'Bản lề phải',
  LeftTemple: 'Càng trái',
  RightTemple: 'Càng phải',
  LeftTip: 'Đuôi càng trái',
  RightTip: 'Đuôi càng phải',
  NosePads: 'Đệm mũi',
  LeftLens: 'Tròng trái',
  RightLens: 'Tròng phải',
  LensMarkings: 'Chữ / tem trên tròng',
};

export interface EyewearDraft {
  blob: Blob;
  candidate: ReconstructionCandidate;
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
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pendingApply.current?.abort();
      pendingInitial.current?.abort();
    };
  }, []);
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
    if (
      !onApplyDraft ||
      !candidate ||
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
      await onApplyDraft({ blob, candidate }, controller.signal);
    } catch (err) {
      if (mounted.current && !controller.signal.aborted)
        setExportError(
          err instanceof Error ? err.message : 'Không thể lưu mô hình.'
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
        throw new Error('Đường dẫn ảnh không hỗ trợ.');
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok)
        throw new Error('Không đọc được ảnh hiện tại. Hãy chọn ảnh từ máy.');
      const blob = await response.blob();
      if (!mounted.current || controller.signal.aborted) return;
      setImportedFile(null);
      await state.setReferences([
        new File([blob], 'product-reference', { type: blob.type }),
      ]);
    } catch (err) {
      if (mounted.current && !controller.signal.aborted)
        setExportError(
          err instanceof Error ? err.message : 'Không đọc được ảnh.'
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
        err instanceof Error ? err.message : 'Không thể tạo báo cáo GLB.'
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
                  'Thiếu bộ ảnh thật nhiều góc cùng SKU, duyệt sản phẩm và đo thiết bị AR.',
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
  return (
    <fieldset
      disabled={applying}
      className="mx-auto min-w-0 max-w-7xl space-y-5 p-4 md:p-6"
    >
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Dựng kính theo ảnh gốc</h1>
        <p className="text-sm text-muted-foreground">
          Có thể dựng từ một ảnh. Hệ thống giữ dáng, màu và họa tiết nhìn thấy,
          rồi suy luận phần khuất theo cấu trúc gọng kính. Nếu có nhiều ảnh,
          chọn ảnh chính diện làm ảnh chính và thêm ảnh hai bên của cùng mẫu,
          cùng màu để đối chiếu. Kiểm tra bản nháp trước khi dùng cho khách.
        </p>
      </header>
      <section className="flex flex-wrap items-end gap-3 rounded-xl border p-4">
        <label className="min-w-52 flex-1 space-y-2 text-sm">
          <span className="block font-medium">
            Ảnh sản phẩm (PNG, JPEG, WebP)
          </span>
          <input
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp"
            data-testid="reference-input"
            className="block w-full text-sm"
            disabled={loadingInitial}
            onChange={(event) => {
              setImportedFile(null);
              void state.setReferences(Array.from(event.target.files ?? []));
            }}
          />
        </label>
        {initialImageUrl && !state.references.length && (
          <Button
            variant="outline"
            disabled={busy || loadingInitial}
            onClick={() => void loadInitial()}
          >
            {loadingInitial ? 'Đang đọc ảnh…' : 'Dùng ảnh sản phẩm hiện tại'}
          </Button>
        )}
        <label className="space-y-1 text-sm">
          <span className="block">Bề ngang thật (mm), nếu biết</span>
          <input
            type="number"
            min={60}
            max={250}
            placeholder="Chưa biết — dùng ước lượng"
            className="w-52 rounded-md border bg-background p-2"
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
          {busy ? 'Đang xử lý…' : 'Dựng bản nháp 3D'}
        </Button>
        {busy && (
          <Button variant="outline" onClick={state.cancel}>
            Hủy
          </Button>
        )}
      </section>
      {exportError && (
        <p role="alert" className="text-sm text-destructive">
          {exportError}
        </p>
      )}
      {state.error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive p-3 text-sm text-destructive"
        >
          Không xử lý được: {state.error}. Ảnh gốc không bị sửa.
        </p>
      )}
      <div
        data-testid="quality-state"
        data-revision-state={state.status === 'draft' ? 'draft' : state.status}
        className="flex flex-wrap gap-2 text-sm"
      >
        <span>
          Trạng thái:{' '}
          {
            (
              {
                idle: 'Chờ ảnh',
                loading: 'Đang đọc ảnh',
                analyzing: 'Đang tìm đường biên',
                fitting: 'Đang khớp camera / hình học',
                draft: 'Bản nháp — cần kiểm tra',
                dirty: 'Đã đổi đầu vào — cần dựng lại',
                cancelled: 'Đã hủy',
                error: 'Có lỗi',
              } as const
            )[state.status]
          }
        </span>
        {candidate && (
          <span className="text-muted-foreground">
            · {candidate.measurements.frameWidth.mm.toFixed(1)} mm (
            {candidate.measurements.frameWidth.source === 'user-confirmed'
              ? 'bạn cung cấp'
              : 'ước lượng'}
            )
          </span>
        )}
      </div>
      {state.references.length === 1 && (
        <p className="text-sm text-muted-foreground">
          Dựng từ 1 ảnh: phần khuất, độ dày và chiều dài càng kính là ước lượng.
          Bạn có thể chỉnh đường biên hoặc bổ sung số đo để khớp sản phẩm hơn.
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
                Ảnh {i + 1}
                {i === 0 ? ' · Chính' : ''}
              </Button>
              {i > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => state.setPrimary(r.id)}
                >
                  Đặt chính
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="grid items-start gap-5 lg:grid-cols-2">
        {reference && (
          <div className="space-y-3">
            <h2 className="font-medium">Ảnh gốc & đường biên</h2>
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
              <h2 className="font-medium">Mô hình 3D</h2>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm">Góc xem</span>
                <select
                  aria-label="Góc xem mô hình"
                  className="rounded-md border bg-background p-2 text-sm"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as typeof mode)}
                >
                  <option value="match">Cùng góc ảnh gốc</option>
                  <option value="overlay">Chồng lên ảnh gốc</option>
                  <option value="orbit">Xoay tự do</option>
                  <option value="front">Chính diện</option>
                  <option value="left">Nghiêng trái</option>
                  <option value="right">Nghiêng phải</option>
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
                    {applying
                      ? 'Đang lưu mô hình…'
                      : 'Dùng mô hình đã kiểm tra cho sản phẩm'}
                  </Button>
                )}
                <Button
                  data-testid="export-glb"
                  disabled={!previewCurrent}
                  onClick={() => void exportModel()}
                >
                  Tải GLB nháp
                </Button>
                <Button
                  variant="outline"
                  disabled={!previewCurrent}
                  onClick={capture}
                >
                  Lưu ảnh render
                </Button>
                <Button
                  variant="outline"
                  disabled={!previewCurrent}
                  onClick={() => void report()}
                >
                  Báo cáo JSON
                </Button>
              </div>
              <label className="block text-sm">
                Nhập GLB để kiểm tra round-trip
                <input
                  data-testid="import-glb"
                  type="file"
                  accept=".glb"
                  className="mt-2 block text-sm"
                  onChange={(e) => setImportedFile(e.target.files?.[0] ?? null)}
                />
              </label>
            </>
          ) : (
            <div className="flex min-h-64 items-center justify-center rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              Tải một ảnh rồi dựng bản nháp để đối chiếu ở cùng góc chụp.
            </div>
          )}
        </div>
      </div>
      {candidate && selectedMaterial && (
        <div className="grid gap-4 md:grid-cols-2">
          <section className="space-y-3 rounded-xl border p-4">
            <h2 className="font-medium">
              Vật liệu từng bộ phận — cần xác nhận
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Bộ phận vật liệu"
                className="rounded border bg-background p-2"
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
                aria-label="Màu bộ phận"
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
                aria-label="Nguồn màu"
                className="rounded border bg-background p-2"
                value={selectedMaterial.colorMode ?? 'observed'}
                onChange={(e) =>
                  state.updateMaterial(part, {
                    ...selectedMaterial,
                    colorMode: e.target.value as 'observed' | 'override',
                    source: 'user-confirmed',
                  })
                }
              >
                <option value="observed">Màu từ ảnh gốc</option>
                <option value="override">Màu tự chọn</option>
              </select>
              <select
                aria-label="Loại bề mặt"
                className="rounded border bg-background p-2"
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
                <option value="plastic">Nhựa / chưa xác định</option>
                <option value="metal">Kim loại</option>
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  ['roughness', 'Độ nhám bề mặt', 0.3],
                  ['clearcoat', 'Lớp phủ bóng', 0],
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
                    className="w-full rounded border bg-background p-2"
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
            <p className="text-xs text-muted-foreground">
              Màu là ước lượng dưới ánh sáng ảnh chụp; không phải phép đo màu
              hay xác định hợp kim.
            </p>
          </section>
          <section className="space-y-3 rounded-xl border p-4">
            <h2 className="font-medium">
              Tròng — không lấy nền ảnh làm texture
            </h2>
            <div className="flex flex-wrap gap-2">
              <select
                aria-label="Loại tròng"
                className="rounded border bg-background p-2"
                value={candidate.lens.mode}
                onChange={(e) =>
                  state.updateLens({
                    ...candidate.lens,
                    mode: e.target.value as LensDescriptor['mode'],
                    source: 'user-confirmed',
                  })
                }
              >
                <option value="clear">Trong suốt</option>
                <option value="tinted">Nhuộm màu</option>
                <option value="gradient">Gradient</option>
                <option value="mirror">Tráng gương</option>
              </select>
              <input
                aria-label="Màu trên tròng"
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
                  aria-label="Màu dưới tròng"
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
            <p className="text-xs text-muted-foreground">
              Chưa mô phỏng đơn kính. Chữ / tem chưa tách sạch được giữ trong
              ảnh gốc và không tự dựng lại trên tròng.
            </p>
          </section>
          <section className="space-y-2 rounded-xl border p-4 md:col-span-2">
            <h2 className="font-medium">Đối chiếu ảnh thật</h2>
            {candidate.reports.map((r, i) => (
              <div key={r.referenceId} className="space-y-2 text-sm">
                <p>
                  Ảnh {i + 1} — sai lệch biên 2D đã nhận diện:{' '}
                  {r.contourError === null
                    ? 'chưa đủ dữ liệu'
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
                          error.missing
                            ? 'text-destructive'
                            : 'text-muted-foreground'
                        }
                      >
                        {error.missing
                          ? 'Chưa đối chiếu đủ'
                          : [
                              error.contour !== null
                                ? `biên ${error.contour.toFixed(4)}`
                                : null,
                              error.landmarks !== null
                                ? `điểm ${error.landmarks.toFixed(4)}`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                      </dd>
                    </div>
                  ))}
                </dl>
                <details className="text-xs text-muted-foreground">
                  <summary>Giới hạn / cảnh báo</summary>
                  <p className="pt-1">{r.issues.join(', ')}</p>
                </details>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Sai lệch tọa độ ảnh chuẩn hóa, không phải tỷ lệ chính xác của
              kính. Biên tròng khớp không chứng minh gọng, càng, màu hay phần
              khuất đúng. Chiều sâu và kích thước chưa cung cấp vẫn là ước
              lượng. Chưa xuất bản cho khách và chưa xác nhận độ vừa.
            </p>
          </section>
        </div>
      )}
    </fieldset>
  );
}
