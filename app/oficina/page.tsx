"use client";

import { useEffect, useState } from "react";

type ReferralItem = {
  id: string;
  username: string;
  email: string;
  createdAt: string;
};

type MeResponse = {
  ok?: boolean;
  error?: string;
  id?: string;
  username?: string;
  email?: string;
  referralCode?: string;
  isActive?: boolean;
  availableBalance?: number;
  lockedBalance?: number;
  directCount?: number;
  referrals?: ReferralItem[];
  sponsor?: {
    id: string;
    username: string;
    email: string;
    referralCode: string;
  } | null;
};

type WalletResponse = {
  ok?: boolean;
  error?: string;
  wallet?: {
    usdtAddress?: string | null;
    usdtNetwork?: string | null;
    isUsdtAddressLocked?: boolean | null;
  } | null;
};

export default function OficinaPage() {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [data, setData] = useState<MeResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [activating, setActivating] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [savingWallet, setSavingWallet] = useState(false);
  const [requestingPayout, setRequestingPayout] = useState(false);
  const [walletAddress, setWalletAddress] = useState("");
  const [walletNetwork, setWalletNetwork] = useState("TRC20");
  const [walletLocked, setWalletLocked] = useState(false);

  async function loadMe() {
    try {
      setLoading(true);
      setMsg("");

      const res = await fetch("/api/me", {
        cache: "no-store",
      });

      const json: MeResponse = await res.json();

      if (!res.ok || !json?.ok) {
        setMsg(json?.error || "No autorizado");
        setLoading(false);
        setTimeout(() => {
          window.location.href = "/login";
        }, 800);
        return;
      }

      setData(json);
    } catch {
      setMsg("Error de conexión");
    } finally {
      setLoading(false);
    }
  }

  async function loadWallet() {
    try {
      const res = await fetch("/api/promotores/wallet", {
        cache: "no-store",
      });

      const json: WalletResponse = await res.json();

      if (!res.ok || !json?.ok) return;

      setWalletAddress(json.wallet?.usdtAddress || "");
      setWalletNetwork(json.wallet?.usdtNetwork || "TRC20");
      setWalletLocked(Boolean(json.wallet?.isUsdtAddressLocked));
    } catch {}
  }

  async function reloadAll() {
    await Promise.all([loadMe(), loadWallet()]);
  }

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
      });
    } catch {}

    window.location.href = "/login";
  }

  function getReferralLink() {
    if (!data?.referralCode) return "";
    return `${window.location.origin}/register?ref=${data.referralCode}`;
  }

  async function copyLink() {
    const link = getReferralLink();
    if (!link) return;

    await navigator.clipboard.writeText(link);
    setCopied(true);

    setTimeout(() => setCopied(false), 2000);
  }

  async function handleActivate() {
    if (activating) return;

    try {
      setActivating(true);
      setMsg("");

      const res = await fetch("/api/account/activate", {
        method: "POST",
      });

      const json = await res.json();

      if (!res.ok || !json?.ok) {
        setMsg(json?.error || "No se pudo activar la cuenta");
        return;
      }

      setMsg(json.message || "Cuenta activada correctamente");
      await reloadAll();
    } catch {
      setMsg("Error de conexión al activar la cuenta");
    } finally {
      setActivating(false);
    }
  }

  async function handleRecalculateBalance() {
    if (recalculating) return;

    try {
      setRecalculating(true);
      setMsg("");

      const res = await fetch("/api/account/recalculate-balance", {
        method: "POST",
      });

      const json = await res.json();

      if (!res.ok || !json?.ok) {
        setMsg(json?.error || "No se pudo recalcular el saldo");
        return;
      }

      setMsg(json.message || "Saldo recalculado correctamente");
      await reloadAll();
    } catch {
      setMsg("Error de conexión al recalcular saldo");
    } finally {
      setRecalculating(false);
    }
  }

  async function handleUnlockBalance() {
    if (unlocking || !data?.lockedBalance || data.lockedBalance <= 0) return;

    try {
      setUnlocking(true);
      setMsg("");

      const res = await fetch("/api/account/unlock-balance", {
        method: "POST",
      });

      const json = await res.json();

      if (!res.ok || !json?.ok) {
        setMsg(json?.error || "No se pudo liberar el saldo");
        return;
      }

      setMsg(json.message || "Saldo liberado correctamente");
      await reloadAll();
    } catch {
      setMsg("Error de conexión al liberar saldo");
    } finally {
      setUnlocking(false);
    }
  }

  async function handleSaveWallet() {
    if (savingWallet) return;

    const address = window.prompt(
      walletLocked
        ? "Tu wallet ya está bloqueada y no puede modificarse."
        : "Ingresá tu wallet USDT TRC20:"
    );

    if (!address || walletLocked) return;

    try {
      setSavingWallet(true);
      setMsg("");

      const res = await fetch("/api/promotores/wallet", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ address }),
      });

      const json = await res.json();

      if (!res.ok || !json?.ok) {
        setMsg(json?.error || "No se pudo guardar la wallet");
        return;
      }

      setMsg(json.message || "Wallet guardada correctamente");
      await reloadAll();
    } catch {
      setMsg("Error de conexión al guardar la wallet");
    } finally {
      setSavingWallet(false);
    }
  }

  async function handleRequestPayout() {
    if (requestingPayout) return;

    const rawAmount = window.prompt("¿Cuánto querés retirar en USDT?");
    if (!rawAmount) return;

    const amount = Number(rawAmount);

    if (!Number.isFinite(amount) || amount <= 0) {
      setMsg("Monto inválido");
      return;
    }

    try {
      setRequestingPayout(true);
      setMsg("");

      const res = await fetch("/api/promotores/payout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ amount }),
      });

      const json = await res.json();

      if (!res.ok || !json?.ok) {
        setMsg(json?.error || "No se pudo crear el retiro");
        return;
      }

      setMsg(json.message || "Retiro creado correctamente");
      await reloadAll();
    } catch {
      setMsg("Error de conexión al solicitar retiro");
    } finally {
      setRequestingPayout(false);
    }
  }

  useEffect(() => {
    reloadAll();
  }, []);

  if (loading) {
    return (
      <main style={{ padding: 40 }}>
        <h1>Oficina</h1>
        <p>Cargando...</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Oficina</h1>

      {msg && <p>{msg}</p>}

      {data?.ok && (
        <div style={{ marginTop: 20 }}>
          <p><strong>Usuario:</strong> {data.username}</p>
          <p><strong>Email:</strong> {data.email}</p>
          <p><strong>Código:</strong> {data.referralCode || "-"}</p>
          <p><strong>Estado de cuenta:</strong> {data.isActive ? "Activa" : "Inactiva"}</p>
          <p><strong>Saldo disponible:</strong> {data.availableBalance ?? 0} USDT</p>
          <p><strong>Saldo bloqueado:</strong> {data.lockedBalance ?? 0} USDT</p>
          <p><strong>Referidos directos:</strong> {data.directCount ?? 0}</p>

          {data.isActive && (
            <div
              style={{
                marginTop: 20,
                padding: 16,
                border: "1px solid #2b365f",
              }}
            >
              <p><strong>Wallet USDT:</strong> {walletAddress || "No registrada"}</p>
              <p><strong>Red:</strong> {walletNetwork || "TRC20"}</p>
              <p><strong>Estado wallet:</strong> {walletLocked ? "Bloqueada 🔒" : "Pendiente de guardar"}</p>

              <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button onClick={handleSaveWallet} disabled={savingWallet || walletLocked}>
                  {walletLocked
                    ? "Wallet bloqueada"
                    : savingWallet
                    ? "Guardando..."
                    : "Guardar wallet"}
                </button>

                <button onClick={handleRequestPayout} disabled={requestingPayout}>
                  {requestingPayout ? "Procesando..." : "Retirar USDT"}
                </button>
              </div>
            </div>
          )}

          {!data.isActive && (
            <div style={{ marginTop: 20 }}>
              <button onClick={handleActivate} disabled={activating}>
                {activating ? "Activando..." : "Activar cuenta"}
              </button>
            </div>
          )}

          {data.isActive && (
            <div style={{ marginTop: 20, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button onClick={handleRecalculateBalance} disabled={recalculating}>
                {recalculating ? "Ajustando..." : "Ajuste retroactivo"}
              </button>

              {(data.lockedBalance ?? 0) > 0 && (
                <button onClick={handleUnlockBalance} disabled={unlocking}>
                  {unlocking ? "Liberando..." : "Liberar saldo"}
                </button>
              )}
            </div>
          )}

          {data.sponsor && (
            <div style={{ marginTop: 20 }}>
              <p><strong>Patrocinador:</strong> {data.sponsor.username}</p>
              <p><strong>Código patrocinador:</strong> {data.sponsor.referralCode}</p>
            </div>
          )}

          <div style={{ marginTop: 20 }}>
            <p><strong>Tu link de referido:</strong></p>
            <input
              value={getReferralLink()}
              readOnly
              style={{ width: "100%" }}
            />
            <br />
            <br />
            <button onClick={copyLink}>
              {copied ? "Copiado ✅" : "Copiar link"}
            </button>
          </div>

          <div style={{ marginTop: 30 }}>
            <p><strong>Listado de referidos:</strong></p>

            {data.referrals && data.referrals.length > 0 ? (
              <div style={{ marginTop: 10 }}>
                {data.referrals.map((ref) => (
                  <div
                    key={ref.id}
                    style={{
                      border: "1px solid #2b365f",
                      padding: 12,
                      marginBottom: 10,
                    }}
                  >
                    <p><strong>Usuario:</strong> {ref.username}</p>
                    <p><strong>Email:</strong> {ref.email}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p>No tienes referidos todavía.</p>
            )}
          </div>

          <div style={{ marginTop: 20 }}>
            <button onClick={handleLogout}>Cerrar sesión</button>
          </div>
        </div>
      )}
    </main>
  );
}