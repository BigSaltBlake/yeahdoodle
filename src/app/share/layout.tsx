import type { Metadata } from 'next'
export const metadata: Metadata = {
  title: 'Share a Local Secret',
  description: 'Know a hidden beach, a swimming hole, or a spot only locals know? Share it on YeahDoodle and help someone find it.',
}
export default function ShareLayout({ children }: { children: React.ReactNode }) { return <>{children}</> }
