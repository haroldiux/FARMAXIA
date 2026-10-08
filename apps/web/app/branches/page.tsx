"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function BranchesPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/users?tab=branches");
  }, [router]);

  return (
    <main className="center-state">
      <span className="loading-orb" />
      Redirigiendo a sucursales…
    </main>
  );
}
