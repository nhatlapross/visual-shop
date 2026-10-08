import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { Box, Glasses, RefreshCw, RotateCcw, ShoppingBag, Sparkles, X } from 'lucide-react'
import { createStudioEnvironment } from '@/lib/eyewear-3d/environment'

export interface FrameViewerItem {
  title: string
  priceLabel: string
  modelUrl: string
  stockLabel: string
  soldOut: boolean
}

interface FrameViewerModalProps {
  frame: FrameViewerItem
  onClose: () => void
  onTryOnNow: () => void
  onBuy: () => void
}

/** 360° inspector for one frame: drag to rotate, scroll to zoom. */
export function FrameViewerModal({ frame, onClose, onTryOnNow, onBuy }: FrameViewerModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isAutoRotate, setIsAutoRotate] = useState(true)
  const autoRotateRef = useRef(isAutoRotate)
  autoRotateRef.current = isAutoRotate
  const resetViewRef = useRef<() => void>(() => {})
  const [loadingProgress, setLoadingProgress] = useState<number | null>(10)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !frame.modelUrl) return
    let cancelled = false
    let animFrameId = 0
    let envTexture: THREE.Texture | null = null
    let model: THREE.Object3D | null = null
    setLoadingProgress(10)
    setLoadError(false)

    let isDragging = false
    let prev = { x: 0, y: 0 }
    let targetRotX = 0.15
    let targetRotY = 0.4
    let curRotX = 0.15
    let curRotY = 0.4
    let targetZoom = 1
    let curZoom = 1
    resetViewRef.current = () => {
      targetRotX = 0.15
      targetRotY = 0.4
      targetZoom = 1
    }

    const width = canvas.clientWidth || 600
    const height = canvas.clientHeight || 450
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 1000)
    camera.position.set(0, 0.05, 0.45)
    camera.lookAt(0, 0, 0)
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
    renderer.setSize(width, height, false)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.toneMapping = THREE.ACESFilmicToneMapping

    // The environment map lights the frame; the directional lights only add highlights.
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.9)
    keyLight.position.set(2, 4, 3)
    scene.add(keyLight)
    const fillLight = new THREE.DirectionalLight(0xd4af37, 0.4)
    fillLight.position.set(-3, 1, 2)
    scene.add(fillLight)
    const rimLight = new THREE.DirectionalLight(0x60a5fa, 0.6)
    rimLight.position.set(0, -2, -3)
    scene.add(rimLight)
    createStudioEnvironment(renderer)
      .then((tex) => {
        if (cancelled) return tex.dispose()
        envTexture = tex
        scene.environment = tex
      })
      .catch((err) => console.warn('[Try-on] Environment map unavailable:', err))

    const modelGroup = new THREE.Group()
    scene.add(modelGroup)
    new GLTFLoader().load(
      frame.modelUrl,
      (gltf) => {
        if (cancelled) return
        setLoadingProgress(null)
        model = gltf.scene
        const box = new THREE.Box3().setFromObject(model)
        const center = box.getCenter(new THREE.Vector3())
        const size = box.getSize(new THREE.Vector3())
        const s = 0.3 / (Math.max(size.x, size.y, size.z) || 1)
        model.scale.setScalar(s)
        model.position.set(-center.x * s, -center.y * s, -center.z * s)
        modelGroup.add(model)
      },
      (p) => {
        if (p.total > 0) setLoadingProgress(Math.min(99, Math.round((p.loaded / p.total) * 100)))
      },
      (err) => {
        if (cancelled) return
        console.error('[Try-on] Failed to load the 3D viewer model:', err)
        setLoadingProgress(null)
        setLoadError(true)
      },
    )

    const onPointerDown = (e: PointerEvent) => {
      isDragging = true
      prev = { x: e.clientX, y: e.clientY }
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging) return
      targetRotY += (e.clientX - prev.x) * 0.008
      targetRotX = Math.max(-1.2, Math.min(1.2, targetRotX + (e.clientY - prev.y) * 0.008))
      prev = { x: e.clientX, y: e.clientY }
    }
    const onPointerUp = () => {
      isDragging = false
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      targetZoom = Math.max(0.6, Math.min(2.2, targetZoom - e.deltaY * 0.001))
    }
    canvas.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })

    const animate = () => {
      if (cancelled) return
      if (autoRotateRef.current && !isDragging) targetRotY += 0.008
      curRotX += (targetRotX - curRotX) * 0.1
      curRotY += (targetRotY - curRotY) * 0.1
      curZoom += (targetZoom - curZoom) * 0.1
      modelGroup.rotation.set(curRotX, curRotY, 0)
      modelGroup.scale.setScalar(curZoom)
      renderer.render(scene, camera)
      animFrameId = requestAnimationFrame(animate)
    }
    animate()

    return () => {
      cancelled = true
      cancelAnimationFrame(animFrameId)
      canvas.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('wheel', onWheel)
      model?.traverse((child) => {
        const mesh = child as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.geometry?.dispose()
        for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) mat?.dispose()
      })
      envTexture?.dispose()
      renderer.dispose()
    }
  }, [frame.modelUrl])

  return (
    <div className="ar-3d-modal-overlay" onClick={onClose}>
      <div className="ar-3d-modal-card luxury-modal-glow" onClick={(e) => e.stopPropagation()}>
        <div className="ar-3d-modal-header">
          <div className="flex items-center gap-3">
            <span className="ar-3d-tag-gold flex items-center gap-1.5">
              <Box className="w-3.5 h-3.5 text-amber-300" />
              <span>360° 3D VIEWER</span>
            </span>
          </div>
          <button type="button" onClick={onClose} className="diag-close-lux" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="ar-3d-modal-body">
          <div className="ar-3d-canvas-wrapper">
            <canvas ref={canvasRef} className="ar-3d-interactive-canvas" />

            {loadingProgress !== null && (
              <div className="ar-3d-loading-overlay">
                <div className="loading-spinner-gold" />
                <span className="text-sm font-bold text-amber-400 mt-2 flex items-center gap-1.5">
                  <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
                  <span>Loading 3D model... {loadingProgress}%</span>
                </span>
              </div>
            )}
            {loadError && (
              <div className="ar-3d-loading-overlay">
                <span className="text-sm font-bold text-red-300">Could not load the 3D model.</span>
              </div>
            )}

            <div className="ar-3d-drag-hint">
              <span className="flex items-center gap-1.5 justify-center">
                <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                <span>Drag to rotate 360° • Scroll to zoom</span>
              </span>
            </div>

            <div className="ar-3d-floating-controls">
              <button
                type="button"
                className={`ctrl-3d-btn flex items-center justify-center gap-1.5 ${isAutoRotate ? 'active' : ''}`}
                onClick={() => setIsAutoRotate(!isAutoRotate)}
                title="Toggle auto-rotate"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isAutoRotate ? 'animate-spin' : ''}`} />
                <span className="whitespace-nowrap">{isAutoRotate ? 'Stop rotating' : 'Auto-rotate'}</span>
              </button>
              <button
                type="button"
                className="ctrl-3d-btn flex items-center justify-center gap-1.5"
                onClick={() => {
                  setIsAutoRotate(false)
                  resetViewRef.current()
                }}
                title="Reset the view"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="whitespace-nowrap">Reset view</span>
              </button>
            </div>
          </div>

          <div className="ar-3d-info-sidebar">
            <div className="ar-3d-info-top">
              <span className="ar-3d-brand">VISUAL SHOP</span>
              <h3 className="ar-3d-title">{frame.title}</h3>
              <div className="ar-3d-price-row">
                <span className="ar-3d-price">{frame.priceLabel}</span>
                <span className="ar-3d-badge-instock flex items-center gap-1">
                  <span>{frame.stockLabel}</span>
                </span>
              </div>
            </div>

            <div className="ar-3d-specs-table">
              <div className="spec-row">
                <span className="spec-label">Model:</span>
                <strong className="spec-val text-emerald-400">GLB, stored on Walrus</strong>
              </div>
              <div className="spec-row">
                <span className="spec-label">Payment:</span>
                <strong className="spec-val text-white">SUI (testnet)</strong>
              </div>
            </div>

            <div className="ar-3d-action-buttons">
              <button
                type="button"
                className="ar-3d-tryon-cta-btn flex items-center justify-center gap-2"
                onClick={() => {
                  onClose()
                  onTryOnNow()
                }}
              >
                <Glasses className="w-4 h-4 text-amber-300 flex-shrink-0" />
                <span className="whitespace-nowrap">Try it on</span>
              </button>
              <button
                type="button"
                className="ar-3d-book-cta-btn flex items-center justify-center gap-2"
                disabled={frame.soldOut}
                onClick={() => {
                  onClose()
                  onBuy()
                }}
              >
                <ShoppingBag className="w-4 h-4 text-slate-950 flex-shrink-0" />
                <span className="whitespace-nowrap">{frame.soldOut ? 'Sold out' : `Buy · ${frame.priceLabel}`}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
