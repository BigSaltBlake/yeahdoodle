import type { Metadata } from 'next'
export const metadata: Metadata = {
  title: 'Saved Events',
  description: 'Your saved events on YeahDoodle. Sign in to sync across all your devices.',
  robots: { index: false, follow: false },
}
export default function SavedLayout({ children }: { children: React.ReactNode }) { return <>{children}</> }