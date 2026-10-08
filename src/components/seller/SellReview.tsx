import { useRef } from "react";
import { ConnectModal } from "@mysten/dapp-kit-react/ui";
import { ArrowLeft, Box, Package, Send, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import SellMediaPreview from "./SellMediaPreview";
import SuiIcon from "./SuiIcon";
import {
  formatBytes,
  type SellDetailsValues,
  type SellMedia,
} from "./sellTypes";

const NEXT_STEPS = [
  "Your 3D model is uploaded to Cloudinary.",
  "You approve the transaction in your wallet.",
  "The listing is created on Sui and appears in the shop.",
];

interface SellReviewProps {
  media: SellMedia;
  details: SellDetailsValues;
  walletConnected: boolean;
  onBack: () => void;
  onSubmit: () => void;
}

/** Step 3: everything that will be uploaded and listed, one last time. */
export default function SellReview({
  media,
  details,
  walletConnected,
  onBack,
  onSubmit,
}: SellReviewProps) {
  const connectModal = useRef<{ show: () => Promise<void> } | null>(null);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-5 rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="mx-auto w-full max-w-xs overflow-hidden rounded-2xl">
          <SellMediaPreview media={media} />
        </div>

        <div className="space-y-2">
          <h3 className="text-xl font-semibold break-words">{details.title}</h3>

          <p className="whitespace-pre-line text-neutral-600">
            {details.description.trim() || "No description."}
          </p>
        </div>

        <dl className="grid gap-4 border-t border-neutral-100 pt-5 sm:grid-cols-3">
          <div className="space-y-1">
            <dt className="text-xs font-medium tracking-widest text-neutral-400 uppercase">
              Price
            </dt>

            <dd className="flex items-center gap-1.5 font-semibold">
              <SuiIcon className="size-5" />
              {details.price} SUI
            </dd>
          </div>

          <div className="space-y-1">
            <dt className="text-xs font-medium tracking-widest text-neutral-400 uppercase">
              Stock
            </dt>

            <dd className="flex items-center gap-1.5 font-semibold">
              <Package className="size-5 text-neutral-400" />
              {details.stock} available
            </dd>
          </div>

          <div className="space-y-1">
            <dt className="text-xs font-medium tracking-widest text-neutral-400 uppercase">
              Uploads
            </dt>

            <dd className="flex items-center gap-1.5 font-semibold">
              <Box className="size-5 text-indigo-500" />
              3D model · {formatBytes(media.glb.size)}
            </dd>
          </div>
        </dl>
      </div>

      <div className="space-y-2 rounded-2xl bg-neutral-100 p-5 text-sm text-neutral-600">
        <p className="font-medium text-neutral-800">When you submit</p>

        <ol className="list-inside list-decimal space-y-1">
          {NEXT_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>

      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="size-4" /> Back
        </Button>

        {/* Without a wallet the same button opens the wallet picker; once connected it submits. */}
        <Button
          onClick={() =>
            walletConnected ? onSubmit() : void connectModal.current?.show()
          }
        >
          {walletConnected ? (
            <Send className="size-4" />
          ) : (
            <Wallet className="size-4" />
          )}
          {walletConnected ? "Submit" : "Connect wallet"}
        </Button>
      </div>

      {!walletConnected && (
        <ConnectModal
          ref={(element) => {
            connectModal.current = element;
          }}
        />
      )}
    </div>
  );
}
