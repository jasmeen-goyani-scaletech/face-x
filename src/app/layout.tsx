import type { Metadata, Viewport } from 'next';
import { Oswald, Public_Sans } from 'next/font/google';
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
        {children}
      </body>
    </html>
  );
}
