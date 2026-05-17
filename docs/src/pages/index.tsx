import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={styles.hero}>
      <div className={styles.heroInner}>
        <Heading as="h1" className={styles.heroTitle}>
          {siteConfig.title}
        </Heading>
        <p className={styles.heroSubtitle}>{siteConfig.tagline}</p>
        <div className={styles.heroButtons}>
          <Link
            className="button button--primary button--lg"
            to="docs/getting-started/installation">
            Get Started
          </Link>
          <Link
            className="button button--secondary button--lg"
            to="docs/guides/core-concepts">
            Read the Guides
          </Link>
        </div>
      </div>
    </header>
  );
}

function FeatureCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className={styles.featureCard}>
      <Heading as="h3" className={styles.featureTitle}>
        {title}
      </Heading>
      <p>{description}</p>
    </div>
  );
}

function HomepageFeatures() {
  return (
    <section className={styles.features}>
      <div className={styles.featuresGrid}>
        <FeatureCard
          title="Pluggable Storage"
          description="Swap storage backends without changing application code. In-memory built-in, MongoDB available separately."
        />
        <FeatureCard
          title="Cypher Queries"
          description="OpenCypher-compatible query language with aggregations, variable-length paths, and query plan inspection."
        />
        <FeatureCard
          title="Multi-Hop Traversal"
          description="BFS and DFS traversal with type and property filtering. Find paths between any nodes."
        />
        <FeatureCard
          title="Transaction Support"
          description="Atomic multi-operation updates with automatic rollback on failure."
        />
        <FeatureCard
          title="Smart Caching"
          description="LRU/LFU/FIFO caching with budget enforcement. In-memory or Redis backends."
        />
        <FeatureCard
          title="Graph Analysis"
          description="DAG validation, topological sorting, and Mermaid diagram export."
        />
      </div>
    </section>
  );
}

export default function Home(): JSX.Element {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout
      title="Graph database with pluggable storage"
      description={siteConfig.tagline}>
      <HomepageHeader />
      <main>
        <HomepageFeatures />
      </main>
    </Layout>
  );
}