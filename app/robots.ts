export default function robots() {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || "localhost";
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `https://${host}/sitemap.xml`,
  };
}
