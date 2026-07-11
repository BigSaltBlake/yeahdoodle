import type { Metadata } from 'next'
import './globals.css'
import Navbar from '@/components/Navbar'
import { AuthProvider } from '@/components/AuthProvider'

export const metadata: Metadata = {
  title: 'YeahDoodle — Find Your Next Adventure',
  description: 'Discover local events that match your vibe. Search any city and uncover picks made for you.',
  openGraph: {
    title: 'YeahDoodle — Find Your Next Adventure',
    description: 'Discover local events that match your vibe.',
    type: 'website',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-yd-bg text-white font-body antialiased">
        <AuthProvider>
          <Navbar />
          <main>{children}</main>
        </AuthProvider>
      </body>
    </html>
  )
}
