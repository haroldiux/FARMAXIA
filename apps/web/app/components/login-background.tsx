"use client";

import dynamic from "next/dynamic";
import { useTheme } from "../lib/theme";
import type { RGB } from "./dither";

// three.js solo funciona en el navegador: el fondo no se genera en el servidor.
const Dither = dynamic(() => import("./dither"), { ssr: false });

const palettes: Record<"light" | "dark", { waveColor: RGB; backgroundColor: RGB }> = {
  dark: { waveColor: [0.06666666666666667, 0.24313725490196078, 0.5294117647058824], backgroundColor: [0, 0, 0] },
  light: { waveColor: [0.4117647058823529, 0.5882352941176471, 0.8745098039215686], backgroundColor: [0.17254901960784313, 0.29411764705882354, 0.49019607843137253] }
};

/**
 * Fondo animado del login; cambia de colores con el tema. Siempre se anima y sigue al
 * mouse, aunque Windows tenga desactivados los "Efectos de animación" (decisión del producto).
 */
export function LoginBackground() {
  const theme = useTheme();
  const palette = palettes[theme];
  return (
    <div aria-hidden="true" className="login-background">
      <Dither
        backgroundColor={palette.backgroundColor}
        colorNum={4}
        disableAnimation={false}
        enableMouseInteraction
        mouseRadius={0.35}
        waveAmplitude={0.3}
        waveColor={palette.waveColor}
        waveFrequency={3}
        waveSpeed={0.12}
      />
    </div>
  );
}
