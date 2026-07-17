import type { MetadataRoute } from 'next'
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', allow: '/', disallow: ['/saved', '/api/'] }], sitemap: 'https://www.yeahdoodle.com/sitemap.xml' }
}