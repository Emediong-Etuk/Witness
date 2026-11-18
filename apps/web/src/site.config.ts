/** Things only Greg can fill in (video ids, deployed URLs). Null = not published yet; the site says so. */
export const SITE = {
  siteUrl: 'https://witness-nine.vercel.app',
  repoUrl: 'https://github.com/Emediong-Etuk/Witness',
  releasesUrl: 'https://github.com/Emediong-Etuk/Witness/releases',
  devPostUrl: null as string | null,
  videos: {
    pitch: { title: 'The 3-minute demo', youtubeId: null as string | null, length: '≤ 3:00' },
    walkthrough: { title: 'Technical walkthrough', youtubeId: null as string | null, length: '≈ 4–5 min' },
  },
};
