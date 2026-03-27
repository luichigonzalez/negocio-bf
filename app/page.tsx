"use client";

import { useEffect } from "react";

export default function Home() {
  useEffect(() => {
    window.location.href = "/login";
  }, []);

  return (
    <main style={{ padding: 40 }}>
      <p>Redirigiendo...</p>
    </main>
  );
}