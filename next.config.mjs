/** @type {import('next').NextConfig} */
const nextConfig = {
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
