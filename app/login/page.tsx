"use client";

import { useState } from "react";

export default function LoginPage() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (loading) return;

    setLoading(true);
    setMsg("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          identifier: identifier.trim(),
          password,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setMsg(data?.error || "Error al iniciar sesión");
        return;
      }

      window.location.replace("/oficina");
    } catch {
      setMsg("Error de conexión");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#000",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(212,175,55,0.25)",
          borderRadius: 16,
          padding: 24,
          boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
        }}
      >
        <h1
          style={{
            margin: 0,
            marginBottom: 8,
            fontSize: 28,
            fontWeight: 700,
            color: "#D4AF37",
          }}
        >
          Birra & Fútbol
        </h1>

        <p
          style={{
            marginTop: 0,
            marginBottom: 24,
            color: "rgba(255,255,255,0.75)",
          }}
        >
          Ingresá a tu cuenta
        </p>

        <form onSubmit={handleSubmit}>
          <label
            style={{
              display: "block",
              marginBottom: 8,
              fontSize: 14,
              color: "#fff",
            }}
          >
            Usuario o Email
          </label>
          <input
            placeholder="Usuario o Email"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            autoComplete="username"
            style={{
              width: "100%",
              height: 46,
              padding: "0 14px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "#111",
              color: "#fff",
              outline: "none",
              marginBottom: 16,
            }}
          />

          <label
            style={{
              display: "block",
              marginBottom: 8,
              fontSize: 14,
              color: "#fff",
            }}
          >
            Contraseña
          </label>
          <input
            placeholder="Contraseña"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            style={{
              width: "100%",
              height: 46,
              padding: "0 14px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "#111",
              color: "#fff",
              outline: "none",
              marginBottom: 20,
            }}
          />

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              height: 48,
              border: "none",
              borderRadius: 10,
              background: "#D4AF37",
              color: "#000",
              fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>

        {msg ? (
          <p
            style={{
              marginTop: 16,
              color: "#ff6b6b",
              fontSize: 14,
            }}
          >
            {msg}
          </p>
        ) : null}
      </div>
    </main>
  );
}