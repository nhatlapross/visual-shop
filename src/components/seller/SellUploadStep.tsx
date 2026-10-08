import { useState } from "react";
import { ArrowRight, ImagePlus } from "lucide-react";
import { tv } from "tailwind-variants";
import { Button } from "@/components/ui/button";
import { convertPhoto, keepPhoto } from "@/lib/convertPhoto";
import { validateGlbContainer } from "@/lib/eyewear-3d/reconstruction/asset";
import SellMediaPreview from "./SellMediaPreview";
import SellUploadStepButtons from "./SellUploadStepButtons";
import SellUploadStepCamera from "./SellUploadStepCamera";
import SellUploadStepConvert from "./SellUploadStepConvert";
import { formatBytes, SELL_MAX_FILE_BYTES, type SellMedia } from "./sellTypes";

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

/**
 * Step 1: add a photo (file or camera). The frame scans it for a moment, then shows the file the converter returned.
 * Without an AI converter (`convertPhoto` in `@/lib/convertPhoto`) that file is exactly the photo that was chosen or
 * taken. A GLB the seller picks skips the scan.
 */
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
      file,
      type: "glb",
      fileName: file.name,
      previewUrl: "",
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
                <SellUploadStepConvert
                  key={session}
                  photo={photo}
                  convert={convertPhoto ?? keepPhoto}
                  onConverted={onMediaChange}
                />
              ) : media ? (
                <>
                  <SellMediaPreview media={media} />

                  <p className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/60 to-transparent px-4 pt-8 pb-3 text-center text-xs text-white">
                    {media.fileName} · {formatBytes(media.file.size)}
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
