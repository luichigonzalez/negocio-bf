"use client";

import { useEffect, useMemo, useState } from "react";

type WithdrawalRow = {
  id: string;
  amount: number;
  status: string;
  provider?: string | null;
  providerStatus?: string | null;
  providerWithdrawalId?: string | null;
  createdAt?: string | null;
  executedAt?: string | null;
  failedAt?: string | null;
  wallet?: string | null;
  network?: string | null;
};

type ApiResponse = {
  ok: boolean;
  error?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  withdrawals?: WithdrawalRow[];
};

const STATUS_OPTIONS = [
  "",
  "PENDING_REVIEW",
  "PENDING",
  "REQUESTED",
  "AUTO_READY",
  "APPROVED",
  "PROCESSING",
  "PAID",
  "FAILED",
  "REJECTED",
];

function money(value: number | string | null | undefined) {
  const n = Number(value || 0);
  return `${n.toFixed(2)} USDT`;
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("es-AR");
}

function shortText(value?: string | null, left = 10, right = 8) {
  if (!value) return "-";
  if (value.length <= left + right + 3) return value;
  return `${value.slice(0, left)}...${value.slice(-right)}`;
}

function statusStyle(status?: string | null) {
  const s = String(status || "").toUpperCase();

  if (s === "PAID") {
    return {
      background: "rgba(34,197,94,0.15)",
      border: "1px solid rgba(34,197,94,0.35)",
      color: "#86efac",
    };
  }

  if (s === "PROCESSING") {
    return {
      background: "rgba(59,130,246,0.15)",
      border: "1px solid rgba(59,130,246,0.35)",
      color: "#93c5fd",
    };
  }

  if (s === "AUTO_READY" || s === "APPROVED") {
    return {
      background: "rgba(212,175,55,0.14)",
      border: "1px solid rgba(212,175,55,0.38)",
      color: "#f5d77a",
    };
  }

  if (s === "FAILED" || s === "REJECTED") {
    return {
      background: "rgba(239,68,68,0.14)",
      border: "1px solid rgba(239,68,68,0.35)",
      color: "#fca5a5",
    };
  }

  return {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)",
    color: "#ffffff",
  };
}

