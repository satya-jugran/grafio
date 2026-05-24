import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Grafio',
  tagline: 'High-performance graph database with native Cypher support and pluggable storage',

  clientModules: [
    require.resolve('./src/clientModules/gtagPageView'),
  ],
  favicon: 'img/favicon.svg',
  url: 'https://satya-jugran.github.io',
  baseUrl: '/grafio/',
  trailingSlash: false,

  organizationName: 'satya-jugran',
  projectName: 'grafio',

  markdown: {
    mermaid: true,
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/satya-jugran/grafio/edit/main/docs/',
          showLastUpdateTime: true,
        },
        blog: {
          path: './blog',
          authorsMapPath: './authors.yml',
          blogTitle: 'Grafio Blog',
          blogDescription: 'Updates, news, and insights about Grafio',
          blogSidebarCount: 5,
          blogSidebarTitle: 'All our posts',
          routeBasePath: 'blog',
          postsPerPage: 10,
        },
        theme: {
          customCss: './src/css/custom.css',
        },
        gtag: {
          trackingID: 'G-S9STZBQJXT',
          anonymizeIP: true,
        },
      } satisfies Preset.Options,
    ],
  ],

  plugins: ['@docusaurus/theme-mermaid'],

  themeConfig: {
    image: 'img/grafio-social-card.jpg',
    navbar: {
      title: 'Grafio',
      logo: {
        alt: 'Grafio Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'gettingStarted',
          position: 'left',
          label: 'Getting Started',
        },
        {
          type: 'docSidebar',
          sidebarId: 'guides',
          position: 'left',
          label: 'Guides',
        },
        {
          type: 'docSidebar',
          sidebarId: 'apiReference',
          position: 'left',
          label: 'API Reference',
        },
        {
          type: 'docSidebar',
          sidebarId: 'tutorials',
          position: 'left',
          label: 'Tutorials',
        },
        {
          to: 'blog',
          label: 'Blog',
          position: 'left'
        },
        {
          type: 'docSidebar',
          sidebarId: 'contribute',
          position: 'right',
          label: 'Contribute',
        },
        {
          href: 'https://www.npmjs.com/package/grafio',
          label: 'npm',
          position: 'right',
        },
        {
          href: 'https://github.com/satya-jugran/grafio',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Getting Started',
              to: 'docs/getting-started/installation',
            },
            {
              label: 'Guides',
              to: 'docs/guides/core-concepts',
            },
            {
              label: 'API Reference',
              to: 'docs/api-reference/graph',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'GitHub Discussions',
              href: 'https://github.com/satya-jugran/grafio/discussions',
            },
            {
              label: 'Stack Overflow',
              href: 'https://stackoverflow.com/questions/tagged/grafio',
            },
          ],
        },
        {
          title: 'Social',
          items: [
            {
              label: 'npm',
              href: 'https://www.npmjs.com/package/grafio',
            },
            {
              label: 'Ko-fi',
              href: 'https://ko-fi.com/satyajugran',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Satya Jugran`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['typescript', 'javascript', 'bash', 'json', 'yaml', 'mermaid'],
    },
    mermaid: {
      theme: { light: 'neutral', dark: 'dark' },
    },
  } satisfies Preset.ThemeConfig,
};

export default config;