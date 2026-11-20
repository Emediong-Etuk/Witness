/** Things only Greg can fill in (video ids, deployed URLs). Null = not published yet; the site says so. */
export const SITE = {
  siteUrl: 'https://witness-nine.vercel.app',
  repoUrl: 'https://github.com/Emediong-Etuk/Witness',
  /** Set once installers are published on GitHub Releases. */
  releasesUrl: null as string | null,
  devPostUrl: null as string | null,
  videos: {
    pitch: { title: 'The demo', youtubeId: null as string | null, length: '2:22' },
    walkthrough: { title: 'Technical walkthrough', youtubeId: null as string | null, length: '3:20' },
  },
};
