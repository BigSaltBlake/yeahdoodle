import type { Metadata } from 'next'
export const metadata: Metadata = {
  title: 'Discover Events',
  description: 'Search any US city and find local events filtered by vibe, group type, and when. Music, food, sports, nightlife, outdoors, and more.',
  openGraph: { title: 'Discover Events Near You | YeahDoodle', description: 'Search any city and find local events that actually match your vibe.' },
}
export default function DiscoverLayout({ children }: { children: React.ReactNode }) { return <>{children}</> }