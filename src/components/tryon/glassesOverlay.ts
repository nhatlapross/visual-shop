import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { createStudioEnvironment } from '@/lib/eyewear-3d/environment'
import { coverSize, type Landmark } from './faceTracking'

export interface SmoothedPose {
  x: number
  y: number
  widthPx: number
  rollDeg: number
  pitchDeg: number
  yawDeg: number
}

export interface ManualAdjust {
  scale: number
  offsetX: number
  offsetY: number
  offsetZ: number
  tilt: number
}

export interface OverlayInputs {
  getViewportSize(): { width: number; height: number }
  /** Intrinsic size of the live video (falls back to 640×480). */
  getVideoSize(): { width: number; height: number }
  getLandmarks(): Landmark[] | null
  getPose(): SmoothedPose
  getFacingMode(): 'user' | 'environment'
  getManual(): ManualAdjust
}

export interface OverlayCallbacks {
  onProgress(percent: number | null): void
  onLoaded(): void
  onError(error: unknown): void
}

export interface GlassesOverlay {
  /** Renders one frame synchronously (used right before a snapshot). */
  renderNow(): void
  dispose(): void
}

const FOV = 45

/**
 * three.js overlay that draws the GLB frame over the camera feed and follows the FaceMesh landmarks.
 * The camera maps 1 world unit to 1 CSS pixel at z = 0, so landmark positions are used in pixels.
 * The model is normalised by its bounding box (front of the frame at z = 0, temples along -z),
 * so it works for any unit (the studio exports meters).
 */
