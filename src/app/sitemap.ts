import type { MetadataRoute } from 'next'
import { CITIES } from '@/lib/cities'

const SITE_URL = 'https://www.yeahdoodle.com'
const CATEGORY_SLUGS = ['music','food-drink','arts-culture','sports','nightlife','outdoors','community','other']

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  const staticPages: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: now, changeFrequency: 'daily', priority: 1.0 },
    { url: `${SITE_URL}/discover`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${SITE_URL}/saved`, lastModified: now, changeFrequency: 'weekly', priority: 0.5 },
  ]
  const cityPages: MetadataRoute.Sitemap = CITIES.map(city => ({
    url: `${SITE_URL}/events/${city.slug}`, lastModified: now, changeFrequency: 'daily' as const, priority: 0.8,
  }))
  const categoryPages: MetadataRoute.Sitemap = CITIES.flatMap(city =>
    CATEGORY_SLUGS.map(cat => ({ url: `${SITE_URL}/events/${city.slug}/${cat}`, lastModified: now, changeFrequency: 'daily' as const, priority: 0.7 }))
  )
  return [...staticPages, ...cityPages, ...categoryPages]
}
