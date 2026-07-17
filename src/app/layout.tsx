import type { Metadata } from 'next'
import './globals.css'
import Navbar from '@/components/Navbar'
import { AuthProvider } from '@/components/AuthProvider'
const SITE_URL = 'https://www.yeahdoodle.com'
const OG_IMAGE = SITE_URL + '/og-default.png'
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'YeahDoodle — Find Your Next Adventure', template: '%s | YeahDoodle' },
  description: 'Discover local events that actually match your vibe. Search any city, filter by what fits, and find something worth going to.',
  keywords: ['local events', 'things to do', 'event discovery', 'concerts', 'nightlife', 'food events', 'sports events'],
  openGraph: {
    title: 'YeahDoodle — Find Your Next Adventure',
    description: 'Discover local events that actually match your vibe.',
    url: SITE_URL, siteName: 'YeahDoodle', type: 'website',
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: 'YeahDoodle — Find Your Next Adventure' }],
  },
  twitter: { card: 'summary_large_image', title: 'YeahDoodle — Find Your Next Adventure', description: 'Discover local events that actually match your vibe.', images: [OG_IMAGE] },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large' } },
  icons: { icon: '/favicon.svg' },
}
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-yd-bg text-white font-body antialiased">
        <AuthProvider><Navbar /><main>{children}</main></AuthProvider>
      </body>
    </html>
  )
}