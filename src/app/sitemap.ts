import type { MetadataRoute } from 'next'
const SITE_URL = 'https://www.yeahdoodle.com'
const TOP_CITIES = ['New York','Los Angeles','Chicago','Houston','Phoenix','San Diego','Dallas','San Jose','Philadelphia','San Antonio','Austin','Nashville','Denver','Seattle','Miami','Atlanta','Boston','Las Vegas','Portland','Minneapolis','San Francisco','New Orleans','Detroit','Baltimore','Salt Lake City','Raleigh','Tampa','Orlando','Cincinnati','Pittsburgh','Kansas City','Columbus','Indianapolis','Charlotte','Sacramento']
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  return [
    { url: SITE_URL, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: SITE_URL + '/discover', lastModified: now, changeFrequency: 'hourly', priority: 0.9 },
    ...TOP_CITIES.map(city => ({ url: SITE_URL + '/discover?city=' + encodeURIComponent(city), lastModified: now, changeFrequency: 'hourly' as const, priority: 0.7 })),
  ]
}