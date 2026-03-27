"use client";

import { useEffect, useState } from "react";

export default function RegisterPage() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sponsorCode, setSponsorCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const ref =
      params.get("ref") ||
      params.get("sponsor") ||
      params.get("code") ||
      "";

    if (ref) {
      setSponsorCode(ref.trim());
      try {
        localStorage.setItem("pendingSponsorCode", ref.trim());
      } catch {}
    } else {
      try {
        const saved = localStorage.getItem("pendingSponsorCode") || "";
        if (saved) setSponsorCode(saved.trim());
      } catch {}
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (loading) return;

    setLoading(true);
    setMsg("");

    try {
      const finalSponsorCode = sponsorCode.trim();

      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: username.trim(),
          email: email.trim(),
          password,
          sponsorCode: finalSponsorCode,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMsg(data.error || "Error al registrar");
        setLoading(false);
        return;
      }

      try {
        if (finalSponsorCode) {
          localStorage.setItem("pendingSponsorCode", finalSponsorCode);
        }
      } catch {}

      setMsg("Registro exitoso");
      window.location.href = "/login";
    } catch {
      setMsg("Error de conexión");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Registro</h1>

      <form onSubmit={handleSubmit} style={{ maxWidth: 400 }}>
        <input
          placeholder="Usuario"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <br /><br />

        <input
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <br /><br />

        <input
          placeholder="Contraseña"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <br /><br />

        <input
          placeholder="Código referido (opcional)"
          value={sponsorCode}
          onChange={(e) => setSponsorCode(e.target.value)}
        />
        <br /><br />

        <button type="submit" disabled={loading}>
          {loading ? "Registrando..." : "Crear cuenta"}
        </button>
      </form>

      {msg && <p>{msg}</p>}
    </main>
  );
}