import type * as React from "react"

declare module "react/jsx-runtime" {
  namespace JSX {
    interface IntrinsicElements {
      primitive: { object: object; ref?: React.Ref<unknown>; [key: string]: unknown }
      ambientLight: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { intensity?: number }
      directionalLight: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        position?: [number, number, number]
        intensity?: number
        castShadow?: boolean
      }
    }
  }
}

declare module "react/jsx-dev-runtime" {
  namespace JSX {
    interface IntrinsicElements {
      primitive: { object: object; ref?: React.Ref<unknown>; [key: string]: unknown }
      ambientLight: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { intensity?: number }
      directionalLight: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        position?: [number, number, number]
        intensity?: number
        castShadow?: boolean
      }
    }
  }
}
