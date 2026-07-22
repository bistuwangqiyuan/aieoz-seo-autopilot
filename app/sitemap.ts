export default function sitemap() {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || "localhost";
  return [{ url: `https://${host}/`, lastModified: new Date() }];
}
