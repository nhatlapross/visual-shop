'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  decodeReference,
  validateReferenceSet,
} from '@/lib/eyewear-3d/reconstruction/reference-set';
import {
  acceptWorkerResult,
  replaceObservation,
} from '@/lib/eyewear-3d/reconstruction/controller';
import type {
  LensDescriptor,
  MaterialDescriptor,
  Measurement,
  PartId,
  PartObservation,
  ReconstructionCandidate,
  ReferenceImage,
} from '@/lib/eyewear-3d/reconstruction/types';

export function useEyewearReconstruction() {
  const [references, setRefs] = useState<ReferenceImage[]>([]),
    [observations, setObservations] = useState<PartObservation[]>([]);
  const [candidate, setCandidate] = useState<ReconstructionCandidate | null>(
      null
    ),
    [status, setStatus] = useState<
      | 'idle'
      | 'loading'
      | 'analyzing'
      | 'fitting'
      | 'draft'
      | 'dirty'
      | 'cancelled'
      | 'error'
    >('idle');
  const [error, setError] = useState<string | null>(null),
    [revision, setRevision] = useState(''),
    [measurements, setMeasures] = useState<Record<string, Measurement>>({});
  const worker = useRef<Worker | null>(null),
    active = useRef(''),
    loadController = useRef<AbortController | null>(null),
    history = useRef<PartObservation[][]>([]),
    geometryFresh = useRef(false),
    materialOverrides = useRef<Partial<Record<PartId, MaterialDescriptor>>>({}),
    lensOverride = useRef<LensDescriptor | null>(null);
  const invalidate = useCallback(() => {
    worker.current?.terminate();
    worker.current = null;
    loadController.current?.abort();
    const next = crypto.randomUUID();
    active.current = next;
    setRevision(next);
    setError(null);
    return next;
  }, []);
  useEffect(
    () => () => {
      active.current = '';
      worker.current?.terminate();
      loadController.current?.abort();
    },
    []
  );
  const run = useCallback(
    (
      kind: 'analyze' | 'fit',
      refs: ReferenceImage[],
      parts: PartObservation[],
      measures: Record<string, Measurement>
    ) => {
      const inputRevision = invalidate();
      geometryFresh.current = false;
      try {
        const w = new Worker(
          new URL(
            '../../lib/eyewear-3d/reconstruction/fit.worker.ts',
            import.meta.url
          ),
          { type: 'module' }
        );
        worker.current = w;
        setStatus(kind === 'analyze' ? 'analyzing' : 'fitting');
        w.onmessage = (event) => {
          const response = event.data;
          if (!acceptWorkerResult(active.current, response.inputRevision))
            return;
          if (response.kind === 'progress') return;
          w.terminate();
          worker.current = null;
          if (response.kind === 'error') {
            setError(response.error);
            setStatus('error');
            return;
          }
          setObservations(response.observations);
          if (response.kind === 'result') {
            geometryFresh.current = true;
            setCandidate({
              ...response.candidate,
              materials: {
                ...response.candidate.materials,
                ...materialOverrides.current,
              },
              lens: lensOverride.current ?? response.candidate.lens,
            });
            setStatus('draft');
          } else setStatus('dirty');
        };
        w.onerror = () => {
          if (active.current !== inputRevision) return;
          w.terminate();
          worker.current = null;
          setError('WORKER_UNAVAILABLE');
          setStatus('error');
        };
        w.postMessage({
          kind,
          inputRevision,
          references: refs,
          observations: parts,
          measurements: measures,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'WORKER_UNAVAILABLE');
        setStatus('error');
      }
    },
    [invalidate]
  );
  const setReferences = useCallback(
    async (files: File[]) => {
      const inputRevision = invalidate(),
        controller = new AbortController();
      geometryFresh.current = false;
      materialOverrides.current = {};
      lensOverride.current = null;
      loadController.current = controller;
      setStatus('loading');
      try {
        if (!files.length || files.length > 6)
          throw new Error('REFERENCE_COUNT');
        if (files.reduce((s, f) => s + f.size, 0) > 48 * 1024 ** 2)
          throw new Error('BATCH_BYTE_LIMIT');
        const refs: ReferenceImage[] = [];
        for (const file of files)
          refs.push(
            await decodeReference(file, crypto.randomUUID(), controller.signal)
          );
        validateReferenceSet(refs, refs[0].id);
        if (!acceptWorkerResult(active.current, inputRevision)) return;
        setRefs(refs);
        setObservations([]);
        setCandidate(null);
        history.current = [];
        run('analyze', refs, [], measurements);
      } catch (err) {
        if (!acceptWorkerResult(active.current, inputRevision)) return;
        setError(err instanceof Error ? err.message : 'INVALID_IMAGE');
        setStatus('error');
      }
    },
    [invalidate, measurements, run]
  );
  const updateObservation = useCallback(
    (update: PartObservation) => {
      invalidate();
      geometryFresh.current = false;
      history.current.push(structuredClone(observations));
      history.current = history.current.slice(-30);
      setObservations(replaceObservation(observations, update));
      setStatus('dirty');
    },
    [invalidate, observations]
  );
  const undo = useCallback(() => {
    const prev = history.current.pop();
    if (prev) {
      invalidate();
      geometryFresh.current = false;
      setObservations(prev);
      setStatus('dirty');
    }
  }, [invalidate]);
  const setPrimary = useCallback(
    (id: string) => {
      invalidate();
      geometryFresh.current = false;
      setRefs(validateReferenceSet(references, id));
      setStatus('dirty');
    },
    [invalidate, references]
  );
  const setMeasurement = useCallback(
    (key: string, mm: number | null) => {
      invalidate();
      geometryFresh.current = false;
      setMeasures((prev) => {
        const next = { ...prev };
        if (mm === null) delete next[key];
        else next[key] = { mm, source: 'user-confirmed' };
        return next;
      });
      setStatus('dirty');
    },
    [invalidate]
  );
  const updateMaterial = useCallback(
    (part: PartId, material: MaterialDescriptor) => {
      const nextRevision = invalidate();
      materialOverrides.current = {
        ...materialOverrides.current,
        [part]: material,
      };
      setCandidate((prev) =>
        prev
          ? {
              ...prev,
              inputRevision: nextRevision,
              materials: { ...prev.materials, [part]: material },
              status: 'needs-review',
            }
          : prev
      );
      setStatus(geometryFresh.current ? 'draft' : 'dirty');
    },
    [invalidate]
  );
  const updateLens = useCallback(
    (lens: LensDescriptor) => {
      const nextRevision = invalidate();
      lensOverride.current = lens;
      setCandidate((prev) =>
        prev
          ? {
              ...prev,
              inputRevision: nextRevision,
              lens,
              status: 'needs-review',
            }
          : prev
      );
      setStatus(geometryFresh.current ? 'draft' : 'dirty');
    },
    [invalidate]
  );
  const cancel = useCallback(() => {
    invalidate();
    geometryFresh.current = false;
    setStatus('cancelled');
  }, [invalidate]);
  const reconstruct = useCallback(() => {
    if (references.length) run('fit', references, observations, measurements);
  }, [references, observations, measurements, run]);
  return {
    revision,
    references,
    observations,
    candidate,
    status,
    error,
    measurements,
    setReferences,
    updateObservation,
    undo,
    setPrimary,
    setMeasurement,
    updateMaterial,
    updateLens,
    reconstruct,
    cancel,
  };
}
