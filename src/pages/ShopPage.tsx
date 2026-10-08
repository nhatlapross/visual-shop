import { ArrowRight, Box, Camera, Wallet } from "lucide-react";
import { Link } from "react-router";
import { FrameThumb } from "@/components/FrameThumb";

const steps = [
  {
    icon: Box,
    title: "Built from real photos",
    text: "Sellers upload a photo of the frame and get a 3D model buyers can try on.",
  },
  {
    icon: Camera,
    title: "Try it on your face",
    text: "Step into the fitting room and see every frame live through your camera.",
  },
  {
    icon: Wallet,
    title: "Pay in SUI",
    text: "Checkout is one transaction on Sui. Your receipt lives in your wallet.",
  },
];

// Soft backdrops that the transparent frame renders float on, one per card.
const backdrops = [
  "from-sky-100 via-indigo-50 to-violet-100",
  "from-amber-100 via-orange-50 to-rose-100",
  "from-emerald-100 via-teal-50 to-cyan-100",
  "from-fuchsia-100 via-pink-50 to-amber-50",
];

// Hardcoded demo frames for the overview. They are not live listings: the GLBs are the store's Cloudinary catalog.
const catalogUrl = (n: number) =>
  `https://res.cloudinary.com/bcu8tedb/image/upload/visual-shop/catalog/frame-${n}.glb`;

const demoFrames = [
  { title: "Bold Square · Black & Tan", url: catalogUrl(1) },
  { title: "Half-Rim · Gunmetal", url: catalogUrl(2) },
  { title: "Classic Sunglasses · Black", url: catalogUrl(3) },
  { title: "Round Wire · Matte Black", url: catalogUrl(4) },
];

function EnterStoreLink() {
  return (
    <Link
      to="/store"
      className="inline-flex h-12 items-center gap-2 rounded-md bg-neutral-900 px-6 font-medium text-white hover:bg-neutral-800"
    >
      Enter the store <ArrowRight className="size-4" />
    </Link>
  );
}

// Overview page. The store itself is the full-screen fitting room at /store.
export function ShopPage() {
  return (
    <div className="space-y-16">
      <section className="pt-8 text-center md:pt-16">
        <p className="mb-4 inline-block rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-medium text-neutral-600">
          Live on Sui testnet
        </p>

        <h1 className="mx-auto max-w-2xl text-4xl font-semibold tracking-tight md:text-5xl">
          Try on eyewear before you buy
        </h1>

        <p className="mx-auto mt-4 max-w-xl text-neutral-600">
          Visual Shop is an eyewear marketplace on Sui. Every frame is a 3D
          model built from the seller's photos, so you can see it on your own
          face through your camera before you pay.
        </p>

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <EnterStoreLink />

          <Link
            to="/sell"
            className="inline-flex h-12 items-center rounded-md border border-neutral-300 bg-white px-6 font-medium hover:bg-neutral-100"
          >
            Sell your eyewear
          </Link>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">A peek inside the store</h2>
        <p className="mb-4 mt-1 text-sm text-neutral-500">
          A few of the frames you can try on. This is only a preview.
        </p>

        <ul className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {demoFrames.map((frame, i) => (
            <li key={frame.url}>
              <Link
                to="/store"
                className="group block overflow-hidden rounded-xl border border-neutral-200 bg-white transition-shadow hover:shadow-lg"
              >
                <div
                  className={`relative aspect-square bg-linear-to-br ${backdrops[i % backdrops.length]}`}
                >
                  {/* Ground shadow that stays put while the frame floats above it. */}
                  <div className="absolute inset-x-[22%] bottom-[24%] h-3 rounded-[50%] bg-black/10 blur-md transition-transform duration-500 group-hover:scale-x-110" />
                  <div
                    className="absolute inset-[12%] motion-safe:animate-float"
                    style={{ animationDelay: `${i * -1.2}s` }}
                  >
                    <FrameThumb
                      url={frame.url}
                      type="glb"
                      alt={frame.title}
                      width={600}
                      className="h-full w-full"
                    />
                  </div>
                </div>

                <p className="truncate p-3 font-medium">{frame.title}</p>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold">How it works</h2>

        <div className="grid gap-4 md:grid-cols-3">
          {steps.map(({ icon: Icon, title, text }) => (
            <div
              key={title}
              className="rounded-xl border border-neutral-200 bg-white p-5"
            >
              <Icon className="mb-3 size-5 text-neutral-700" />
              <p className="font-medium">{title}</p>
              <p className="mt-1 text-sm text-neutral-600">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white px-6 py-10 text-center">
        <h2 className="text-2xl font-semibold tracking-tight">
          Ready to find your frame?
        </h2>
        <p className="mx-auto mt-2 max-w-md text-neutral-600">
          Open the fitting room and try a pair on in seconds.
        </p>

        <div className="mt-6">
          <EnterStoreLink />
        </div>
      </section>
    </div>
  );
}
