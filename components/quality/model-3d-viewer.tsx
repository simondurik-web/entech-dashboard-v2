"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import { Canvas, useFrame } from "@react-three/fiber"
import { Bounds, Environment, Html, OrbitControls, useGLTF, useProgress } from "@react-three/drei"
import { Box, Pause, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth-context"
import { useI18n } from "@/lib/i18n"
import { userHeaders } from "@/lib/quality/form-utils"
import type * as THREE from "three"

interface Model3DViewerProps {
  partNumber: string
  label?: string
}

function ModelMesh({ url, autoRotate }: { url: string; autoRotate: boolean }) {
  const { scene } = useGLTF(url)
  const groupRef = useRef<THREE.Group>(null)

  useFrame((_, delta) => {
    if (autoRotate && groupRef.current) groupRef.current.rotation.y += delta * 0.3
  })

  return <primitive ref={groupRef} object={scene.clone()} />
}

function LoadProgress() {
  const { progress } = useProgress()
  return (
    <Html center>
      <div className="rounded-full bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow">
        {Math.round(progress)}%
      </div>
    </Html>
  )
}

export function Model3DViewer({ partNumber, label }: Model3DViewerProps) {
  const { profile } = useAuth()
  const { t } = useI18n()
  const [url, setUrl] = useState<string | null | undefined>(undefined)
  const [autoRotate, setAutoRotate] = useState(true)

  useEffect(() => {
    let cancelled = false
    setUrl(undefined)
    ;(async () => {
      try {
        const res = await fetch(`/api/quality/models3d?part=${encodeURIComponent(partNumber)}`, {
          headers: userHeaders(profile?.id),
        })
        const data = await res.json()
        if (!cancelled) setUrl(data.url ?? null)
      } catch {
        if (!cancelled) setUrl(null)
      }
    })()
    return () => { cancelled = true }
  }, [partNumber, profile?.id])

  if (url === null) return null

  return (
    <div className="space-y-2 rounded-md border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase text-blue-600 dark:text-blue-400">
          <Box className="size-3" />
          {t("quality.model3d.title")} - {label || partNumber}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => setAutoRotate((value) => !value)}
        >
          {autoRotate ? <Pause className="mr-1 size-3" /> : <Play className="mr-1 size-3" />}
          {autoRotate ? t("quality.model3d.pause") : t("quality.model3d.rotate")}
        </Button>
      </div>
      <div className="h-[260px] overflow-hidden rounded-md border bg-muted sm:h-[360px]">
        {url === undefined ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            {t("quality.model3d.loading")}
          </div>
        ) : (
          <Canvas dpr={[1, 2]} camera={{ position: [0, 0, 3], fov: 45 }}>
            <Suspense fallback={<LoadProgress />}>
              <ambientLight intensity={0.4} />
              <directionalLight position={[5, 5, 5]} intensity={0.8} castShadow />
              <directionalLight position={[-5, -3, -5]} intensity={0.3} />
              <Environment preset="city" />
              <Bounds fit clip observe={false} margin={1.1}>
                <ModelMesh url={url} autoRotate={autoRotate} />
              </Bounds>
            </Suspense>
            <OrbitControls
              enableDamping
              dampingFactor={0.1}
              makeDefault
              autoRotate={false}
              minDistance={0.1}
              maxDistance={50}
              zoomSpeed={1.2}
            />
          </Canvas>
        )}
      </div>
    </div>
  )
}
