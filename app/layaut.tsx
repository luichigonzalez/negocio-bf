import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Negocio BF",
  description: "Sistema de negocio Birra & Fútbol",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}