import type { CSSProperties, ReactNode } from "react";
import LiquidGlass from "liquid-glass-react";

interface Props {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  radius?: number;
}

export default function GlassSurface({ children, className = "", style, radius = 8 }: Props) {
  const variables = {
    ...style,
    "--liquid-fill": "var(--glass-alpha)",
    "--liquid-strength": "var(--glass-refraction)",
  } as CSSProperties;

  return (
    <div className={`liquid-host ${className}`.trim()} style={variables}>
      <LiquidGlass
        className="native-liquid"
        style={{ width: "100%", height: "100%" }}
        padding="0"
        cornerRadius={radius}
        displacementScale={108}
        blurAmount={0.008}
        saturation={168}
        aberrationIntensity={0.75}
        elasticity={0.14}
        mode="standard"
      >
        <span className="liquid-filter-content" aria-hidden="true" />
      </LiquidGlass>
      <div className="liquid-content">{children}</div>
    </div>
  );
}
