/** @type {import('next').NextConfig} */
const nextConfig = {
  // Type errors fail the build so broken code never reaches production
  eslint: { ignoreDuringBuilds: true },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 's1.ticketm.net' },
      { protocol: 'https', hostname: '*.ticketmaster.com' },
      { protocol: 'https', hostname: '*.livenation.com' },
      { protocol: 'https', hostname: 'img.evbuc.com' },
      { protocol: 'https', hostname: '*.seatgeek.com' },
    ],
  },

}

export default nextConfig