export default function AdminRetirosPage() {
  const [rows, setRows] = useState<WithdrawalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
  });

  async function loadData() {
    try {
      setLoading(true);
      setError("");
      setMessage("");

      const qs = new URLSearchParams();
      if (statusFilter) qs.set("status", statusFilter);
      qs.set("page", String(page));
      qs.set("limit", String(limit));

      const res = await fetch(
        `/api/promotores/retiros/admin/list?${qs.toString()}`,
        {
          cache: "no-store",
        }
      );

      const data: ApiResponse = await res.json();

      if (!res.ok || !data?.ok) {
        setRows([]);
        setError(data?.error || "No se pudieron cargar los retiros");
        return;
      }

      setRows(data.withdrawals || []);
      setPagination(
        data.pagination || {
          page: 1,
          limit,
          total: 0,
          totalPages: 1,
        }
      );
    } catch (err: any) {
      setRows([]);
      setError(err?.message || "Error cargando retiros");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [statusFilter, page, limit, refreshKey]);

  async function approveWithdrawal(withdrawalId: string) {
    try {
      setActionLoadingId(withdrawalId);
      setError("");
      setMessage("");

      const res = await fetch("/api/promotores/retiros/admin/approve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          withdrawalId,
          adminUserId: "admin-panel",
          note: "Aprobado desde panel de administración",
        }),
      });

      const data = await res.json();

      if (!res.ok || !data?.ok) {
        setError(data?.error || "No se pudo aprobar el retiro");
        return;
      }

      setMessage("Retiro aprobado correctamente");
      setRefreshKey((v) => v + 1);
    } catch (err: any) {
      setError(err?.message || "Error aprobando retiro");
    } finally {
      setActionLoadingId(null);
    }
  }

  async function rejectWithdrawal(withdrawalId: string) {
    const reason = window.prompt(
      "Motivo del rechazo:",
      "Retiro rechazado por administración"
    );

    if (reason === null) return;

    try {
      setActionLoadingId(withdrawalId);
      setError("");
      setMessage("");

      const res = await fetch("/api/promotores/retiros/admin/reject", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          withdrawalId,
          adminUserId: "admin-panel",
          note: reason,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data?.ok) {
        setError(data?.error || "No se pudo rechazar el retiro");
        return;
      }

      setMessage("Retiro rechazado correctamente");
      setRefreshKey((v) => v + 1);
    } catch (err: any) {
      setError(err?.message || "Error rechazando retiro");
    } finally {
      setActionLoadingId(null);
    }
  }

  async function executeWithdrawal(withdrawalId: string) {
    try {
      setActionLoadingId(withdrawalId);
      setError("");
      setMessage("");

      const res = await fetch("/api/promotores/retiros/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          withdrawalId,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data?.ok) {
        setError(data?.error || "No se pudo ejecutar el retiro");
        return;
      }

      setMessage("Retiro enviado al proveedor correctamente");
      setRefreshKey((v) => v + 1);
    } catch (err: any) {
      setError(err?.message || "Error ejecutando retiro");
    } finally {
      setActionLoadingId(null);
    }
  }

  const stats = useMemo(() => {
    const total = rows.length;
    const pending = rows.filter((r) =>
      ["PENDING_REVIEW", "PENDING", "REQUESTED"].includes(
        String(r.status || "").toUpperCase()
      )
    ).length;
    const autoReady = rows.filter(
      (r) => String(r.status || "").toUpperCase() === "AUTO_READY"
    ).length;
    const processing = rows.filter(
      (r) => String(r.status || "").toUpperCase() === "PROCESSING"
    ).length;
    const paid = rows.filter(
      (r) => String(r.status || "").toUpperCase() === "PAID"
    ).length;

    return { total, pending, autoReady, processing, paid };
  }, [rows]);

  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top, rgba(212,175,55,0.10), transparent 20%), #06111a",
        color: "#fff",
        padding: "32px 20px",
      }}
    >
      <div
        style={{
          maxWidth: 1400,
          margin: "0 auto",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 16,
            alignItems: "center",
            marginBottom: 24,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: 34,
                fontWeight: 800,
                color: "#D4AF37",
                letterSpacing: 0.3,
              }}
            >
              Administración de Retiros
            </h1>

            <p
              style={{
                marginTop: 8,
                marginBottom: 0,
                color: "rgba(255,255,255,0.78)",
                fontSize: 15,
              }}
            >
              Control, aprobación, rechazo y ejecución de pagos USDT TRC20.
            </p>
          </div>

          <button
            onClick={() => setRefreshKey((v) => v + 1)}
            style={{
              border: "1px solid rgba(212,175,55,0.4)",
              background: "rgba(212,175,55,0.12)",
              color: "#f5d77a",
              borderRadius: 12,
              padding: "12px 18px",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            Actualizar
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            gap: 14,
            marginBottom: 22,
          }}
        >
          {[
            { label: "Cargados", value: stats.total },
            { label: "Pendientes", value: stats.pending },
            { label: "Auto Ready", value: stats.autoReady },
            { label: "Procesando", value: stats.processing },
            { label: "Pagados", value: stats.paid },
          ].map((item) => (
            <div
              key={item.label}
              style={{
                borderRadius: 18,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.10)",
                padding: 18,
                boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  color: "rgba(255,255,255,0.68)",
                  marginBottom: 8,
                }}
              >
                {item.label}
              </div>
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 800,
                  color: "#ffffff",
                }}
              >
                {item.value}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            borderRadius: 20,
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.10)",
            padding: 18,
            marginBottom: 18,
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <label
              style={{
                fontSize: 14,
                color: "rgba(255,255,255,0.8)",
                fontWeight: 700,
              }}
            >
              Filtrar por estado
            </label>

            <select
              value={statusFilter}
              onChange={(e) => {
                setPage(1);
                setStatusFilter(e.target.value);
              }}
              style={{
                minWidth: 220,
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.15)",
                background: "#0c1824",
                color: "#fff",
                padding: "12px 14px",
                outline: "none",
              }}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option || "ALL"} value={option}>
                  {option || "TODOS"}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error ? (
          <div
            style={{
              marginBottom: 16,
              borderRadius: 14,
              background: "rgba(239,68,68,0.12)",
              border: "1px solid rgba(239,68,68,0.3)",
              color: "#fecaca",
              padding: 14,
              fontWeight: 700,
            }}
          >
            {error}
          </div>
        ) : null}

        {message ? (
          <div
            style={{
              marginBottom: 16,
              borderRadius: 14,
              background: "rgba(34,197,94,0.12)",
              border: "1px solid rgba(34,197,94,0.3)",
              color: "#bbf7d0",
              padding: 14,
              fontWeight: 700,
            }}
          >
            {message}
          </div>
        ) : null}

        <div
          style={{
            borderRadius: 20,
            overflow: "hidden",
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.10)",
          }}
        >
          <div
            style={{
              overflowX: "auto",
            }}
          >
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                minWidth: 1200,
              }}
            >
              <thead
                style={{
                  background: "rgba(255,255,255,0.04)",
                }}
              >
                <tr>
                  <th style={thStyle}>ID</th>
                  <th style={thStyle}>Monto</th>
                  <th style={thStyle}>Estado</th>
                  <th style={thStyle}>Wallet</th>
                  <th style={thStyle}>Red</th>
                  <th style={thStyle}>Proveedor</th>
                  <th style={thStyle}>Estado proveedor</th>
                  <th style={thStyle}>Creado</th>
                  <th style={thStyle}>Ejecutado</th>
                  <th style={thStyle}>Acciones</th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={10} style={emptyStyle}>
                      Cargando retiros...
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={emptyStyle}>
                      No hay retiros para mostrar.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => {
                    const upperStatus = String(row.status || "").toUpperCase();
                    const canApprove =
                      upperStatus === "PENDING_REVIEW" ||
                      upperStatus === "PENDING" ||
                      upperStatus === "REQUESTED";

                    const canReject =
                      upperStatus === "PENDING_REVIEW" ||
                      upperStatus === "PENDING" ||
                      upperStatus === "REQUESTED" ||
                      upperStatus === "APPROVED" ||
                      upperStatus === "AUTO_READY";

                    const canExecute =
                      upperStatus === "AUTO_READY" || upperStatus === "APPROVED";

                    const isBusy = actionLoadingId === row.id;
                    const badge = statusStyle(row.status);

                    return (
                      <tr
                        key={row.id}
                        style={{
                          borderTop: "1px solid rgba(255,255,255,0.08)",
                        }}
                      >
                        <td style={tdStyle}>{shortText(row.id, 10, 6)}</td>
                        <td style={tdStyle}>{money(row.amount)}</td>
                        <td style={tdStyle}>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              minWidth: 110,
                              padding: "8px 12px",
                              borderRadius: 999,
                              fontSize: 12,
                              fontWeight: 800,
                              letterSpacing: 0.3,
                              ...badge,
                            }}
                          >
                            {row.status}
                          </span>
                        </td>
                        <td style={tdStyle}>{shortText(row.wallet, 12, 10)}</td>
                        <td style={tdStyle}>{row.network || "-"}</td>
                        <td style={tdStyle}>{row.provider || "-"}</td>
                        <td style={tdStyle}>{row.providerStatus || "-"}</td>
                        <td style={tdStyle}>{formatDate(row.createdAt)}</td>
                        <td style={tdStyle}>{formatDate(row.executedAt)}</td>
                        <td style={tdStyle}>
                          <div
                            style={{
                              display: "flex",
                              gap: 8,
                              flexWrap: "wrap",
                            }}
                          >
                            <button
                              onClick={() => approveWithdrawal(row.id)}
                              disabled={!canApprove || isBusy}
                              style={{
                                ...buttonStyle,
                                opacity: !canApprove || isBusy ? 0.45 : 1,
                              }}
                            >
                              Aprobar
                            </button>

                            <button
                              onClick={() => rejectWithdrawal(row.id)}
                              disabled={!canReject || isBusy}
                              style={{
                                ...buttonStyle,
                                opacity: !canReject || isBusy ? 0.45 : 1,
                              }}
                            >
                              Rechazar
                            </button>

                            <button
                              onClick={() => executeWithdrawal(row.id)}
                              disabled={!canExecute || isBusy}
                              style={{
                                ...goldButtonStyle,
                                opacity: !canExecute || isBusy ? 0.45 : 1,
                              }}
                            >
                              Ejecutar
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div
          style={{
            marginTop: 18,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              color: "rgba(255,255,255,0.74)",
              fontSize: 14,
            }}
          >
            Página {pagination.page} de {pagination.totalPages} — Total:{" "}
            {pagination.total}
          </div>

          <div
            style={{
              display: "flex",
              gap: 10,
            }}
          >
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={pagination.page <= 1}
              style={{
                ...buttonStyle,
                opacity: pagination.page <= 1 ? 0.45 : 1,
              }}
            >
              Anterior
            </button>

            <button
              onClick={() =>
                setPage((p) => Math.min(pagination.totalPages || 1, p + 1))
              }
              disabled={pagination.page >= pagination.totalPages}
              style={{
                ...buttonStyle,
                opacity:
                  pagination.page >= pagination.totalPages ? 0.45 : 1,
              }}
            >
              Siguiente
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "16px 14px",
  color: "#D4AF37",
  fontSize: 13,
  fontWeight: 800,
  letterSpacing: 0.3,
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "16px 14px",
  color: "#ffffff",
  fontSize: 14,
  verticalAlign: "middle",
  whiteSpace: "nowrap",
};

const emptyStyle: React.CSSProperties = {
  padding: "28px 14px",
  textAlign: "center",
  color: "rgba(255,255,255,0.7)",
  fontWeight: 700,
};

const buttonStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.16)",
  background: "rgba(255,255,255,0.06)",
  color: "#fff",
  borderRadius: 10,
  padding: "10px 12px",
  cursor: "pointer",
  fontWeight: 700,
};

const goldButtonStyle: React.CSSProperties = {
  border: "1px solid rgba(212,175,55,0.45)",
  background: "rgba(212,175,55,0.14)",
  color: "#f5d77a",
  borderRadius: 10,
  padding: "10px 12px",
  cursor: "pointer",
  fontWeight: 800,
};