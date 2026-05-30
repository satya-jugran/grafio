import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
import CodeBlock from '@theme/CodeBlock';

import styles from './index.module.css';
import { JSX } from 'react';

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={styles.hero}>
      <div style={{ position: 'absolute', top: '1rem', right: '1rem', zIndex: 10 }}>
        <span className="badge badge--primary" style={{ fontSize: '0.9rem', padding: '0.3rem 0.8rem' }}>
          Latest Version: v7.12.0
        </span>
      </div>
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

function CodeExamples() {
  const socialCode = `import { CypherEngine } from 'grafio';
import { InMemoryGraphFactory } from 'grafio/storage';

const graph = new InMemoryGraphFactory().forGraph('social');
const cypher = new CypherEngine(graph);

// Build graph
await cypher.execute(\`
  CREATE (alice:Person {name: 'Alice'}),
         (bob:Person {name: 'Bob'}),
         (charlie:Person {name: 'Charlie'})
\`);

await cypher.execute(\`
  MATCH (a:Person {name: 'Alice'}), (b:Person {name: 'Bob'})
  CREATE (a)-[:KNOWS]->(b)
\`);

await cypher.execute(\`
  MATCH (a:Person {name: 'Bob'}), (b:Person {name: 'Charlie'})
  CREATE (a)-[:KNOWS]->(b)
\`);

// Query
const suggestions = await cypher.execute(\`
  MATCH (p:Person)-[:KNOWS]->(f)-[:KNOWS]->(s)
  WHERE p.name = 'Alice' AND p <> s
  RETURN s.name as suggested
\`);
// Result: [{ suggested: 'Charlie' }]`;

  const ecommerceCode = `import { CypherEngine } from 'grafio';
import { InMemoryGraphFactory } from 'grafio/storage';

const graph = new InMemoryGraphFactory().forGraph('shop');
const cypher = new CypherEngine(graph);

// Build graph
await cypher.execute(\`
  CREATE (laptop:Product {name: 'Laptop', price: 999}),
         (mouse:Product {name: 'Mouse', price: 29}),
         (john:Customer {name: 'John'}),
         (order1:Order {total: 1028})
\`);

await cypher.execute(\`MATCH (c:Customer {name: 'John'}), (o:Order {total: 1028}) CREATE (c)-[:PLACED]->(o)\`);
await cypher.execute(\`MATCH (o:Order {total: 1028}), (p:Product {name: 'Laptop'}) CREATE (o)-[:CONTAINS]->(p)\`);
await cypher.execute(\`MATCH (o:Order {total: 1028}), (p:Product {name: 'Mouse'}) CREATE (o)-[:CONTAINS]->(p)\`);

// Query
const orders = await cypher.execute(\`
  MATCH (c:Customer)-[:PLACED]->(o:Order)-[:CONTAINS]->(p:Product)
  RETURN c.name as customer, collect(p.name) as products
\`);
// Result: [{ customer: 'John', products: ['Laptop', 'Mouse'] }]`;

  const healthcareCode = `import { CypherEngine } from 'grafio';
import { InMemoryGraphFactory } from 'grafio/storage';

const graph = new InMemoryGraphFactory().forGraph('clinic');
const cypher = new CypherEngine(graph);

// Build graph
await cypher.execute(\`
  CREATE (john:Patient {name: 'John'}),
         (emily:Patient {name: 'Emily'}),
         (dr_chen:Doctor {name: 'Dr. Chen'}),
         (hbp:Condition {name: 'Hypertension'}),
         (migraine:Condition {name: 'Migraine'})
\`);

await cypher.execute(\`MATCH (j:Patient {name: 'John'}), (d:Doctor {name: 'Dr. Chen'}) CREATE (j)-[:SEES]->(d)\`);
await cypher.execute(\`MATCH (j:Patient {name: 'John'}), (c:Condition {name: 'Hypertension'}) CREATE (j)-[:DIAGNOSED_WITH]->(c)\`);
await cypher.execute(\`MATCH (e:Patient {name: 'Emily'}), (d:Doctor {name: 'Dr. Chen'}) CREATE (e)-[:SEES]->(d)\`);
await cypher.execute(\`MATCH (e:Patient {name: 'Emily'}), (c:Condition {name: 'Migraine'}) CREATE (e)-[:DIAGNOSED_WITH]->(c)\`);

// Query
const patients = await cypher.execute(\`
  MATCH (doc)-[:SEES]-(p:Patient)-[:DIAGNOSED_WITH]-(c)
  RETURN doc.name as doctor, p.name as patient, c.name as condition
\`);
// Result: [{ doctor: 'Dr. Chen', patient: 'John', condition: 'Hypertension' }, ...]`;

  return (
    <section className={styles.codeSection}>
      <div className={styles.codeSectionInner}>
        <Heading as="h2" className={styles.codeSectionTitle}>
          See Grafio in Action
        </Heading>
        <p className={styles.codeSectionSubtitle}>
          Real-world use cases powered by Cypher queries
        </p>
        
        <Tabs groupId="use-case">
          <TabItem value="social" label="Social Network">
            <div className={styles.codeWindow}>
              <div className={styles.codeWindowHeader}>
                <div className={`${styles.windowButton} ${styles.windowButtonRed}`} />
                <div className={`${styles.windowButton} ${styles.windowButtonYellow}`} />
                <div className={`${styles.windowButton} ${styles.windowButtonGreen}`} />
              </div>
              <div className={styles.codeWindowBody}>
                <CodeBlock language="typescript">{socialCode}</CodeBlock>
              </div>
              <div className={styles.codeWindowFooter}>
                <span>TypeScript</span>
              </div>
            </div>
          </TabItem>
          <TabItem value="ecommerce" label="E-Commerce">
            <div className={styles.codeWindow}>
              <div className={styles.codeWindowHeader}>
                <div className={`${styles.windowButton} ${styles.windowButtonRed}`} />
                <div className={`${styles.windowButton} ${styles.windowButtonYellow}`} />
                <div className={`${styles.windowButton} ${styles.windowButtonGreen}`} />
              </div>
              <div className={styles.codeWindowBody}>
                <CodeBlock language="typescript">{ecommerceCode}</CodeBlock>
              </div>
              <div className={styles.codeWindowFooter}>
                <span>TypeScript</span>
              </div>
            </div>
          </TabItem>
          <TabItem value="healthcare" label="Healthcare">
            <div className={styles.codeWindow}>
              <div className={styles.codeWindowHeader}>
                <div className={`${styles.windowButton} ${styles.windowButtonRed}`} />
                <div className={`${styles.windowButton} ${styles.windowButtonYellow}`} />
                <div className={`${styles.windowButton} ${styles.windowButtonGreen}`} />
              </div>
              <div className={styles.codeWindowBody}>
                <CodeBlock language="typescript">{healthcareCode}</CodeBlock>
              </div>
              <div className={styles.codeWindowFooter}>
                <span>TypeScript</span>
              </div>
            </div>
          </TabItem>
        </Tabs>
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
        <CodeExamples />
      </main>
    </Layout>
  );
}