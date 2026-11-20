/** Things only Greg can fill in (video ids, deployed URLs). Null = not published yet; the site says so. */
export const SITE = {
  siteUrl: 'https://witness-nine.vercel.app',
  repoUrl: 'https://github.com/Emediong-Etuk/Witness',
  /** Set once installers are published on GitHub Releases. */
  releasesUrl: 'https://github.com/Emediong-Etuk/Witness/releases/latest' as string | null,
  devPostUrl: null as string | null,
  videos: {
    pitch: { title: 'The demo', youtubeId: 't9cM9Yxl6Xg' as string | null, length: '2:48' },
    walkthrough: { title: 'Technical walkthrough', youtubeId: '8R1XOzlivdc' as string | null, length: '3:29' },
  },
};
