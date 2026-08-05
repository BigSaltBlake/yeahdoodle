import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Ticketmaster / Live Nation
      { protocol: 'https', hostname: 's1.ticketm.net' },
      { protocol: 'https', hostname: '*.ticketmaster.com' },
      { protocol: 'https', hostname: '*.livenation.com' },
      // Eventbrite
      { protocol: 'https', hostname: 'img.evbuc.com' },
      { protocol: 'https', hostname: '*.eventbrite.com' },
      // SeatGeek
      { protocol: 'https', hostname: '*.seatgeek.com' },
      // Google / SerpAPI thumbnails
      { protocol: 'https', hostname: '*.gstatic.com' },
      { protocol: 'https', hostname: '*.googleusercontent.com' },
      { protocol: 'https', hostname: 'encrypted-tbn0.gstatic.com' },
      // Meetup
      { protocol: 'https', hostname: '*.meetupstatic.com' },
      { protocol: 'https', hostname: 'secure.meetupstatic.com' },
      // Bandsintown
      { protocol: 'https', hostname: '*.bandsintown.com' },
      { protocol: 'https', hostname: 'photos.bandsintown.com' },
      // Facebook / Meta event images
      { protocol: 'https', hostname: '*.fbcdn.net' },
      { protocol: 'https', hostname: 'scontent.fbcdn.net' },
      { protocol: 'https', hostname: 'lookaside.fbsbx.com' },
      // Generic CDNs used by event sites
      { protocol: 'https', hostname: '*.cloudinary.com' },
      { protocol: 'https', hostname: '*.imgur.com' },
      { protocol: 'https', hostname: '*.staticflickr.com' },
      { protocol: 'https', hostname: '*.squarespace-cdn.com' },
      { protocol: 'https', hostname: '*.wp.com' },
    ],
  },
}

export default nextConfig
