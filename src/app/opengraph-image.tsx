import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 72, background: "#090b10", color: "#f8fafc" }}>
      <div style={{ display: "flex", color: "#67e8f9", fontSize: 24, letterSpacing: 5 }}>AGENTIC CODING, VISIBLE</div>
      <div style={{ display: "flex", marginTop: 28, fontSize: 72, fontWeight: 700 }}>Codex Pilot</div>
      <div style={{ display: "flex", marginTop: 20, maxWidth: 880, color: "#94a3b8", fontSize: 30 }}>Paste a public GitHub issue. Watch Codex investigate the repository and prepare a patch.</div>
    </div>,
    { ...size },
  );
}
