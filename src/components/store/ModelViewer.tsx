import { useEffect, useRef, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { Loader2 } from 'lucide-react'
import { createStudioEnvironment } from '@/lib/eyewear-3d/environment'
import { disposeModel } from '@/lib/eyewear-3d/reconstruction/asset'
import { cn } from '@/lib/cn'

/** Resume spinning this long after the user lets go. */
const RESUME_AUTO_ROTATE_MS = 2500

interface ModelViewerProps {
  /** GLB to show, from `modelUrl(listing.imageUrl, listing.imageType)`. Empty renders `fallback`. */
  url: string
  /** Shown when there is no model or it fails to load (e.g. the 2D thumbnail). */
  fallback?: ReactNode
  /** Scroll to zoom. Off by default so the wheel still scrolls the page around it. */
  zoom?: boolean
  className?: string
}

/** A GLB on a transparent background that spins on its own; drag to rotate it (docs/plan.md, C1). */
export function ModelViewer({ url, fallback, zoom = false, className }: ModelViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    const container = containerRef.current
    if (!container || !url) return
    let disposed = false
    let frameId = 0
    let resumeTimer: ReturnType<typeof setTimeout> | undefined
    let model: THREE.Object3D | undefined
    let env: THREE.Texture | undefined
    setStatus('loading')

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.domElement.className = 'block size-full cursor-grab active:cursor-grabbing'
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(30, 1, 0.001, 100)
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.8)
    keyLight.position.set(2, 4, 3)
    scene.add(keyLight)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.enablePan = false
    controls.enableZoom = zoom
    controls.autoRotate = true
    controls.autoRotateSpeed = 3
    // Keep the view around eye level; straight down a frame is just two lines.
    controls.minPolarAngle = Math.PI * 0.25
    controls.maxPolarAngle = Math.PI * 0.7
    controls.addEventListener('start', () => {
      clearTimeout(resumeTimer)
      controls.autoRotate = false
    })
    controls.addEventListener('end', () => {
      resumeTimer = setTimeout(() => (controls.autoRotate = true), RESUME_AUTO_ROTATE_MS)
    })

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = container
      if (!w || !h) return
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(container)

    createStudioEnvironment(renderer)
      .then((tex) => {
        if (disposed) return tex.dispose()
        env = tex
        scene.environment = tex
      })
      .catch((err) => console.warn('[ModelViewer] Environment map unavailable:', err))

    new GLTFLoader().load(
      url,
      (gltf) => {
        if (disposed) return disposeModel(gltf.scene, true)
        model = gltf.scene
        // Center the frame at the origin, then back the camera off until it fits at every turn:
        // spinning around Y, it sweeps a cylinder as wide as its footprint's diagonal.
        const box = new THREE.Box3().setFromObject(model)
        model.position.sub(box.getCenter(new THREE.Vector3()))
        scene.add(model)
        const size = box.getSize(new THREE.Vector3())
        const sweep = Math.hypot(size.x, size.z) / 2 || 1
        const halfV = THREE.MathUtils.degToRad(camera.fov / 2)
        const halfH = Math.atan(Math.tan(halfV) * camera.aspect)
        const distance = Math.max(sweep / Math.sin(halfH), size.y / 2 / Math.tan(halfV) + sweep) * 1.05
        // Start from the front, turned a little so the temples show.
        camera.position.set(Math.sin(0.5) * distance, distance * 0.12, Math.cos(0.5) * distance)
        camera.near = distance / 100
        camera.far = distance * 100
        camera.updateProjectionMatrix()
        controls.minDistance = distance * 0.5
        controls.maxDistance = distance * 2
        controls.target.set(0, 0, 0)
        controls.update()
        setStatus('ready')
      },
      undefined,
      (err) => {
        if (disposed) return
        console.error('[ModelViewer] Failed to load the model:', err)
        setStatus('error')
      },
    )

    const animate = () => {
      frameId = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      disposed = true
      cancelAnimationFrame(frameId)
      clearTimeout(resumeTimer)
      observer.disconnect()
      controls.dispose()
      if (model) disposeModel(model, true)
      env?.dispose()
      renderer.dispose()
      // The fitting room already holds WebGL contexts; give this one back right away.
      renderer.forceContextLoss()
      renderer.domElement.remove()
    }
  }, [url, zoom])

  if (!url || status === 'error') return <div className={className}>{fallback}</div>

  return (
    <div className={cn('relative', className)}>
      <div ref={containerRef} className="absolute inset-0" />
      {status === 'loading' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Loader2 className="size-5 animate-spin text-white/50" />
        </div>
      )}
    </div>
  )
}
