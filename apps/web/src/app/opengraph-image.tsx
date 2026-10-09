import { ImageResponse } from 'next/og';

// Link-preview card (Slack, WhatsApp, iMessage, LinkedIn…). Rendered at build time from the brand colours.
export const alt = 'Face-X — youth football registration and event-day check-in';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '0 96px',
          background: 'linear-gradient(135deg, #16543a 0%, #1f6f4d 100%)',
          color: '#ffffff'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 120,
              height: 120,
              borderRadius: 28,
              background: '#ffffff',
              color: '#1f6f4d',
              fontSize: 64,
              fontWeight: 800
            }}
          >
            FX
          </div>
          <div style={{ fontSize: 112, fontWeight: 800, letterSpacing: 2 }}>FACE-X</div>
        </div>
        <div style={{ marginTop: 44, fontSize: 46, lineHeight: 1.25, maxWidth: 940 }}>
          Player, coach and staff registration and event-day check-in for California youth football.
        </div>
        <div style={{ marginTop: 40, display: 'flex', gap: 16, fontSize: 28, fontWeight: 700 }}>
          {['PLAYER', 'COACH', 'STAFF'].map((r) => (
            <div key={r} style={{ display: 'flex', padding: '10px 24px', borderRadius: 999, background: 'rgba(255,255,255,0.18)' }}>
              {r}
            </div>
          ))}
        </div>
      </div>
    ),
    size
  );
}