export function startGlassesOverlay(
  canvas: HTMLCanvasElement,
  modelUrl: string,
  inputs: OverlayInputs,
  callbacks: OverlayCallbacks,
): GlassesOverlay {
  let disposed = false
  let animFrameId = 0

  const { width, height } = inputs.getViewportSize()
  canvas.width = width
  canvas.height = height

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(FOV, width / height, 1, 5000)
  camera.position.set(0, 0, height / 2 / Math.tan((FOV * Math.PI) / 360))
  camera.lookAt(0, 0, 0)

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
  renderer.setSize(width, height, false)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0x000000, 0)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05

  // Image-based lighting for metal and acetate; the lights add highlights on top.
  let envTexture: THREE.Texture | null = null
  createStudioEnvironment(renderer)
    .then((tex) => {
      if (disposed) return tex.dispose()
      envTexture = tex
      scene.environment = tex
    })
    .catch((err) => console.warn('[Try-on] Environment map unavailable:', err))

  scene.add(new THREE.AmbientLight(0xffffff, 0.9))
  const frontLight = new THREE.DirectionalLight(0xffffff, 1.4)
  frontLight.position.set(0, 200, 1000)
  scene.add(frontLight)
  const leftLight = new THREE.DirectionalLight(0xffffff, 0.7)
  leftLight.position.set(-500, 300, 400)
  scene.add(leftLight)
  const rightLight = new THREE.DirectionalLight(0xffffff, 0.7)
  rightLight.position.set(500, 300, 400)
  scene.add(rightLight)
  const backLight = new THREE.DirectionalLight(0xffffff, 0.5)
  backLight.position.set(0, -200, -500)
  scene.add(backLight)

  const pivotGroup = new THREE.Group()
  scene.add(pivotGroup)

  // Invisible head occluder: writes depth only, so temple arms that pass behind the head are hidden.
  // Its front surface sits just behind the frame front (z = 0), with a dip at the nose bridge,
  // so the front frame and lenses always stay visible.
  const occluderMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, side: THREE.DoubleSide })
  const occluderGeo = (() => {
    const geo = new THREE.SphereGeometry(0.5, 48, 36)
    geo.scale(0.78, 1.18, 1.1)
    const pos = geo.getAttribute('position')
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const y = pos.getY(i)
      const worldZ = pos.getZ(i) - 0.48
      if (worldZ > -0.045) {
        const targetZ = Math.abs(x) < 0.32 && y > -0.22 && y < 0.22 ? -0.065 : -0.045
        pos.setZ(i, targetZ + 0.48)
      }
    }
    pos.needsUpdate = true
    geo.computeVertexNormals()
    geo.translate(0, -0.08, -0.48)
    return geo
  })()
  const headOccluder = new THREE.Mesh(occluderGeo, occluderMat)
  headOccluder.renderOrder = 0
  pivotGroup.add(headOccluder)

  let model: THREE.Object3D | null = null
  let modelBaseWidth = 1
  let lastW = width
  let lastH = height

  callbacks.onProgress(10)
  new GLTFLoader().load(
    modelUrl,
    (gltf) => {
      if (disposed) return disposeObject(gltf.scene)
      const root = gltf.scene
      root.traverse((child) => {
        const mesh = child as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.renderOrder = 2
        const fix = (mat: THREE.Material) => {
          const physical = mat as THREE.MeshPhysicalMaterial
          // Transmission samples an opaque background, which is empty on a transparent canvas
          // and turns lenses black. Use a simple translucent tint instead.
          if (physical.isMeshPhysicalMaterial && physical.transmission > 0) {
            const lens = physical.clone()
            lens.transmission = 0
            lens.transparent = true
            lens.opacity = Math.min(physical.opacity, 0.22)
            lens.metalness = 0
            lens.depthWrite = false
            mesh.renderOrder = 3
            return lens
          }
          mat.depthTest = true
          mat.depthWrite = true
          return mat
        }
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(fix) : fix(mesh.material)
      })

      // Centre on the bridge and put the front of the frame at z = 0 so the temples run back along -z.
      const box = new THREE.Box3().setFromObject(root)
      const center = box.getCenter(new THREE.Vector3())
      const size = box.getSize(new THREE.Vector3())
      root.position.set(-center.x, -center.y, -box.max.z)

      modelBaseWidth = Math.max(1e-4, size.x)
      headOccluder.scale.setScalar(modelBaseWidth)
      pivotGroup.add(root)
      model = root
      callbacks.onProgress(null)
      callbacks.onLoaded()
    },
    (progress) => {
      if (disposed) return
      if (progress.total > 0) callbacks.onProgress(Math.min(99, Math.round((progress.loaded / progress.total) * 100)))
      else if (progress.loaded) callbacks.onProgress(60)
    },
    (err) => {
      if (disposed) return
      console.error('[Try-on] Failed to load the GLB model:', err)
      callbacks.onProgress(null)
      callbacks.onError(err)
    },
  )

  function updatePose() {
    const { width: vpW, height: vpH } = inputs.getViewportSize()
    if (vpW === 0 || vpH === 0) return

    if (vpW !== lastW || vpH !== lastH) {
      lastW = vpW
      lastH = vpH
      camera.aspect = vpW / vpH
      camera.position.set(0, 0, vpH / 2 / Math.tan((FOV * Math.PI) / 360))
      camera.updateProjectionMatrix()
      renderer.setSize(vpW, vpH, false)
    }

    const vid = inputs.getVideoSize()
    const rendered = coverSize(vpW, vpH, vid.width, vid.height)
    const manual = inputs.getManual()
    const facing = inputs.getFacingMode()
    const landmarks = inputs.getLandmarks()

    if (landmarks && landmarks.length >= 468) {
      // Landmark → world space in pixels, origin at the viewport centre.
      const to3D = (pt: Landmark) => {
        const normX = facing === 'user' ? 0.5 - pt.x : pt.x - 0.5
        return new THREE.Vector3(normX * rendered.width, (0.5 - pt.y) * rendered.height, -(pt.z || 0) * rendered.width * 1.5)
      }
      const mirrored = facing === 'user'
      const pLeftOuter = to3D(mirrored ? landmarks[263] : landmarks[33])
      const pRightOuter = to3D(mirrored ? landmarks[33] : landmarks[263])
      const pLeftInner = to3D(mirrored ? landmarks[362] : landmarks[133])
      const pRightInner = to3D(mirrored ? landmarks[133] : landmarks[362])
      const pEyeCenter = new THREE.Vector3().addVectors(pLeftInner, pRightInner).multiplyScalar(0.5)

      // Rigid upper face and nose midline (not affected by mouth or jaw motion).
      const pNoseRoot = to3D(landmarks[168])
      const pNoseMid = to3D(landmarks[6])
      const pForehead = to3D(landmarks[10])
      const pSubnasale = to3D(landmarks[2] || landmarks[164] || landmarks[1])

      // Orthonormal face basis: X along the eye line, Z out of the face, Y up.
      const vecX = new THREE.Vector3().subVectors(pRightOuter, pLeftOuter).normalize()
      const vecYMid = new THREE.Vector3().subVectors(pForehead, pSubnasale).normalize()
      const vecZ = new THREE.Vector3().crossVectors(vecX, vecYMid).normalize()
      if (vecZ.z < 0) vecZ.negate()
      const vecY = new THREE.Vector3().crossVectors(vecZ, vecX).normalize()

      const targetQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(vecX, vecY, vecZ))
      if (manual.tilt !== 0) {
        targetQ.premultiply(new THREE.Quaternion().setFromAxisAngle(vecX, (manual.tilt * Math.PI) / 180))
      }
      pivotGroup.quaternion.slerp(targetQ, 0.48)

      // Bridge position, pushed forward along the face normal (~8% of the eye span ≈ 11–13 mm).
      const eyeSpan = pLeftOuter.distanceTo(pRightOuter)
      const bridge = new THREE.Vector3()
        .addScaledVector(pNoseMid, 0.45)
        .addScaledVector(pNoseRoot, 0.35)
        .addScaledVector(pEyeCenter, 0.2)
      const forward = vecZ.clone().multiplyScalar(eyeSpan * 0.08 + manual.offsetZ * 0.005 * vpW)
      pivotGroup.position.lerp(
        new THREE.Vector3(
          bridge.x + forward.x + manual.offsetX * 0.005 * vpW,
          bridge.y + forward.y - manual.offsetY * 0.005 * vpH,
          bridge.z + forward.z,
        ),
        0.48,
      )

      // Frame width ≈ 1.46 × outer eye-corner span.
      const targetScale = (Math.max(120, eyeSpan * 1.46) * manual.scale) / modelBaseWidth
      const cur = pivotGroup.scale.x || targetScale
      pivotGroup.scale.setScalar(THREE.MathUtils.lerp(cur, targetScale, 0.4))
    } else {
      // No landmarks (uploaded photo, or no face found yet): place by the smoothed 2D pose + manual sliders.
      const pose = inputs.getPose()
      const normX = facing === 'user' ? (50 - pose.x) / 100 : (pose.x - 50) / 100
      const normY = (50 - pose.y) / 100
      pivotGroup.position.set(
        normX * rendered.width + (manual.offsetX / 100) * vpW,
        normY * rendered.height - (manual.offsetY / 100) * vpH,
        0,
      )
      pivotGroup.scale.setScalar((pose.widthPx * 0.88 * manual.scale) / modelBaseWidth)
      pivotGroup.rotation.order = 'YXZ'
      pivotGroup.rotation.set(
        (-pose.pitchDeg * Math.PI) / 180 + (manual.tilt * Math.PI) / 180,
        (pose.yawDeg * Math.PI) / 180,
        (-pose.rollDeg * Math.PI) / 180,
      )
    }
  }

  function renderNow() {
    if (disposed || !model) return
    updatePose()
    renderer.render(scene, camera)
  }

  function loop() {
    if (disposed) return
    renderNow()
    animFrameId = requestAnimationFrame(loop)
  }
  loop()

  return {
    renderNow,
    dispose() {
      disposed = true
      cancelAnimationFrame(animFrameId)
      if (model) disposeObject(model)
      occluderGeo.dispose()
      occluderMat.dispose()
      envTexture?.dispose()
      renderer.dispose()
    },
  }
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry?.dispose()
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const mat of mats) {
      if (!mat) continue
      for (const value of Object.values(mat)) {
        if (value instanceof THREE.Texture) value.dispose()
      }
      mat.dispose()
    }
  })
}
