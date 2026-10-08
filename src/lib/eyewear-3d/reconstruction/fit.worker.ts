/// <reference lib="webworker" />
import { extractImageFeatures } from './image-features';
import { detectPartObservations } from './observations';
import { fitReferences } from './fit';
import { estimateReferenceMaterials } from './materials';
import { enrichSolidFrame } from './solid-frame';
import { enrichNosePads } from './nose-pad-observations';
import { detectSurfaceLandmarks } from './surface-features';
import { mergeAnalyzedObservation } from './controller';
import type {
  ImageFeatures,
  Measurement,
  PartObservation,
  ReferenceImage,
} from './types';

interface Request {
  kind: 'analyze' | 'fit';
  inputRevision: string;
  references: ReferenceImage[];
  observations: PartObservation[];
  measurements: Record<string, Measurement>;
}
const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = async (event: MessageEvent<Request>) => {
  const input = event.data;
  try {
    const features = new Map<string, ImageFeatures>();
    let observations = [...input.observations];
    for (const reference of input.references.filter(
      (r) => r.kind === 'observed'
    )) {
      const bitmap = await createImageBitmap(reference.blob, {
        imageOrientation: 'from-image',
      });
      try {
        const scale = Math.min(1, 1024 / bitmap.width, 1536 / bitmap.height),
          width = Math.round(bitmap.width * scale),
          height = Math.round(bitmap.height * scale);
        const canvas = new OffscreenCanvas(width, height),
          ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('IMAGE_CONTEXT_UNAVAILABLE');
        ctx.drawImage(bitmap, 0, 0, width, height);
        const image = extractImageFeatures(
          ctx.getImageData(0, 0, width, height).data,
          width,
          height
        );
        features.set(reference.id, image);
        if (!observations.some((p) => p.referenceId === reference.id))
          observations.push(...detectPartObservations(image, reference.id));
        else {
          const current = observations.filter(
            (p) => p.referenceId === reference.id
          );
          const enriched = enrichSolidFrame(
            image,
            enrichNosePads(image, current)
          ).map((p) => ({
            ...p,
            surfaceLandmarks: detectSurfaceLandmarks(image, p),
          }));
          observations = observations
            .filter((p) => p.referenceId !== reference.id)
            .concat(
              enriched.map((p) =>
                mergeAnalyzedObservation(
                  current.find(
                    (old) =>
                      old.part === p.part && old.referenceId === p.referenceId
                  ),
                  p
                )
              )
            );
        }
      } finally {
        bitmap.close();
      }
    }
    if (input.kind === 'analyze') {
      scope.postMessage({
        kind: 'observations',
        inputRevision: input.inputRevision,
        observations,
      });
      return;
    }
    const candidate = await fitReferences(input.references, observations, {
      imageFeatures: features,
      maxEvaluations: 4000,
      measurements: input.measurements,
      onProgress: (evaluations, loss) =>
        scope.postMessage({
          kind: 'progress',
          inputRevision: input.inputRevision,
          evaluations,
          loss,
        }),
    });
    candidate.materials = estimateReferenceMaterials(
      input.references,
      observations,
      features
    );
    scope.postMessage({
      kind: 'result',
      inputRevision: input.inputRevision,
      candidate,
      observations,
    });
  } catch (error) {
    scope.postMessage({
      kind: 'error',
      inputRevision: input.inputRevision,
      error: error instanceof Error ? error.message : 'RECONSTRUCTION_FAILED',
    });
  }
};
