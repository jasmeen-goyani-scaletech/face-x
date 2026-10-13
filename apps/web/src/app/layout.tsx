import type { Metadata, Viewport } from 'next';
import { Oswald, Public_Sans } from 'next/font/google';
import { AuthProvider } from '@/components/auth/AuthProvider';
import ServiceWorkerRegister from '@/components/ServiceWorkerRegister';
import './globals.css';

const oswald = Oswald({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
  display: 'swap'
});

const publicSans = Public_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
  display: 'swap'
});

export const metadata: Metadata = {
  // Absolute base so og:image resolves to a full URL, which link unfurlers (Slack etc.) require.
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ||
      (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000')
  ),
  openGraph: {
    type: 'website',
    siteName: 'Face-X',
    title: 'Face-X',
    description: 'Player, coach, and staff registration and event-day check-in for California youth football.'
  },
  twitter: { card: 'summary_large_image' },
  title: {
    default: 'Face-X',
    template: '%s · Face-X'
  },
  description: 'Player, coach, and staff registration and event-day check-in for California youth football.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Face-X'
  },
  icons: {
    icon: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/icons/icon-180.png', sizes: '180x180', type: 'image/png' }]
  },
  formatDetection: { telephone: false }
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#1f6f4d'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${oswald.variable} ${publicSans.variable}`}>
      <body className="font-body antialiased">
        <ServiceWorkerRegister />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
