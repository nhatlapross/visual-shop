import { lazy, Suspense, useState } from "react";
import { ArrowRight, ImagePlus, Loader2 } from "lucide-react";
import { tv } from "tailwind-variants";
import { Button } from "@/components/ui/button";
import { validateGlbContainer } from "@/lib/eyewear-3d/reconstruction/asset";
import SellMediaPreview from "./SellMediaPreview";
import SellUploadStepButtons from "./SellUploadStepButtons";
import SellUploadStepCamera from "./SellUploadStepCamera";
import { formatBytes, SELL_MAX_FILE_BYTES, type SellMedia } from "./sellTypes";

// three.js and the reconstruction worker are heavy; only load them once a photo is chosen.
const SellUploadStepBuild = lazy(() => import("./SellUploadStepBuild"));

// One square frame for every state (empty, camera, scanning, ready) so nothing shifts when a photo arrives.
const frame = tv({
  base: "relative aspect-square w-full overflow-hidden rounded-3xl",
  variants: { filled: { true: "shadow-lg" } },
});

interface SellUploadStepProps {
  media: SellMedia | null;
  onMediaChange: (media: SellMedia | null) => void;
  onContinue: () => void;
}

/** Step 1: add a photo (file or camera) and watch it become a 3D model. A GLB skips the conversion. */
export default function SellUploadStep({
  media,
  onMediaChange,
  onContinue,
}: SellUploadStepProps) {
  const [photo, setPhoto] = useState<File | null>(null);
  const [session, setSession] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");

  const startPhoto = (file: File) => {
    onMediaChange(null);
    setSession((value) => value + 1);
    setPhoto(file);
  };

  const handleFileSelected = async (file: File) => {
    setError("");
    const isGlb = file.name.toLowerCase().endsWith(".glb");
    const isPhoto = file.type === "image/jpeg" || file.type === "image/png";
    if (!isGlb && !isPhoto) {
      setError("Use a JPG, PNG or GLB file.");
      return;
    }
    if (file.size > SELL_MAX_FILE_BYTES) {
      setError(`That file is ${formatBytes(file.size)}. The limit is 10 MB.`);
      return;
    }
    if (!isGlb) {
      startPhoto(file);
      return;
    }
    try {
      validateGlbContainer(await file.arrayBuffer());
    } catch {
      setError(
        "That GLB is not valid or links to external files. Export a single self-contained .glb.",
      );
      return;
    }
    setPhoto(null);
    onMediaChange({
      glb: file,
      fileName: file.name,
      previewUrl: "",
      origin: "glb-upload",
    });
  };

  return (
    <div className="space-y-6">
      {/* The column shrinks with the window height so the buttons stay on screen. */}
      <div className="mx-auto w-[clamp(15rem,calc(100dvh-26rem),28rem)] max-w-full space-y-4">
        {scanning ? (
          <SellUploadStepCamera
            onCapture={(file) => {
              setScanning(false);
              startPhoto(file);
            }}
            onCancel={() => setScanning(false)}
          />
        ) : (
          <>
            <div className={frame({ filled: Boolean(photo || media) })}>
              {photo ? (
                <Suspense
                  fallback={
                    <div className="grid size-full place-items-center bg-neutral-900 text-white/70">
                      <Loader2 className="size-5 animate-spin" />
                    </div>
                  }
                >
                  <SellUploadStepBuild
                    key={session}
                    photo={photo}
                    onBuilt={onMediaChange}
                  />
                </Suspense>
              ) : media ? (
                <>
                  <SellMediaPreview media={media} />

                  <p className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/60 to-transparent px-4 pt-8 pb-3 text-center text-xs text-white">
                    {media.fileName} · {formatBytes(media.glb.size)}
                  </p>
                </>
              ) : (
                <div className="grid size-full place-items-center rounded-3xl border-2 border-dashed border-neutral-300 bg-white p-6 text-center text-neutral-400">
                  <div className="space-y-2">
                    <ImagePlus className="mx-auto size-10" />

                    <p className="text-sm">
                      Your photo or 3D model shows up here
                    </p>

                    <p className="text-xs">JPG, PNG or GLB · max 10 MB</p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <SellUploadStepButtons
                onFileSelected={handleFileSelected}
                onScan={() => setScanning(true)}
              />

              <Button
                className="ml-auto mt-10"
                disabled={!media}
                onClick={onContinue}
              >
                Continue <ArrowRight className="size-4" />
              </Button>
            </div>

            <p className="h-5 text-center text-sm text-red-600">{error}</p>
          </>
        )}
      </div>
    </div>
  );
}
