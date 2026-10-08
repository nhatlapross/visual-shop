import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Box,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CloudUpload,
  Download,
  Glasses,
  Info,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  ScanFace,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  SwitchCamera,
  X,
  Zap,
} from 'lucide-react'
import {
  classifyFaceShape,
  coverSize,
  createFaceMesh,
  DEFAULT_FACE_METRICS,
  FACE_SHAPE_LABELS,
  FACE_SHAPE_TIPS,
  FACEMESH_CONNECT_PAIRS,
  loadFaceMeshScript,
  type FaceMetrics,
  type FaceShapeType,
  type Landmark,
} from './faceTracking'
import { startGlassesOverlay, type GlassesOverlay, type SmoothedPose } from './glassesOverlay'
import type { Listing } from '@/types'
import { formatSui } from '@/lib/sui/format'
import { walrusUrl } from '@/lib/walrus'
import { FrameViewerModal } from './FrameViewerModal'
import './tryon.css'

export interface ArTryOnProps {
  /** Frames in the room. Inactive listings are hidden; sold-out ones can be tried on but not bought. */
  listings: Listing[]
  initialListingId?: string
  onBuy: (listing: Listing) => void
  onClose?: () => void
}

interface FrameItem {
  listing: Listing
  id: string
  title: string
  priceLabel: string
  stockLabel: string
  soldOut: boolean
  image: string
  /** GLB on Walrus (front along +z, any unit). */
  modelUrl: string
}

function toFrameItem(listing: Listing): FrameItem {
  const soldOut = listing.stock <= 0
  return {
    listing,
    id: listing.id,
    title: listing.title,
    priceLabel: `${formatSui(listing.price)} SUI`,
    stockLabel: soldOut ? 'Sold out' : `${listing.stock} in stock`,
    soldOut,
    image: walrusUrl(listing.imageBlobId),
    modelUrl: walrusUrl(listing.modelBlobId),
  }
}

/** Hover magnification and drag-to-scroll for the frame carousel (macOS-dock style). */
function attachDockMagnify(el: HTMLDivElement | null) {
  if (!el) return
  let isDown = false
  let startX = 0
  let scrollLeft = 0
  el.onmousedown = (e) => {
    isDown = true
    el.classList.add('is-dragging')
    startX = e.pageX - el.offsetLeft
    scrollLeft = el.scrollLeft
  }
  el.onmouseup = () => {
    isDown = false
    el.classList.remove('is-dragging')
  }
  const track = el.querySelector('.ar-glasses-carousel-track') as HTMLElement | null
  if (!track) return
  const setInfo = (card: HTMLElement, visible: boolean) => {
    const info = card.querySelector('.carousel-card-info') as HTMLElement | null
    if (!info) return
    info.style.opacity = visible ? '1' : '0'
    info.style.transform = visible ? 'translateX(-50%) translateY(0) scale(1)' : 'translateX(-50%) translateY(6px) scale(0.9)'
    info.style.pointerEvents = visible ? 'auto' : 'none'
  }
  el.onmousemove = (e) => {
    if (isDown) {
      e.preventDefault()
      el.scrollLeft = scrollLeft - (e.pageX - el.offsetLeft - startX) * 1.8
      return
    }
    const cards = track.children as HTMLCollectionOf<HTMLElement>
    let closestIdx = -1
    let minDistance = Infinity
    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i].getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const dist = Math.abs(e.clientX - centerX)
      if (dist < minDistance) {
        minDistance = dist
        closestIdx = i
      }
      const maxDist = 180
      const scale = dist < maxDist ? 1 + 0.38 * Math.cos((dist / maxDist) * (Math.PI / 2)) : 1
      cards[i].style.transform = `scale(${scale}) translateY(-${(scale - 1) * 22}px)`
      const preview = cards[i].querySelector('.carousel-card-preview') as HTMLElement | null
      if (preview) {
        const tiltY = dist < maxDist ? ((e.clientX - centerX) / maxDist) * -18 : 0
        preview.style.transform = `rotateY(${tiltY}deg) scale(${dist < 60 ? 1.08 : 1})`
      }
    }
    for (let i = 0; i < cards.length; i++) setInfo(cards[i], i === closestIdx && minDistance < 90)
  }
  el.onmouseleave = () => {
    isDown = false
    el.classList.remove('is-dragging')
    const cards = track.children as HTMLCollectionOf<HTMLElement>
    for (let i = 0; i < cards.length; i++) {
      cards[i].style.transform = 'scale(1) translateY(0)'
      const preview = cards[i].querySelector('.carousel-card-preview') as HTMLElement | null
      if (preview) preview.style.transform = 'rotateY(0deg) scale(1)'
      setInfo(cards[i], false)
    }
  }
}

type FacingMode = 'user' | 'environment'

interface FacePose extends SmoothedPose {
  detected: boolean
  detectedFaceShape: FaceShapeType
}

const SCAN_TOTAL_MS = 5000
const FACE_SHAPES: FaceShapeType[] = ['round', 'square', 'oval', 'heart', 'diamond']

