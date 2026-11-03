import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Siwi: games players build and own together",
  description: "Type one sentence. A crew of AI agents on Meta's models builds a playable game. Players co-own it and fund Season 2.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;600&display=swap"
        />
      </head>
      <body className="antialiased">
        <div className="siwi-bg" aria-hidden />
        {children}
      </body>
    </html>
  );
}
