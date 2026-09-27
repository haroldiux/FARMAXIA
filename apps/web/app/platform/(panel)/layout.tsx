import type { ReactNode } from "react";
import { PlatformShell } from "../../components/platform-shell";

export default function PlatformPanelLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <PlatformShell>{children}</PlatformShell>;
}