export function ArTryOn({ listings, initialListingId, onBuy, onClose }: ArTryOnProps) {
  // Catalog
  const frames = useMemo(() => listings.filter((l) => l.active).map(toFrameItem), [listings])
  const [selectedId, setSelectedId] = useState<string | undefined>(initialListingId)
  useEffect(() => {
    if (initialListingId) setSelectedId(initialListingId)
  }, [initialListingId])
  const selected = frames.find((f) => f.id === selectedId) ?? frames.find((f) => !f.soldOut) ?? frames[0] ?? null
  const modelUrl = selected?.modelUrl ?? ''
  const title = selected?.title ?? 'Frame'
  const priceLabel = selected?.priceLabel
  const buySelected = selected && !selected.soldOut ? () => onBuy(selected.listing) : undefined
  // Collapsed until the camera or a photo is on, so the launch card's buttons stay reachable.
  const [isDockCollapsed, setIsDockCollapsed] = useState(true)
  const [is3DViewerOpen, setIs3DViewerOpen] = useState(false)

  const [modelLoadingProgress, setModelLoadingProgress] = useState<number | null>(null)
  const [modelError, setModelError] = useState<string | null>(null)

  // Camera and tracking
  const [isCameraActive, setIsCameraActive] = useState(false)
  const [isCameraStarting, setIsCameraStarting] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [facingMode, setFacingMode] = useState<FacingMode>('user')
  const [isTrackingFace, setIsTrackingFace] = useState(false)
  const [showDiagnosisModal, setShowDiagnosisModal] = useState(false)
  const [isTuningPanelOpen, setIsTuningPanelOpen] = useState(false)
  const [manualFaceShape, setManualFaceShape] = useState<FaceShapeType | null>(null)
  const [faceMetrics, setFaceMetrics] = useState<FaceMetrics>(DEFAULT_FACE_METRICS)
  const [facePose, setFacePose] = useState<FacePose>({
    detected: false,
    x: 50,
    y: 43,
    widthPx: 310,
    rollDeg: 0,
    pitchDeg: 0,
    yawDeg: 0,
    detectedFaceShape: 'oval',
  })
  const currentFaceShape: FaceShapeType = manualFaceShape || facePose.detectedFaceShape

  // Manual fine-tuning
  const [manualScale, setManualScale] = useState(1)
  const [manualOffsetX, setManualOffsetX] = useState(0)
  const [manualOffsetY, setManualOffsetY] = useState(0)
  const [manualOffsetZ, setManualOffsetZ] = useState(0)
  const [manualTilt, setManualTilt] = useState(0)

  // Snapshot and uploaded photo
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null)
  const [isCapturing, setIsCapturing] = useState(false)
  const [uploadedPhotoUrl, setUploadedPhotoUrl] = useState<string | null>(null)

  // Initial face scan sequence
  const [isInitialScanning, setIsInitialScanning] = useState(true)
  const [scanElapsedMs, setScanElapsedMs] = useState(0)
  const [scanJustCompleted, setScanJustCompleted] = useState(false)
  const scanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null)
  const uploadedImgRef = useRef<HTMLImageElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const viewportRef = useRef<HTMLElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const threeCanvasRef = useRef<HTMLCanvasElement>(null)
  const faceMeshCanvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<GlassesOverlay | null>(null)
  const faceMeshRef = useRef<any>(null)
  const trackingLoopIdRef = useRef(0)
  const cameraRequestIdRef = useRef(0)
  const smoothedPoseRef = useRef<SmoothedPose>({ x: 50, y: 43, widthPx: 310, rollDeg: 0, pitchDeg: 0, yawDeg: 0 })
  const faceLandmarksRef = useRef<Landmark[] | null>(null)

  const isPhotoMode = Boolean(uploadedPhotoUrl) && !isCameraActive
  const hasSource = isCameraActive || Boolean(uploadedPhotoUrl)
  useEffect(() => {
    if (hasSource) setIsDockCollapsed(false)
  }, [hasSource])

  // Latest values for the animation loops, which must not re-subscribe on every render.
  const live = useRef({ facingMode, isPhotoMode, scanPercent: 0, isInitialScanning })
  const manualRef = useRef({ scale: 1, offsetX: 0, offsetY: 0, offsetZ: 0, tilt: 0 })
  manualRef.current = { scale: manualScale, offsetX: manualOffsetX, offsetY: manualOffsetY, offsetZ: manualOffsetZ, tilt: manualTilt }

  const scanPercent = Math.min(100, Math.round((scanElapsedMs / SCAN_TOTAL_MS) * 100))
  live.current = { facingMode, isPhotoMode, scanPercent, isInitialScanning }

  /** The uploaded photo is shown unmirrored; the front camera is mirrored. */
  const isMirrored = () => !live.current.isPhotoMode && live.current.facingMode === 'user'
  const getSourceSize = useCallback(() => {
    if (live.current.isPhotoMode) {
      const img = uploadedImgRef.current
      if (img?.naturalWidth) return { width: img.naturalWidth, height: img.naturalHeight }
    }
    const vid = videoRef.current
    if (vid?.videoWidth) return { width: vid.videoWidth, height: vid.videoHeight }
    return { width: 640, height: 480 }
  }, [])
  const getViewportSize = useCallback(() => {
    const vp = viewportRef.current
    return { width: vp?.clientWidth || window.innerWidth, height: vp?.clientHeight || window.innerHeight }
  }, [])

  const finishScan = useCallback(() => {
    if (scanTimerRef.current) clearInterval(scanTimerRef.current)
    scanTimerRef.current = null
    setScanElapsedMs(SCAN_TOTAL_MS)
    setIsInitialScanning(false)
    setScanJustCompleted(true)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setScanJustCompleted(false), 4500)
  }, [])

  // Run the scan sequence whenever the camera starts or a photo is loaded.
  useEffect(() => {
    if (scanTimerRef.current) clearInterval(scanTimerRef.current)
    if (!hasSource) {
      setIsInitialScanning(false)
      return
    }
    setIsInitialScanning(true)
    setScanElapsedMs(0)
    setScanJustCompleted(false)
    const startTime = Date.now()
    scanTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime
      if (elapsed >= SCAN_TOTAL_MS) finishScan()
      else setScanElapsedMs(elapsed)
    }, 100)
    return () => {
      if (scanTimerRef.current) clearInterval(scanTimerRef.current)
    }
  }, [hasSource, uploadedPhotoUrl, finishScan])

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
  }, [])

  const scanStageInfo = useMemo(() => {
    if (scanPercent < 22) return { title: 'Starting face scan', subtitle: 'Mapping 468 facial landmarks in real time...' }
    if (scanPercent < 45) return { title: 'Measuring proportions', subtitle: 'Forehead, cheekbone and jaw width...' }
    if (scanPercent < 68) return { title: 'Measuring eye distance', subtitle: 'Locating the eye centres and head angle...' }
    if (scanPercent < 90) return { title: 'Analysing face shape', subtitle: 'Comparing facial proportions...' }
    return { title: 'Analysis complete!', subtitle: `Fitting ${title} to your face...` }
  }, [scanPercent, title])

  // Face-mesh wireframe drawn while scanning.
  useEffect(() => {
    let animId = 0
    const draw = () => {
      animId = requestAnimationFrame(draw)
      const canvas = faceMeshCanvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return
      const width = canvas.clientWidth || window.innerWidth
      const height = canvas.clientHeight || window.innerHeight
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      ctx.clearRect(0, 0, width, height)
      const { isInitialScanning: scanning, scanPercent: percent } = live.current
      if (!scanning || percent <= 0) return

      const src = getSourceSize()
      const rendered = coverSize(width, height, src.width, src.height)
      const mirrored = isMirrored()
      const landmarks = faceLandmarksRef.current
      const points: Array<{ x: number; y: number }> = []

      if (landmarks && landmarks.length >= 468) {
        for (const lm of landmarks) {
          points.push({
            x: width / 2 + (mirrored ? 0.5 - lm.x : lm.x - 0.5) * rendered.width,
            y: height / 2 + (lm.y - 0.5) * rendered.height,
          })
        }
      } else {
        // Synthetic rings around the current pose until real landmarks arrive.
        const pose = smoothedPoseRef.current
        const cx = (pose.x / 100) * width
        const cy = (pose.y / 100) * height
        const w = pose.widthPx || 280
        const h = w * 1.3
        const roll = (pose.rollDeg * Math.PI) / 180
        for (let r = 0; r < 8; r++) {
          const rx = (w * 0.48 * (r + 1)) / 8
          const ry = (h * 0.48 * (r + 1)) / 8
          const count = 12 + r * 6
          for (let c = 0; c < count; c++) {
            const a = (c / count) * Math.PI * 2
            const px = Math.cos(a) * rx
            const py = Math.sin(a) * ry
            points.push({ x: cx + px * Math.cos(roll) - py * Math.sin(roll), y: cy + px * Math.sin(roll) + py * Math.cos(roll) })
          }
        }
      }

      const maxIndex = Math.min(points.length, Math.floor((percent / 100) * points.length * 1.08))
      const laserCycle = (Date.now() % 2800) / 2800
      const laserY = (0.15 + 0.65 * (Math.sin(laserCycle * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5)) * height
      const baseAlpha = Math.min(0.65, (percent / 75) * 0.65)
      ctx.lineWidth = 1.1

      if (landmarks && landmarks.length >= 468) {
        for (const [a, b] of FACEMESH_CONNECT_PAIRS) {
          if (a >= maxIndex || b >= maxIndex) continue
          const pa = points[a]
          const pb = points[b]
          if (Math.hypot(pa.x - pb.x, pa.y - pb.y) >= 140) continue
          ctx.beginPath()
          ctx.moveTo(pa.x, pa.y)
          ctx.lineTo(pb.x, pb.y)
          ctx.strokeStyle = Math.abs((pa.y + pb.y) / 2 - laserY) < 35 ? 'rgba(253, 224, 71, 0.75)' : `rgba(16, 185, 129, ${baseAlpha})`
          ctx.stroke()
        }
      } else {
        for (let i = 0; i < maxIndex - 1; i++) {
          const pa = points[i]
          const pb = points[i + 1]
          if (Math.hypot(pa.x - pb.x, pa.y - pb.y) >= 60) continue
          ctx.beginPath()
          ctx.moveTo(pa.x, pa.y)
          ctx.lineTo(pb.x, pb.y)
          ctx.strokeStyle = `rgba(16, 185, 129, ${baseAlpha * 0.7})`
          ctx.stroke()
        }
      }

      for (let i = 0; i < maxIndex; i++) {
        const pt = points[i]
        const nearLaser = Math.abs(pt.y - laserY) < 25
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, nearLaser ? 2.8 : 1.6, 0, Math.PI * 2)
        ctx.fillStyle = nearLaser ? '#FDE047' : '#34D399'
        ctx.shadowColor = nearLaser ? '#FDE047' : '#10B981'
        ctx.shadowBlur = nearLaser ? 8 : 3
        ctx.fill()
      }
      ctx.shadowBlur = 0
    }
    animId = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(animId)
  }, [getSourceSize])

  // ==========================================
  // Face tracking (MediaPipe FaceMesh)
  // ==========================================
  const processLandmarks = useCallback(
    (landmarks: Landmark[]) => {
      if (!landmarks || landmarks.length < 468) return
      faceLandmarksRef.current = landmarks

      const noseBridge = landmarks[168] || landmarks[6]
      const leftEyeOuter = landmarks[33]
      const rightEyeOuter = landmarks[263]
      const leftTemple = landmarks[234]
      const rightTemple = landmarks[454]
      const forehead = landmarks[10]
      const chin = landmarks[152]
      if (!noseBridge || !leftEyeOuter || !rightEyeOuter || !leftTemple || !rightTemple) return

      const vp = getViewportSize()
      const src = getSourceSize()
      const rendered = coverSize(vp.width, vp.height, src.width, src.height)
      const mirrored = isMirrored()

      // Centre position in viewport percent.
      const screenX = vp.width / 2 + (mirrored ? 0.5 - noseBridge.x : noseBridge.x - 0.5) * rendered.width
      const screenY = vp.height / 2 + (noseBridge.y - 0.5) * rendered.height
      const rawX = (screenX / vp.width) * 100
      const rawY = (screenY / vp.height) * 100

      // Face width in pixels.
      const templeDx = (rightTemple.x - leftTemple.x) * rendered.width
      const templeDy = (rightTemple.y - leftTemple.y) * rendered.height
      const targetWidthPx = Math.max(140, Math.min(600, Math.hypot(templeDx, templeDy) * 0.94))

      // Roll, yaw and pitch.
      const dX = (rightEyeOuter.x - leftEyeOuter.x) * rendered.width
      const dY = (rightEyeOuter.y - leftEyeOuter.y) * rendered.height
      let rollDeg = Math.atan2(dY, dX) * (180 / Math.PI)
      if (mirrored) rollDeg = -rollDeg

      const leftTempleDist = Math.abs(noseBridge.x - leftTemple.x)
      const rightTempleDist = Math.abs(rightTemple.x - noseBridge.x)
      const yawRatio = (rightTempleDist - leftTempleDist) / (leftTempleDist + rightTempleDist || 0.001)
      let yawDeg = Math.asin(Math.max(-0.85, Math.min(0.85, yawRatio * 1.4))) * (180 / Math.PI)
      if (mirrored) yawDeg = -yawDeg

      const topDist = Math.abs(noseBridge.y - (forehead?.y ?? 0))
      const botDist = Math.abs((chin?.y ?? 1) - noseBridge.y)
      const pitchRatio = (topDist / (topDist + botDist || 0.001) - 0.44) * 2.8
      const pitchDeg = Math.asin(Math.max(-0.7, Math.min(0.7, pitchRatio))) * (180 / Math.PI)

      const pitchCorrection = 1 / Math.max(0.7, Math.cos((pitchDeg * Math.PI) / 180))
      const analysis = classifyFaceShape(landmarks, pitchCorrection)
      if (analysis) setFaceMetrics(analysis.metrics)

      // EMA smoothing.
      const alpha = 0.42
      const s = smoothedPoseRef.current
      s.x = s.x * (1 - alpha) + rawX * alpha
      s.y = s.y * (1 - alpha) + rawY * alpha
      s.widthPx = s.widthPx * (1 - alpha) + targetWidthPx * alpha
      s.rollDeg = s.rollDeg * (1 - alpha) + rollDeg * alpha
      s.pitchDeg = s.pitchDeg * (1 - alpha) + pitchDeg * alpha
      s.yawDeg = s.yawDeg * (1 - alpha) + yawDeg * alpha

      setFacePose((prev) => ({ ...s, detected: true, detectedFaceShape: analysis?.shape ?? prev.detectedFaceShape }))
      setIsTrackingFace(true)
    },
    [getSourceSize, getViewportSize],
  )
  const processLandmarksRef = useRef(processLandmarks)
  processLandmarksRef.current = processLandmarks

  /** Creates the FaceMesh instance once. Resolves null when MediaPipe can't be loaded. */
  const ensureFaceMesh = useCallback(async () => {
    if (faceMeshRef.current) return faceMeshRef.current
    if (!(await loadFaceMeshScript())) return null
    if (faceMeshRef.current) return faceMeshRef.current
    try {
      faceMeshRef.current = createFaceMesh((results: any) => {
        const face = results.multiFaceLandmarks?.[0]
        if (face) {
          processLandmarksRef.current(face)
        } else {
          setIsTrackingFace(false)
          if (live.current.isPhotoMode) faceLandmarksRef.current = null
        }
      })
    } catch (err) {
      console.warn('[Try-on] FaceMesh init failed:', err)
      return null
    }
    return faceMeshRef.current
  }, [])

  const stopTrackingLoop = () => {
    trackingLoopIdRef.current++
  }

  const startVideoTracking = useCallback(async () => {
    const loopId = ++trackingLoopIdRef.current
    const faceMesh = await ensureFaceMesh()
    if (!faceMesh || loopId !== trackingLoopIdRef.current) return
    const loop = async () => {
      if (loopId !== trackingLoopIdRef.current) return
      const video = videoRef.current
      if (video && video.readyState >= 2) {
        try {
          await faceMesh.send({ image: video })
        } catch {
          // Skip this frame.
        }
      }
      if (loopId === trackingLoopIdRef.current) requestAnimationFrame(loop)
    }
    loop()
  }, [ensureFaceMesh])

  // ==========================================
  // Camera
  // ==========================================
  const stopCamera = useCallback(() => {
    cameraRequestIdRef.current++
    stopTrackingLoop()
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setIsCameraActive(false)
    setIsCameraStarting(false)
    setIsTrackingFace(false)
  }, [])

  const startCamera = useCallback(
    async (mode: FacingMode = live.current.facingMode) => {
      const requestId = ++cameraRequestIdRef.current
      stopTrackingLoop()
      setIsCameraStarting(true)
      setCameraError(null)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null

      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('This browser does not support camera access. Try Chrome or Safari.')
        }
        let stream: MediaStream
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: mode, width: { ideal: 1280, min: 640 }, height: { ideal: 720, min: 480 } },
            audio: false,
          })
        } catch (err: any) {
          // Some webcams can't do 640×480; retry without size constraints.
          if (err?.name !== 'OverconstrainedError') throw err
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: mode }, audio: false })
        }
        if (requestId !== cameraRequestIdRef.current) {
          // Superseded (unmounted, flipped or switched to a photo) while waiting for permission.
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        faceLandmarksRef.current = null
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        setIsCameraActive(true)
        setUploadedPhotoUrl(null)
        startVideoTracking()
      } catch (err: any) {
        if (requestId !== cameraRequestIdRef.current) return
        console.warn('[Try-on] Camera error:', err)
        let msg = 'Could not open the camera. Allow camera access in your browser and try again, or upload a selfie.'
        if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
          msg = 'Camera access is blocked. Click the lock icon in the address bar to allow it, or upload a selfie instead.'
        } else if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') {
          msg = 'No camera found. Upload a selfie instead.'
        } else if (!(err instanceof DOMException) && err?.message) {
          msg = err.message
        }
        setCameraError(msg)
        setIsCameraActive(false)
      } finally {
        if (requestId === cameraRequestIdRef.current) setIsCameraStarting(false)
      }
    },
    [startVideoTracking],
  )

  const flipCamera = useCallback(() => {
    const next: FacingMode = facingMode === 'user' ? 'environment' : 'user'
    setFacingMode(next)
    live.current.facingMode = next
    if (isCameraActive) startCamera(next)
  }, [facingMode, isCameraActive, startCamera])

  // Open the camera straight away; on failure the launch card shows the error and the upload option.
  useEffect(() => {
    startCamera('user')
    return () => {
      stopCamera()
      faceMeshRef.current?.close?.()
      faceMeshRef.current = null
    }
  }, [startCamera, stopCamera])

  const handlePhotoUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    stopCamera()
    faceLandmarksRef.current = null
    smoothedPoseRef.current = { x: 50, y: 43, widthPx: 310, rollDeg: 0, pitchDeg: 0, yawDeg: 0 }
    setFacePose((p) => ({ ...p, ...smoothedPoseRef.current, detected: false }))
    const reader = new FileReader()
    reader.onload = (ev) => {
      setUploadedPhotoUrl(ev.target?.result as string)
      setCameraError(null)
    }
    reader.readAsDataURL(file)
  }

  // Detect the face once on an uploaded photo so the frame lands on it; sliders fine-tune from there.
  const handleUploadedImageLoad = useCallback(async () => {
    const img = uploadedImgRef.current
    if (!img) return
    const faceMesh = await ensureFaceMesh()
    if (!faceMesh || uploadedImgRef.current !== img || !live.current.isPhotoMode) return
    try {
      // Two passes: the first detects, the second refines with tracking.
      await faceMesh.send({ image: img })
      await faceMesh.send({ image: img })
    } catch (err) {
      console.warn('[Try-on] Face detection on the photo failed:', err)
    }
  }, [ensureFaceMesh])

  // ==========================================
  // three.js overlay
  // ==========================================
  useEffect(() => {
    const canvas = threeCanvasRef.current
    if (!canvas || !modelUrl) return
    setModelError(null)
    const overlay = startGlassesOverlay(
      canvas,
      modelUrl,
      {
        getViewportSize,
        getVideoSize: getSourceSize,
        getLandmarks: () => faceLandmarksRef.current,
        getPose: () => smoothedPoseRef.current,
        getFacingMode: () => (isMirrored() ? 'user' : 'environment'),
        getManual: () => manualRef.current,
      },
      {
        onProgress: setModelLoadingProgress,
        onLoaded: () => setModelError(null),
        onError: () => setModelError('Could not load the 3D model for this frame.'),
      },
    )
    overlayRef.current = overlay
    return () => {
      overlay.dispose()
      if (overlayRef.current === overlay) overlayRef.current = null
    }
  }, [modelUrl, getSourceSize, getViewportSize])

  // ==========================================
  // Snapshot
  // ==========================================
  const createCompositedSnapshot = async (): Promise<string | null> => {
    try {
      const rect = viewportRef.current?.getBoundingClientRect()
      const width = rect && rect.width > 0 ? Math.round(rect.width) : 1080
      const height = rect && rect.height > 0 ? Math.round(rect.height) : 1350
      const canvas = document.createElement('canvas')
      const dpr = Math.min(window.devicePixelRatio || 2, 2)
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.scale(dpr, dpr)

      // Draws a source with object-fit: cover.
      const drawCover = (src: CanvasImageSource, sw: number, sh: number, mirror: boolean) => {
        const canvasRatio = width / height
        let sx = 0
        let sy = 0
        let cw = sw
        let ch = sh
        if (canvasRatio > sw / sh) {
          ch = sw / canvasRatio
          sy = (sh - ch) / 2
        } else {
          cw = sh * canvasRatio
          sx = (sw - cw) / 2
        }
        ctx.save()
        if (mirror) {
          ctx.translate(width, 0)
          ctx.scale(-1, 1)
        }
        ctx.drawImage(src, sx, sy, cw, ch, 0, 0, width, height)
        ctx.restore()
      }

      const video = videoRef.current
      const img = uploadedImgRef.current
      if (isCameraActive && video?.videoWidth) {
        drawCover(video, video.videoWidth, video.videoHeight, facingMode === 'user')
      } else if (uploadedPhotoUrl && img?.naturalWidth) {
        drawCover(img, img.naturalWidth, img.naturalHeight, false)
      } else {
        ctx.fillStyle = '#0F172A'
        ctx.fillRect(0, 0, width, height)
      }

      if (hasSource && threeCanvasRef.current) {
        overlayRef.current?.renderNow()
        ctx.drawImage(threeCanvasRef.current, 0, 0, width, height)
      }

      // Watermark banner.
      const bannerHeight = Math.max(72, Math.round(height * 0.1))
      const bannerY = height - bannerHeight
      ctx.fillStyle = 'rgba(11, 15, 25, 0.88)'
      ctx.fillRect(0, bannerY, width, bannerHeight)
      ctx.fillStyle = '#D4AF37'
      ctx.fillRect(0, bannerY, width, 2)
      const padX = Math.round(Math.max(20, width * 0.04))
      ctx.font = `bold ${Math.round(bannerHeight * 0.26)}px Inter, system-ui, sans-serif`
      ctx.fillStyle = '#E8C97A'
      ctx.fillText('VISUAL SHOP • VIRTUAL TRY-ON', padX, bannerY + bannerHeight * 0.42)
      ctx.font = `600 ${Math.round(bannerHeight * 0.2)}px Inter, system-ui, sans-serif`
      ctx.fillStyle = '#FFFFFF'
      ctx.fillText(priceLabel ? `${title} • ${priceLabel}` : title, padX, bannerY + bannerHeight * 0.76)

      return canvas.toDataURL('image/jpeg', 0.95)
    } catch (err) {
      console.error('[Try-on] Snapshot failed:', err)
      return null
    }
  }

  const takeSnapshot = async () => {
    setIsCapturing(true)
    try {
      const dataUrl = await createCompositedSnapshot()
      if (dataUrl) setCapturedPhoto(dataUrl)
    } finally {
      setIsCapturing(false)
    }
  }

  const resetAdjustments = () => {
    setManualScale(1)
    setManualOffsetX(0)
    setManualOffsetY(0)
    setManualOffsetZ(0)
    setManualTilt(0)
  }

  const showControls = !isInitialScanning && hasSource
  const shapeLabel = FACE_SHAPE_LABELS[currentFaceShape]
  const snapshotName = `visual-shop-tryon-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'frame'}-${Date.now()}.jpg`

  return (
    <div className="tryon-fullscreen-page">
      <div className="ar-camera-app-root">
        {/* 1. Top HUD bar */}
        <header className="ar-hud-top-bar">
          {onClose ? (
            <button type="button" onClick={onClose} className="ar-hud-btn ar-back-btn" title="Back" aria-label="Back">
              <ArrowLeft className="w-4 h-4" />
            </button>
          ) : (
            <span />
          )}

          <div className="ar-live-status-pill">
            <span className={`status-dot ${isCameraActive ? 'is-live' : 'is-idle'}`} />
            <span className="status-title flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>TRY-ON STORE</span>
            </span>
          </div>

          <div className="ar-top-tools-cluster flex items-center gap-2">
            {isCameraActive && (
              <button type="button" className="ar-hud-tool-btn" onClick={flipCamera} title="Switch front / back camera" aria-label="Switch camera">
                <SwitchCamera className="w-4 h-4 text-amber-300" />
              </button>
            )}
            {isPhotoMode && (
              <>
                <button type="button" className="ar-hud-tool-btn" onClick={() => fileInputRef.current?.click()} title="Upload another photo" aria-label="Upload another photo">
                  <CloudUpload className="w-4 h-4 text-amber-300" />
                </button>
                <button type="button" className="ar-hud-tool-btn" onClick={() => startCamera('user')} title="Use the camera" aria-label="Use the camera">
                  <Camera className="w-4 h-4 text-amber-300" />
                </button>
              </>
            )}
            {onClose && (
              <button type="button" className="ar-hud-tool-btn hover:bg-red-500/20! hover:text-red-400!" onClick={onClose} title="Close try-on" aria-label="Close try-on">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </header>

        {/* 2. Full-screen camera viewport */}
        <main ref={viewportRef} className="ar-camera-viewport">
          <video
            ref={videoRef}
            playsInline
            autoPlay
            muted
            className={`ar-video-stream ${facingMode === 'user' ? 'mirrored' : ''} ${isCameraActive ? 'visible' : 'hidden'}`}
          />

          {isPhotoMode && (
            <img ref={uploadedImgRef} src={uploadedPhotoUrl!} alt="Your uploaded portrait" className="ar-uploaded-img-view" onLoad={handleUploadedImageLoad} />
          )}

          <input type="file" ref={fileInputRef} accept="image/*" style={{ display: 'none' }} onChange={handlePhotoUpload} />

          {/* Launch card (also the camera-denied fallback) */}
          {!hasSource && (
            <div className="ar-camera-launch-placeholder">
              <div className="launch-card-inner">
                <div className="launch-radar-anim">
                  <span className="radar-ring r1" />
                  <span className="radar-ring r2" />
                  <span className="radar-icon">
                    <Camera className="w-8 h-8 text-amber-400 stroke-[1.8]" />
                  </span>
                </div>
                <h3>Live AR Try-On</h3>
                <p>Face tracking follows your face in real time so you can see every frame on you before you buy.</p>

                {cameraError && <div className="camera-error-banner">⚠️ {cameraError}</div>}

                <div className="launch-action-row">
                  <button type="button" onClick={() => startCamera('user')} disabled={isCameraStarting} className="ar-launch-camera-btn">
                    <Sparkles className="w-4 h-4 text-amber-950" />
                    <span>{isCameraStarting ? 'Starting camera...' : 'Start camera'}</span>
                  </button>
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="ar-launch-upload-btn">
                    <CloudUpload className="w-4 h-4 text-amber-300" />
                    <span>Or upload a selfie</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {modelLoadingProgress !== null && (
            <div className="ar-model-loading-pill">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
                <span className="text-xs font-semibold text-white tracking-wide">Loading 3D model... {modelLoadingProgress}%</span>
              </div>
              <div className="w-full bg-white/20 h-1.5 rounded-full overflow-hidden mt-1.5">
                <div
                  className="bg-linear-to-r from-amber-400 to-yellow-300 h-full rounded-full transition-all duration-200"
                  style={{ width: `${Math.max(8, modelLoadingProgress)}%` }}
                />
              </div>
            </div>
          )}

          {modelError && (
            <div className="ar-model-loading-pill" role="alert">
              <span className="text-xs font-semibold text-red-300">{modelError}</span>
            </div>
          )}

          {/* Face-mesh wireframe during the scan */}
          <canvas
            ref={faceMeshCanvasRef}
            className={`ar-facemesh-scan-canvas transition-opacity duration-500 ${isInitialScanning && hasSource ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          />

          {/* 3D glasses layer, revealed after the scan */}
          <canvas
            ref={threeCanvasRef}
            data-testid="tryon-webgl"
            className={`ar-threejs-canvas-overlay transition-opacity duration-700 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          />

          {/* Scan HUD */}
          {isInitialScanning && hasSource && (
            <div className="ar-scan-hud-overlay">
              <div
                className="scan-target-box"
                style={{
                  left: `${facePose.detected ? facePose.x : 50}%`,
                  top: `${facePose.detected ? facePose.y : 43}%`,
                  width: `${Math.max(220, (facePose.detected ? facePose.widthPx : 280) * 1.15)}px`,
                  height: `${Math.max(260, (facePose.detected ? facePose.widthPx : 280) * 1.35)}px`,
                  transform: `translate(-50%, -50%) rotate(${facePose.detected ? facePose.rollDeg : 0}deg)`,
                }}
              >
                <div className="scan-laser-sweep" />
                <span className="scan-corner sc-tl" />
                <span className="scan-corner sc-tr" />
                <span className="scan-corner sc-bl" />
                <span className="scan-corner sc-br" />
                <div className="scan-mesh-grid-anim">
                  <div className="mesh-ring mr-1" />
                  <div className="mesh-ring mr-2" />
                  <div className="mesh-crosshair" />
                </div>
                <div className="scan-live-tag">
                  <span className="live-dot" />
                  <span>FACE TRACKING • 468 PTS</span>
                </div>
              </div>

              <div className="ar-sci-hud-loader-card">
                <div className="sci-hud-title-bar">
                  <span className="sci-hud-pulse-dot" />
                  <span className="sci-hud-title-text">{scanStageInfo.title}</span>
                  <span className="sci-hud-subtitle-text">• {scanStageInfo.subtitle}</span>
                </div>
                <div className="sci-hud-bar-wrapper">
                  <div className="sci-hud-circle-dial">
                    <div className="sci-dial-outer-arc" />
                    <div className="sci-dial-glow-disc">
                      <span className="sci-dial-val">{scanPercent}%</span>
                    </div>
                  </div>
                  <div className="sci-hud-track-box">
                    <div className="sci-segmented-bars-row">
                      {Array.from({ length: 36 }).map((_, idx) => (
                        <span key={idx} className={`sci-bar-notch ${scanPercent >= (idx / 36) * 100 ? 'is-filled' : ''}`} />
                      ))}
                    </div>
                    <div className="sci-track-bottom-row">
                      <span className="sci-loading-ticker">SCANNING...</span>
                      <button type="button" onClick={finishScan} className="sci-skip-link">
                        Skip ➔
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Scan complete toast */}
          {scanJustCompleted && (
            <div
              className="ar-scan-completed-toast animate-toast-cinematic"
              onClick={() => setScanJustCompleted(false)}
              role="button"
              tabIndex={0}
              title="Dismiss"
            >
              <div className="sci-toast-content">
                <div className="sci-toast-header">
                  <span className="sci-toast-icon">✨</span>
                  <span className="sci-toast-label">{isTrackingFace || facePose.detected ? 'Face scan complete' : 'Frame ready'}</span>
                  <button
                    type="button"
                    className="sci-toast-close-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      setScanJustCompleted(false)
                    }}
                    title="Dismiss"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                {facePose.detected && (
                  <div className="sci-toast-title">
                    Face shape: <span className="sci-toast-face-name">{shapeLabel}</span>
                  </div>
                )}
                <div className="sci-toast-desc">
                  {facePose.detected ? `${title} is now fitted to your face.` : 'Use Adjust to position the frame on your face.'}
                </div>
                <div className="sci-toast-laser-line" />
              </div>
            </div>
          )}

          {/* No-face hint (live camera only) */}
          {showControls && isCameraActive && !isTrackingFace && (
            <div className="ar-no-face-hint" role="status">
              <ScanFace className="w-4 h-4 text-amber-300" />
              <span>No face detected. Face the camera in good light.</span>
            </div>
          )}

          {/* Face-shape pill */}
          {showControls && facePose.detected && (
            <div className="ar-floating-diagnosis-pill animate-fade-in" onClick={() => setShowDiagnosisModal(true)}>
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>
                Face shape: <strong>{shapeLabel}</strong>
              </span>
              <Info className="w-3.5 h-3.5 text-slate-400" />
            </div>
          )}

          {/* Fine-tuning controls */}
          {showControls && (
            <>
              <button
                type="button"
                className={`ar-mobile-tuning-toggle ${isTuningPanelOpen ? 'active' : ''}`}
                onClick={() => setIsTuningPanelOpen(!isTuningPanelOpen)}
                title="Adjust frame size and position"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-amber-300" />
                <span>{isTuningPanelOpen ? 'Close' : 'Adjust'}</span>
              </button>

              <div className={`ar-floating-zoom-control ${isTuningPanelOpen ? 'is-mobile-open' : ''}`}>
                <div className="tuning-mobile-header">
                  <span className="text-[10px] font-extrabold tracking-wider text-amber-300 uppercase">Adjust frame</span>
                  <button type="button" className="tuning-close-btn" onClick={() => setIsTuningPanelOpen(false)}>
                    <X className="w-3.5 h-3.5 text-slate-400" />
                  </button>
                </div>

                <div className="zoom-group">
                  <span className="tuning-axis-label">SIZE</span>
                  <button type="button" className="zoom-btn" onClick={() => setManualScale((s) => +Math.min(1.5, s + 0.02).toFixed(2))} title="Larger (+2%)">
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                  <span className="zoom-value">{Math.round(manualScale * 100)}%</span>
                  <button type="button" className="zoom-btn" onClick={() => setManualScale((s) => +Math.max(0.5, s - 0.02).toFixed(2))} title="Smaller (-2%)">
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="divider-line" />

                <div className="zoom-group">
                  <span className="tuning-axis-label">MOVE</span>
                  <button type="button" className="zoom-btn" onClick={() => setManualOffsetY((y) => +(y - 1).toFixed(1))} title="Move up">
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" className="zoom-btn" onClick={() => setManualOffsetY((y) => +(y + 1).toFixed(1))} title="Move down">
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" className="zoom-btn" onClick={() => setManualOffsetX((x) => +(x - 1).toFixed(1))} title="Move left">
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" className="zoom-btn" onClick={() => setManualOffsetX((x) => +(x + 1).toFixed(1))} title="Move right">
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="divider-line" />

                <div className="zoom-group">
                  <span className="tuning-axis-label">DEPTH</span>
                  <button type="button" className="zoom-btn" onClick={() => setManualOffsetZ((z) => +(z + 0.5).toFixed(1))} title="Move the frame away from the face">
                    <span className="text-[10px] font-bold">Z+</span>
                  </button>
                  <button type="button" className="zoom-btn" onClick={() => setManualOffsetZ((z) => +(z - 0.5).toFixed(1))} title="Move the frame closer to the nose">
                    <span className="text-[10px] font-bold">Z-</span>
                  </button>
                </div>

                <div className="divider-line" />

                <div className="zoom-group">
                  <span className="tuning-axis-label">TILT</span>
                  <button type="button" className="zoom-btn" onClick={() => setManualTilt((t) => t + 2)} title="Tilt the frame down">
                    <span className="text-[10px] font-bold">∠+</span>
                  </button>
                  <button type="button" className="zoom-btn" onClick={() => setManualTilt((t) => t - 2)} title="Tilt the frame up">
                    <span className="text-[10px] font-bold">∠-</span>
                  </button>
                </div>

                <div className="divider-line" />

                <button type="button" className="zoom-reset-btn" onClick={resetAdjustments} title="Reset size and position">
                  <RotateCcw className="w-3 h-3" />
                </button>
              </div>
            </>
          )}
        </main>

        {/* 3. Bottom dock: frame catalog, snapshot, buy */}
        <footer className={`ar-bottom-dock ${isDockCollapsed ? 'is-collapsed' : ''}`}>
          <div className="ar-dock-toggle-row">
            <button
              type="button"
              className="ar-dock-collapse-toggle-btn"
              onClick={() => setIsDockCollapsed(!isDockCollapsed)}
              title={isDockCollapsed ? 'Show all frames' : 'Collapse the frame list'}
            >
              <span className="flex items-center gap-1">
                {isDockCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                <span>{isDockCollapsed ? 'Show all frames' : 'Hide frame list'}</span>
              </span>
            </button>
          </div>

          {!selected ? (
            <div className="ar-empty-inventory-banner" role="status">
              <span className="text-2xl mb-1">📦</span>
              <h4 className="text-sm font-bold text-white">No frames listed yet</h4>
              <p className="text-xs text-slate-300 mt-0.5">Check back soon, or list your own frame.</p>
            </div>
          ) : isDockCollapsed ? (
            <div className="ar-mini-collapsed-dock">
              <div className="mini-frame-info">
                <span className="mini-brand">{selected.stockLabel}</span>
                <span className="mini-name">{selected.title}</span>
                <span className="mini-price">{selected.priceLabel}</span>
              </div>
              <div className="mini-actions-cluster">
                <button type="button" className="ar-mini-expand-btn flex items-center gap-1" onClick={() => setIsDockCollapsed(false)} title="Pick another frame">
                  <Glasses className="w-3.5 h-3.5 text-amber-300" />
                  <span>Change frame</span>
                </button>
                <button
                  type="button"
                  className="ar-shutter-capture-btn mini-shutter"
                  onClick={takeSnapshot}
                  disabled={isCapturing || !hasSource}
                  title="Take a photo"
                  aria-label="Take a photo"
                >
                  <div className="shutter-inner-ring">
                    <Camera className="w-4 h-4 text-slate-950 stroke-[2.4]" />
                  </div>
                </button>
                <button type="button" onClick={buySelected} disabled={!buySelected} className="ar-book-frame-cta-btn mini-book flex items-center gap-1">
                  <ShoppingBag className="w-3.5 h-3.5 text-slate-950" />
                  <span>{selected.soldOut ? 'SOLD OUT' : 'BUY'}</span>
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="ar-dock-header-row">
                <div className="active-frame-details">
                  <span className="active-brand-tag">{selected.stockLabel}</span>
                  <h4 className="active-frame-name">{selected.title}</h4>
                  <span className="active-price-text">{selected.priceLabel}</span>
                </div>
                <div className="flex items-center gap-3">
                  <button type="button" className="ar-view-3d-action-btn flex items-center gap-1.5" onClick={() => setIs3DViewerOpen(true)} title="Inspect the frame in 360°">
                    <Box className="w-3.5 h-3.5 text-amber-300" />
                    <span className="btn-text">View in 3D 360°</span>
                  </button>
                </div>
              </div>

              <div className="ar-glasses-carousel-container" ref={attachDockMagnify}>
                <div className="ar-glasses-carousel-track">
                  {frames.map((frame) => {
                    const isSelected = selected.id === frame.id
                    return (
                      <div
                        key={frame.id}
                        className={`ar-glasses-carousel-card ${isSelected ? 'is-selected' : ''} ${frame.soldOut ? 'is-sold-out' : ''}`}
                        onClick={() => setSelectedId(frame.id)}
                        role="button"
                        tabIndex={0}
                        aria-label={`Try on ${frame.title}`}
                        aria-pressed={isSelected}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') setSelectedId(frame.id)
                        }}
                      >
                        <div className="carousel-card-info">
                          <h5 className="carousel-card-name">{frame.title}</h5>
                          <span className="carousel-card-dot">•</span>
                          <span className="carousel-card-price">{frame.soldOut ? 'Sold out' : frame.priceLabel}</span>
                        </div>
                        <div className="carousel-card-preview">
                          <img src={frame.image} alt={frame.title} className="w-full h-full object-contain filter drop-shadow-md" draggable={false} />
                        </div>
                        {isSelected && (
                          <div className="carousel-selected-tick">
                            <Check className="w-2.5 h-2.5" />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="ar-action-dock-bar">
                <button
                  type="button"
                  className="ar-shutter-capture-btn"
                  onClick={takeSnapshot}
                  disabled={isCapturing || !hasSource}
                  title="Take a photo"
                  aria-label="Take a photo"
                >
                  <div className="shutter-inner-ring">
                    <Camera className="w-5 h-5 text-slate-950 stroke-[2.4]" />
                  </div>
                </button>
                <button type="button" onClick={buySelected} disabled={!buySelected} className="ar-book-frame-cta-btn flex items-center gap-2">
                  <ShoppingBag className="w-4 h-4 text-slate-950" />
                  <span className="btn-title">{selected.soldOut ? 'Sold out' : `Buy · ${selected.priceLabel}`}</span>
                  {!selected.soldOut && <ArrowRight className="w-4 h-4 text-slate-950" />}
                </button>
              </div>
            </>
          )}
        </footer>

        {/* Snapshot modal */}
        {capturedPhoto && (
          <div className="ar-snapshot-modal-overlay" onClick={() => setCapturedPhoto(null)}>
            <div className="ar-snapshot-card" onClick={(e) => e.stopPropagation()}>
              <div className="snapshot-header">
                <div className="snapshot-header-titles">
                  <span className="snapshot-badge-gold flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    <span>AR PORTRAIT</span>
                  </span>
                  <h4 className="snapshot-main-title">Your try-on photo</h4>
                </div>
                <button type="button" onClick={() => setCapturedPhoto(null)} className="snapshot-close-btn" title="Close">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="snapshot-info-pill">
                <div className="flex items-center gap-2">
                  <Glasses className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <span className="snapshot-frame-name">{title}</span>
                  {priceLabel && <span className="text-xs text-amber-300 font-bold">• {priceLabel}</span>}
                </div>
              </div>

              <div className="snapshot-preview-frame">
                <img src={capturedPhoto} alt="Try-on snapshot" className="snapshot-img" />
              </div>

              <div className="snapshot-actions-row">
                <a href={capturedPhoto} download={snapshotName} className="snapshot-download-btn">
                  <Download className="w-4 h-4 text-amber-300 flex-shrink-0" />
                  <span>Download photo</span>
                </a>
                {buySelected && (
                  <button
                    type="button"
                    onClick={() => {
                      setCapturedPhoto(null)
                      buySelected()
                    }}
                    className="snapshot-book-btn"
                  >
                    <ShoppingBag className="w-4 h-4 text-slate-950 flex-shrink-0" />
                    <span>Buy this frame · {priceLabel}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 360° viewer for the selected frame */}
        {is3DViewerOpen && selected && (
          <FrameViewerModal
            frame={selected}
            onClose={() => setIs3DViewerOpen(false)}
            onTryOnNow={() => {
              if (!hasSource) void startCamera('user')
            }}
            onBuy={() => buySelected?.()}
          />
        )}

        {/* Face-shape analysis modal */}
        {showDiagnosisModal && (
          <div className="ar-diagnosis-modal-overlay" onClick={() => setShowDiagnosisModal(false)}>
            <div className="ar-diagnosis-card luxury-modal-glow" onClick={(e) => e.stopPropagation()}>
              <div className="diag-header-lux">
                <div className="diag-header-titles">
                  <span className="diag-badge-gold flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    <span>FACE SHAPE ANALYSIS</span>
                  </span>
                  <h3 className="diag-main-title">Your face proportions</h3>
                </div>
                <button type="button" onClick={() => setShowDiagnosisModal(false)} className="diag-close-lux" title="Close">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="diag-body-lux">
                <div className="face-shape-mode-box">
                  <div className="mode-box-header">
                    <span className="mode-title-tag">FACE SHAPE:</span>
                    <span className={`mode-status-indicator ${manualFaceShape === null ? 'is-auto' : 'is-manual'}`}>
                      {manualFaceShape === null ? (
                        <span className="flex items-center gap-1">
                          <Zap className="w-3 h-3 text-amber-400" />
                          <span>Detected live</span>
                        </span>
                      ) : (
                        <span>Chosen manually</span>
                      )}
                    </span>
                  </div>
                  <div className="face-shape-chips-row">
                    <button
                      type="button"
                      className={`shape-chip-btn chip-auto-btn flex items-center gap-1.5 ${manualFaceShape === null ? 'active' : ''}`}
                      onClick={() => setManualFaceShape(null)}
                    >
                      <Zap className="w-3.5 h-3.5 text-amber-400" />
                      <span>Auto</span>
                      {manualFaceShape === null && <span className="chip-active-dot" />}
                    </button>
                    {FACE_SHAPES.map((shape) => (
                      <button
                        key={shape}
                        type="button"
                        className={`shape-chip-btn flex items-center gap-1 ${manualFaceShape === shape ? 'active' : ''}`}
                        onClick={() => setManualFaceShape(shape)}
                      >
                        <span>{FACE_SHAPE_LABELS[shape]}</span>
                        {manualFaceShape === shape && <Check className="w-3 h-3 text-amber-400" />}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="face-telemetry-panel">
                  <div className="tel-panel-head">
                    <span className="tel-panel-title">FACE MEASUREMENTS</span>
                    <span className="tel-live-tag">LIVE</span>
                  </div>
                  <div className="telemetry-grid">
                    <div className="telemetry-item">
                      <span className="tel-label">Length / width</span>
                      <strong className="tel-val">{faceMetrics.ratio} : 1</strong>
                      <div className="tel-bar-wrap">
                        <div className="tel-bar-fill" style={{ width: `${Math.min(100, (faceMetrics.ratio / 1.6) * 100)}%` }} />
                      </div>
                      <small className="tel-hint">{faceMetrics.ratio > 1.36 ? 'Long (oval)' : 'Round / square'}</small>
                    </div>
                    <div className="telemetry-item">
                      <span className="tel-label">Forehead width</span>
                      <strong className="tel-val">{faceMetrics.foreheadRatio}%</strong>
                      <div className="tel-bar-wrap">
                        <div className="tel-bar-fill" style={{ width: `${Math.min(100, faceMetrics.foreheadRatio)}%` }} />
                      </div>
                      <small className="tel-hint">Relative to cheekbones</small>
                    </div>
                    <div className="telemetry-item">
                      <span className="tel-label">Jaw width</span>
                      <strong className="tel-val">{faceMetrics.jawRatio}%</strong>
                      <div className="tel-bar-wrap">
                        <div className="tel-bar-fill" style={{ width: `${Math.min(100, faceMetrics.jawRatio)}%` }} />
                      </div>
                      <small className="tel-hint">{faceMetrics.jawRatio > 82 ? 'Angular jaw' : 'Soft jaw'}</small>
                    </div>
                    <div className="telemetry-item">
                      <span className="tel-label">Chin angle</span>
                      <strong className="tel-val">{faceMetrics.chinAngle}°</strong>
                      <div className="tel-bar-wrap">
                        <div className="tel-bar-fill" style={{ width: `${Math.min(100, (faceMetrics.chinAngle / 90) * 100)}%` }} />
                      </div>
                      <small className="tel-hint">Chin taper</small>
                    </div>
                  </div>
                </div>

                <div className="diag-guide-box">
                  <h5 className="guide-title">FRAME STYLES THAT SUIT EACH FACE SHAPE:</h5>
                  <div className="guide-grid">
                    {FACE_SHAPES.map((shape) => (
                      <div key={shape} className="guide-item">
                        <span className="guide-shape">
                          {FACE_SHAPE_LABELS[shape]}
                          {shape === currentFaceShape ? ' (you)' : ''}:
                        </span>
                        <span className="guide-desc">{shape === currentFaceShape ? <strong>{FACE_SHAPE_TIPS[shape]}</strong> : FACE_SHAPE_TIPS[shape]}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="diag-footer-lux">
                <button type="button" onClick={() => setShowDiagnosisModal(false)} className="diag-confirm-btn flex items-center justify-center gap-1.5">
                  <span>Back to try-on</span>
                  <Sparkles className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
